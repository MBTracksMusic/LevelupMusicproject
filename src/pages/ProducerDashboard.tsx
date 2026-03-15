import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Music, BarChart3, ShoppingBag, UploadCloud, Trash2 } from 'lucide-react';
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '@/lib/supabase/client';
import { invokeProtectedEdgeFunction } from '../lib/supabase/edgeAuth';
import { PRODUCT_SAFE_COLUMNS } from '../lib/supabase/selects';
import type { Database, Product, ProducerTier } from '../lib/supabase/types';
import { formatDate, formatPrice } from '../lib/utils/format';
import { extractStoragePathFromCandidate } from '../lib/utils/storage';

interface ProducerStatsRow {
  total_revenue: number | null;
  total_plays: number | null;
}

interface AdvancedProducerStatsRow {
  published_beats: number;
  completed_sales: number;
  revenue_cents: number;
  monthly_battles_created: number;
  sales_per_published_beat: number;
}

interface ProducerSubscriptionSummary {
  subscription_status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
}

type ProductSalesCountMap = Record<string, number>;

interface ProducerProduct extends Product {
  sales_count: number;
  active_battle_count: number;
  terminated_battle_count: number;
}

const SALE_STATUSES: Array<Database['public']['Enums']['purchase_status']> = ['completed', 'refunded'];

const getRpcErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
};

const getProductLifecycleLabel = (
  product: Product,
  draftLabel: string,
  publishedLabel: string,
  archivedLabel: string,
) => {
  if (product.status === 'archived') return archivedLabel;
  return product.is_published ? publishedLabel : draftLabel;
};

const hasProtectedProductHistory = (product: ProducerProduct) =>
  product.sales_count > 0 || product.terminated_battle_count > 0;

const getProtectedHistoryMessage = (t: TranslateFn) =>
  t('producerDashboard.protectedHistoryMessage');

const toProducerTier = (value: unknown): ProducerTier => {
  if (value === 'starter' || value === 'pro' || value === 'elite') return value;
  return 'starter';
};

const EXPIRED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'cancelled', 'incomplete_expired']);

const getSubscriptionDateLabel = (
  subscriptionStatus: string | null | undefined,
  cancelAtPeriodEnd: boolean | null | undefined,
  t: TranslateFn,
) => {
  const normalizedStatus = (subscriptionStatus ?? '').toLowerCase();

  if (normalizedStatus === 'active') {
    return cancelAtPeriodEnd
      ? t('subscription.dateLabelAccessEnds')
      : t('subscription.dateLabelNextCharge');
  }

  if (EXPIRED_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
    return t('subscription.dateLabelExpiredAt');
  }

  return t('subscription.dateLabelNextDue');
};

const getSubscriptionStatusLabel = (
  subscriptionStatus: string | null | undefined,
  t: TranslateFn,
): string => {
  const normalizedStatus = (subscriptionStatus ?? '').trim().toLowerCase();

  if (!normalizedStatus) return t('subscription.noSubscription');
  if (normalizedStatus === 'active') return t('subscription.statusActive');
  if (normalizedStatus === 'trialing') return t('subscription.statusTrialing');
  if (normalizedStatus === 'past_due') return t('subscription.statusPastDue');
  if (normalizedStatus === 'unpaid') return t('subscription.statusUnpaid');
  if (normalizedStatus === 'incomplete') return t('subscription.statusIncomplete');
  if (normalizedStatus === 'incomplete_expired') return t('subscription.statusIncompleteExpired');
  if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
    return t('subscription.statusCanceled');
  }
  if (normalizedStatus === 'paused') return t('subscription.statusPaused');

  return subscriptionStatus ?? t('subscription.noSubscription');
};

const formatSubscriptionDate = (
  value: string | number | Date | null | undefined,
  t: TranslateFn,
) => {
  if (value === null || value === undefined) return t('common.notAvailable');

  let parsedDate: Date | null = null;

  if (value instanceof Date) {
    parsedDate = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const timestampMs = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    parsedDate = new Date(timestampMs);
  } else if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) return t('common.notAvailable');

    if (/^-?\d+$/.test(trimmedValue)) {
      const numericTimestamp = Number(trimmedValue);
      if (!Number.isFinite(numericTimestamp)) return t('common.notAvailable');
      const timestampMs = Math.abs(numericTimestamp) < 1_000_000_000_000
        ? numericTimestamp * 1000
        : numericTimestamp;
      parsedDate = new Date(timestampMs);
    } else {
      parsedDate = new Date(trimmedValue);
    }
  }

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return t('common.notAvailable');
  return formatDate(parsedDate);
};

export function ProducerDashboardPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const currentTier = toProducerTier(profile?.producer_tier);
  const hasAdvancedAccess = currentTier === 'pro' || currentTier === 'elite';
  const [products, setProducts] = useState<ProducerProduct[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [revenueCents, setRevenueCents] = useState(0);
  const [viewsCount, setViewsCount] = useState(0);
  const [advancedStats, setAdvancedStats] = useState<AdvancedProducerStatsRow | null>(null);
  const [isAdvancedLoading, setIsAdvancedLoading] = useState(false);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [versioningId, setVersioningId] = useState<string | null>(null);
  const [producerSubscription, setProducerSubscription] = useState<ProducerSubscriptionSummary | null>(null);
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    // Scroll to top when arriving on dashboard
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadDashboardData() {
      if (!profile?.id) {
        if (!isCancelled) {
          setProducts([]);
          setProductCount(0);
          setSalesCount(0);
          setRevenueCents(0);
          setViewsCount(0);
          setIsLoading(false);
        }
        return;
      }

      if (!isCancelled) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const [
          { count: totalProducts, error: productCountError },
          { data: productsData, error: productsError },
          { data: purchaseRows, error: salesError },
          { data: activeBattleRows, error: activeBattleError },
          { data: terminatedBattleRows, error: terminatedBattleError },
        ] = await Promise.all([
          supabase
            .from('products')
            .select('id', { count: 'exact', head: true })
            .eq('producer_id', profile.id)
            .is('deleted_at', null),
          supabase
            .from('products')
            .select(PRODUCT_SAFE_COLUMNS)
            .eq('producer_id', profile.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
          supabase
            .from('purchases')
            .select('product_id')
            .eq('producer_id', profile.id)
            .in('status', SALE_STATUSES),
          supabase
            .from('battles')
            .select('product1_id, product2_id')
            .eq('status', 'active')
            .or(`producer1_id.eq.${profile.id},producer2_id.eq.${profile.id}`),
          supabase
            .from('battles')
            .select('product1_id, product2_id')
            .eq('status', 'completed')
            .or(`producer1_id.eq.${profile.id},producer2_id.eq.${profile.id}`),
        ]);

        if (productCountError) {
          console.error('Error loading producer product count', productCountError);
        }
        if (!isCancelled) {
          setProductCount(totalProducts ?? 0);
        }

        const salesByProduct = (((purchaseRows as Array<{ product_id: string }> | null) || [])).reduce<ProductSalesCountMap>(
          (acc, purchase) => {
            acc[purchase.product_id] = (acc[purchase.product_id] ?? 0) + 1;
            return acc;
          },
          {}
        );

        const battlesByProduct = (((activeBattleRows as Array<{ product1_id: string | null; product2_id: string | null }> | null) || []))
          .reduce<ProductSalesCountMap>((acc, battle) => {
            if (battle.product1_id) {
              acc[battle.product1_id] = (acc[battle.product1_id] ?? 0) + 1;
            }
            if (battle.product2_id) {
              acc[battle.product2_id] = (acc[battle.product2_id] ?? 0) + 1;
            }
            return acc;
          }, {});

        const terminatedBattlesByProduct = (((terminatedBattleRows as Array<{ product1_id: string | null; product2_id: string | null }> | null) || []))
          .reduce<ProductSalesCountMap>((acc, battle) => {
            if (battle.product1_id) {
              acc[battle.product1_id] = (acc[battle.product1_id] ?? 0) + 1;
            }
            if (battle.product2_id) {
              acc[battle.product2_id] = (acc[battle.product2_id] ?? 0) + 1;
            }
            return acc;
          }, {});

        if (productsError) {
          console.error('Error loading producer products', productsError);
          if (!isCancelled) {
            setProducts([]);
            setError(productsError.message);
          }
        } else if (!isCancelled) {
          const typedProducts = ((productsData as unknown as Product[]) || []);
          setProducts(
            typedProducts.map((product) => ({
              ...product,
              sales_count: salesByProduct[product.id] ?? 0,
              active_battle_count: battlesByProduct[product.id] ?? 0,
              terminated_battle_count: terminatedBattlesByProduct[product.id] ?? 0,
            }))
          );
        }

        if (salesError) {
          console.error('Error loading producer sales count', salesError);
        }
        if (activeBattleError) {
          console.error('Error loading producer active battle counts', activeBattleError);
        }
        if (terminatedBattleError) {
          console.error('Error loading producer completed battle counts', terminatedBattleError);
        }
        if (!isCancelled) {
          setSalesCount((purchaseRows as Array<{ product_id: string }> | null)?.length ?? 0);
        }

        let computedRevenueCents: number | null = null;
        const producerStatsSource = 'producer_stats' as unknown as keyof Database['public']['Tables'];
        const { data: producerStatsData, error: producerStatsError } = await supabase
          .from(producerStatsSource)
          .select('total_revenue, total_plays')
          .eq('producer_id', profile.id)
          .maybeSingle();

        if (producerStatsError) {
          console.error('Producer stats view unavailable, falling back to purchases sum', producerStatsError);
          const typedProductsData = ((productsData as unknown as Product[]) || []);
          const fallbackViewsCount = typedProductsData.reduce(
            (total, product) => total + (product.play_count || 0),
            0
          );
          if (!isCancelled) {
            setViewsCount(Math.max(0, fallbackViewsCount));
          }
        } else {
          const typedStats = producerStatsData as unknown as ProducerStatsRow | null;
          computedRevenueCents = typedStats?.total_revenue ?? 0;
          if (!isCancelled) {
            setViewsCount(Math.max(0, typedStats?.total_plays ?? 0));
          }
        }

        if (computedRevenueCents === null) {
          const { data: purchaseAmounts, error: fallbackRevenueError } = await supabase
            .from('purchases')
            .select('amount')
            .eq('producer_id', profile.id)
            .eq('status', 'completed');

          if (fallbackRevenueError) {
            console.error('Error loading producer revenue fallback', fallbackRevenueError);
          } else {
            const typedPurchaseAmounts = ((purchaseAmounts as unknown as Array<{ amount: number }> | null) || []);
            computedRevenueCents = typedPurchaseAmounts.reduce((total, purchase) => total + purchase.amount, 0);
          }
        }

        if (!isCancelled) {
          setRevenueCents(Math.max(0, computedRevenueCents ?? 0));
        }

        if (hasAdvancedAccess) {
          if (!isCancelled) {
            setIsAdvancedLoading(true);
            setAdvancedError(null);
          }

          const { data: advancedData, error: advancedStatsError } = await supabase.rpc('get_advanced_producer_stats');

          if (advancedStatsError) {
            console.error('Error loading advanced producer stats', advancedStatsError);
            if (!isCancelled) {
              setAdvancedStats(null);
              setAdvancedError(t('producerDashboard.advancedStatsUnavailable'));
            }
          } else if (!isCancelled) {
            const row = (advancedData as AdvancedProducerStatsRow[] | null)?.[0] ?? null;
            setAdvancedStats(row);
          }

          if (!isCancelled) {
            setIsAdvancedLoading(false);
          }
        } else if (!isCancelled) {
          setAdvancedStats(null);
          setAdvancedError(null);
        }
      } catch (loadError) {
        console.error('Unexpected error loading producer dashboard', loadError);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboardData();

    return () => {
      isCancelled = true;
    };
  }, [hasAdvancedAccess, profile?.id, t]);

  useEffect(() => {
    let isCancelled = false;

    async function loadProducerSubscription() {
      if (!profile?.id) {
        if (!isCancelled) {
          setProducerSubscription(null);
          setIsSubscriptionLoading(false);
        }
        return;
      }

      setIsSubscriptionLoading(true);
      try {
        const { data, error: subscriptionError } = await supabase
          .from('producer_subscriptions')
          .select('subscription_status, current_period_end, cancel_at_period_end, stripe_subscription_id')
          .eq('user_id', profile.id)
          .maybeSingle();

        if (subscriptionError) throw subscriptionError;

        if (!isCancelled) {
          setProducerSubscription((data as ProducerSubscriptionSummary | null) ?? null);
        }
      } catch (subscriptionError) {
        console.error('Error loading producer subscription', subscriptionError);
        if (!isCancelled) {
          setProducerSubscription(null);
        }
      } finally {
        if (!isCancelled) {
          setIsSubscriptionLoading(false);
        }
      }
    }

    void loadProducerSubscription();

    return () => {
      isCancelled = true;
    };
  }, [profile?.id]);
  const WATERMARKED_BUCKET = import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET || 'beats-watermarked';
  const COVER_BUCKET = import.meta.env.VITE_SUPABASE_COVER_BUCKET || 'beats-covers';
  const producerSubscriptionStatus = producerSubscription?.subscription_status ?? null;
  const producerSubscriptionStatusLabel = getSubscriptionStatusLabel(producerSubscriptionStatus, t);
  const nextBillingDate = formatSubscriptionDate(producerSubscription?.current_period_end, t);
  const subscriptionDateLabel = getSubscriptionDateLabel(
    producerSubscription?.subscription_status,
    producerSubscription?.cancel_at_period_end,
    t,
  );
  const autoRenewLabel = producerSubscription
    ? (producerSubscription.cancel_at_period_end ? t('common.no') : t('common.yes'))
    : '-';
  const hasStripePortalAccess = Boolean(producerSubscription?.stripe_subscription_id);
  const cancellationTimingMessage = producerSubscription
    ? (producerSubscription.cancel_at_period_end
      ? t('producerDashboard.cancellationScheduled', { date: nextBillingDate })
      : t('producerDashboard.cancellationAnytime', { date: nextBillingDate }))
    : t('producerDashboard.noLinkedSubscription');

  const handleManageSubscription = async () => {
    if (!hasStripePortalAccess) {
      setPortalError(t('producerDashboard.noLinkedSubscription'));
      return;
    }

    setPortalError(null);
    setIsPortalLoading(true);

    try {
      const returnUrl = `${window.location.origin}/producer`;
      const data = await invokeProtectedEdgeFunction<{ url?: string; error?: string }>(
        'create-portal-session',
        {
          body: { returnUrl },
        }
      );

      if (data?.error?.includes('no_stripe_customer')) {
        setPortalError(t('producerDashboard.noLinkedSubscription'));
        return;
      }

      const portalUrl = data?.url;
      if (!portalUrl) {
        throw new Error(t('producerDashboard.portalUrlMissing'));
      }

      window.location.assign(portalUrl);
    } catch (error) {
      console.error('Error opening Stripe billing portal', error);
      const rawMessage = error instanceof Error ? error.message : '';
      if (rawMessage.includes('no_stripe_customer')) {
        setPortalError(t('producerDashboard.noLinkedSubscription'));
        return;
      }
      const isFunctionNetworkError = rawMessage.includes('Failed to send a request to the Edge Function');
      setPortalError(
        isFunctionNetworkError
          ? t('producerDashboard.portalFunctionUnavailable')
          : error instanceof Error
            ? error.message
            : t('producerDashboard.portalSubscriptionError')
      );
    } finally {
      setIsPortalLoading(false);
    }
  };

  const removeProductStorageAssets = async (product: Product) => {
    const watermarkedBucket = product.watermarked_bucket || WATERMARKED_BUCKET;
    const watermarkedPaths = [
      extractStoragePathFromCandidate(product.watermarked_path, watermarkedBucket),
      extractStoragePathFromCandidate(product.preview_url, watermarkedBucket),
      extractStoragePathFromCandidate(product.exclusive_preview_url, watermarkedBucket),
    ].filter(Boolean) as string[];

    const coverPaths = [
      extractStoragePathFromCandidate(product.cover_image_url, COVER_BUCKET),
    ].filter(Boolean) as string[];

    const uniqueWatermarkedPaths = [...new Set(watermarkedPaths)];
    const uniqueCoverPaths = [...new Set(coverPaths)];

    if (uniqueWatermarkedPaths.length) {
      const { error: previewError } = await supabase.storage
        .from(watermarkedBucket)
        .remove(uniqueWatermarkedPaths);
      if (previewError) {
        console.warn('Preview deletion warning', previewError);
      }
    }

    if (uniqueCoverPaths.length) {
      const { error: coverError } = await supabase.storage.from(COVER_BUCKET).remove(uniqueCoverPaths);
      if (coverError) {
        console.warn('Cover deletion warning', coverError);
      }
    }
  };

  const deleteProduct = async (product: ProducerProduct) => {
    const productSalesCount = product.sales_count;
    if (hasProtectedProductHistory(product)) {
      console.error('[producer-dashboard] hard delete blocked by protected history', {
        productId: product.id,
        salesCount: product.sales_count,
        terminatedBattleCount: product.terminated_battle_count,
      });
      window.alert(getProtectedHistoryMessage(t));
      return;
    }

    const confirm = window.confirm(
      t('producerDashboard.deleteConfirm', { title: product.title })
    );
    if (!confirm) return;

    setDeletingId(product.id);
    setError(null);

    try {
      const { error: deleteError } = await supabase.rpc('rpc_delete_product_if_no_sales', {
        p_product_id: product.id,
      });

      if (deleteError) {
        throw deleteError;
      }

      await removeProductStorageAssets(product);

      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      setProductCount((prev) => Math.max(0, prev - 1));
      setSalesCount((prev) => Math.max(0, prev - productSalesCount));
      setViewsCount((prev) => Math.max(0, prev - (product.play_count || 0)));
    } catch (e) {
      console.error('Error deleting product', e);
      const message = getRpcErrorMessage(e, t('producerDashboard.deleteError'));
      setError(
        message.includes('beat_has_sales')
          || message.includes('product_has_sales')
          || message.includes('product_has_terminated_battle')
          ? getProtectedHistoryMessage(t)
          : message
      );
    } finally {
      setDeletingId(null);
    }
  };

  const removeProductFromSale = async (product: ProducerProduct) => {
    if (product.status === 'archived') return;

    setRemovingId(product.id);
    setError(null);

    try {
      if (hasProtectedProductHistory(product)) {
        console.error('[producer-dashboard] archiving product with protected history', {
          productId: product.id,
          salesCount: product.sales_count,
          terminatedBattleCount: product.terminated_battle_count,
        });
      }

      const { data, error: removeError } = await supabase.rpc('rpc_archive_product', {
        p_product_id: product.id,
      });

      if (removeError) {
        throw removeError;
      }

      const updatedProduct = data as Product | null;
      if (updatedProduct) {
        setProducts((prev) => prev.map((row) => (
          row.id === product.id
            ? { ...row, ...(updatedProduct as Product) }
            : row
        )));
      }
    } catch (e) {
      console.error('Error removing product from sale', e);
      setError(getRpcErrorMessage(e, t('producerDashboard.archiveError')));
    } finally {
      setRemovingId(null);
    }
  };

  const createNewVersion = async (product: ProducerProduct) => {
    const nextVersion = Math.max(product.version_number || product.version || 1, 1) + 1;
    const confirm = window.confirm(
      t('producerDashboard.versionConfirm', { version: nextVersion, title: product.title })
    );
    if (!confirm) return;

    setVersioningId(product.id);
    setError(null);

    try {
      navigate(`/producer/upload?cloneFrom=${encodeURIComponent(product.id)}`);
    } catch (e) {
      console.error('Error creating new product version', e);
      setError(getRpcErrorMessage(e, t('producerDashboard.versionError')));
    } finally {
      setVersioningId(null);
    }
  };

  const editProduct = (product: ProducerProduct) => {
    navigate(`/producer/upload?editProductId=${encodeURIComponent(product.id)}`);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white pt-24 pb-16 px-4">
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-rose-400">{t('producer.dashboard')}</p>
            <h1 className="text-3xl sm:text-4xl font-bold mt-1">{profile?.username || profile?.email}</h1>
            <p className="text-zinc-400 mt-1">{t('producer.overview')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/producer/battles"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-200 border border-zinc-700 hover:border-zinc-500 hover:text-white transition"
            >
              {t('producerDashboard.myBattles')}
            </Link>
            <UploadBeatButton label={t('producer.uploadBeat')} />
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Music} label={t('producer.products')} value={productCount} />
          <StatCard icon={ShoppingBag} label={t('producer.sales')} value={salesCount} />
          <StatCard icon={BarChart3} label={t('producerDashboard.plays')} value={viewsCount} />
          <StatCard icon={Music} label={t('producer.earnings')} value={formatPrice(revenueCents)} />
        </section>

        <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{t('producerDashboard.subscriptionTitle')}</h2>
            <span className="text-xs text-zinc-400 uppercase tracking-wide">{t('producerDashboard.stripe')}</span>
          </div>
          {isSubscriptionLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard icon={Music} label={t('common.status')} value={producerSubscriptionStatusLabel} />
                <StatCard icon={ShoppingBag} label={subscriptionDateLabel} value={nextBillingDate} />
                <StatCard icon={BarChart3} label={t('subscription.autoRenew')} value={autoRenewLabel} />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-zinc-400">{cancellationTimingMessage}</p>
                <button
                  type="button"
                  onClick={handleManageSubscription}
                  disabled={isPortalLoading || !hasStripePortalAccess}
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-rose-500 to-orange-500 shadow-lg shadow-rose-500/20 hover:shadow-rose-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPortalLoading ? t('producerDashboard.opening') : t('producerDashboard.manageSubscription')}
                </button>
              </div>

              {portalError && (
                <p className="text-sm text-red-400">{portalError}</p>
              )}
            </div>
          )}
        </section>

        {hasAdvancedAccess && (
          <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">{t('producerDashboard.advancedStats')}</h2>
              <span className="text-xs text-zinc-400 uppercase tracking-wide">{t('producerDashboard.proElite')}</span>
            </div>
            {isAdvancedLoading && <p className="text-zinc-400 text-sm">{t('common.loading')}</p>}
            {!isAdvancedLoading && advancedError && (
              <p className="text-red-400 text-sm">{advancedError}</p>
            )}
            {!isAdvancedLoading && !advancedError && advancedStats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Music} label={t('producerDashboard.publishedBeats')} value={advancedStats.published_beats} />
                <StatCard icon={ShoppingBag} label={t('producerDashboard.completedSales')} value={advancedStats.completed_sales} />
                <StatCard icon={BarChart3} label={t('producerDashboard.battlesPerMonth')} value={advancedStats.monthly_battles_created} />
                <StatCard
                  icon={BarChart3}
                  label={t('producerDashboard.salesPerBeat')}
                  value={advancedStats.sales_per_published_beat.toFixed(2)}
                />
              </div>
            )}
          </section>
        )}

        <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">{t('producer.products')}</h2>
            <UploadBeatButton label={t('producer.uploadBeat')} variant="ghost" />
          </div>
          {isLoading && <p className="text-zinc-400 text-sm">{t('common.loading')}</p>}
          {!isLoading && error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
          {!isLoading && !error && products.length === 0 && (
            <p className="text-zinc-400 text-sm">
              {profile?.is_producer_active ? t('producerDashboard.noProducts') : t('producer.subscriptionRequired')}
            </p>
          )}
          {!isLoading && !error && products.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {products.map((product) => (
                <li key={product.id} className="py-3 flex items-center justify-between text-sm gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{`${product.title} V${product.version_number || product.version}`}</p>
                    <p className="text-zinc-500">
                      {product.bpm ? `${product.bpm} ${t('products.bpm')}` : '—'} ·{' '}
                      {product.key_signature || '—'} · {getProductLifecycleLabel(product, t('producer.draft'), t('producer.published'), t('producerDashboard.archived'))} ·{' '}
                      {t('producerDashboard.productSummary', {
                        sales: product.sales_count,
                        activeBattles: product.active_battle_count,
                        completedBattles: product.terminated_battle_count,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    <span className="text-zinc-300 whitespace-nowrap">
                      {formatPrice(product.price || 0)}
                    </span>
                    {!hasProtectedProductHistory(product) ? (
                      <>
                        <button
                          onClick={() => editProduct(product)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-sky-500/30 text-sky-200 hover:text-sky-100 hover:border-sky-400/70 bg-sky-500/10 transition"
                        >
                          {product.active_battle_count > 0 ? t('producerDashboard.editWithoutAudio') : t('common.edit')}
                        </button>
                        <button
                          onClick={() => deleteProduct(product)}
                          disabled={deletingId === product.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-500/30 text-red-300 hover:text-red-100 hover:border-red-400/70 bg-red-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4" />
                          {deletingId === product.id ? t('producerDashboard.deleting') : t('common.delete')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => removeProductFromSale(product)}
                          disabled={removingId === product.id || product.status === 'archived'}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-500/30 text-amber-200 hover:text-amber-100 hover:border-amber-400/70 bg-amber-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {removingId === product.id
                            ? t('producerDashboard.hiding')
                            : product.status === 'archived'
                              ? t('producerDashboard.alreadyHidden')
                              : t('producerDashboard.hideProduct')}
                        </button>
                        <button
                          onClick={() => createNewVersion(product)}
                          disabled={versioningId === product.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-500/30 text-rose-200 hover:text-rose-100 hover:border-rose-400/70 bg-rose-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {versioningId === product.id
                            ? t('producerDashboard.creating')
                            : t('producerDashboard.createVersion', {
                              version: Math.max(product.version_number || product.version || 1, 1) + 1,
                            })}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4 shadow-xl">
      <div className="p-3 rounded-xl bg-rose-500/10 text-rose-400">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-zinc-500">{label}</p>
        <p className="text-2xl font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

interface UploadBeatButtonProps {
  label: string;
  variant?: 'primary' | 'ghost';
}

function UploadBeatButton({ label, variant = 'primary' }: UploadBeatButtonProps) {
  const base = 'inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-zinc-950';
  const styles =
    variant === 'primary'
      ? 'px-4 py-2 bg-gradient-to-r from-rose-500 to-orange-500 shadow-lg shadow-rose-500/20 hover:shadow-rose-500/30'
      : 'px-3 py-1.5 text-rose-300 hover:text-rose-100 border border-rose-500/20 hover:border-rose-400/60 bg-rose-500/5';

  return (
    <Link to="/producer/upload" className={`${base} ${styles}`}>
      <UploadCloud className="w-4 h-4" />
      {label}
    </Link>
  );
}

export default ProducerDashboardPage;
