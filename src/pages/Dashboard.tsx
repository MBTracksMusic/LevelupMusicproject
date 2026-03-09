import { useEffect, useState } from 'react';
import { User, Mail, Shield, Music, ShoppingBag, Heart, Download, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { useMyReputation } from '../lib/reputation/hooks';
import { supabase } from '../lib/supabase/client';
import type { License, ProductWithRelations, Purchase } from '../lib/supabase/types';
import { fetchPublicProducerProfilesMap, type PublicProducerProfileRow } from '../lib/supabase/publicProfiles';
import { GENRE_SAFE_COLUMNS, MOOD_SAFE_COLUMNS, PRODUCT_SAFE_COLUMNS } from '../lib/supabase/selects';
import { buildAudioStoragePathCandidates, extractStoragePathFromCandidate } from '../lib/utils/storage';
import { formatDate, formatPrice } from '../lib/utils/format';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ReputationBadge } from '../components/reputation/ReputationBadge';
import { ProductCard } from '../components/products/ProductCard';
import { useWishlistStore } from '../lib/stores/wishlist';

interface DashboardPurchase extends Purchase {
  product: ProductWithRelations | null;
  license: License | null;
}

interface WishlistProductRow {
  product: ProductWithRelations | null;
}

interface ProducerSubscriptionSummary {
  subscription_status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
}

const toProducerPreview = (
  publicProfile: PublicProducerProfileRow | undefined
): ProductWithRelations['producer'] | undefined => {
  if (!publicProfile) return undefined;
  return {
    id: publicProfile.user_id,
    username: publicProfile.username,
    avatar_url: publicProfile.avatar_url,
  } as ProductWithRelations['producer'];
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
) => {
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

  return subscriptionStatus;
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

const toNullableNumber = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const toNullableBoolean = (value: unknown) => {
  if (typeof value !== 'boolean') return null;
  return value;
};

const formatLimit = (value: number | null, t: TranslateFn) =>
  value === null ? t('common.unlimited') : value.toLocaleString();

const formatBoolean = (value: boolean | null, t: TranslateFn) => {
  if (value === null) return t('common.notDefined');
  return value ? t('common.yes') : t('common.no');
};

const roleColors: Record<string, string> = {
  visitor: 'bg-zinc-700',
  user: 'bg-blue-600',
  confirmed_user: 'bg-green-600',
  producer: 'bg-orange-600',
  admin: 'bg-rose-600',
};

const MASTER_BUCKET = import.meta.env.VITE_SUPABASE_MASTER_BUCKET || 'beats-masters';
const LEGACY_MASTER_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';
const PREVIEW_BUCKET = import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET || 'beats-watermarked';
const MASTER_BUCKET_CANDIDATES = [MASTER_BUCKET, 'beats-masters', LEGACY_MASTER_BUCKET, 'beats-audio']
  .filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);

export function DashboardPage() {
  const { user, profile } = useAuth();
  const { reputation } = useMyReputation();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fetchWishlist, toggleWishlist } = useWishlistStore();
  const [purchases, setPurchases] = useState<DashboardPurchase[]>([]);
  const [awaitingAdminCount, setAwaitingAdminCount] = useState<number>(0);
  const [wishlistCount, setWishlistCount] = useState<number>(0);
  const [recentWishlist, setRecentWishlist] = useState<ProductWithRelations[]>([]);
  const [isWishlistLoading, setIsWishlistLoading] = useState(false);
  const [selectedLicensePurchase, setSelectedLicensePurchase] = useState<DashboardPurchase | null>(null);
  const [isPurchasesLoading, setIsPurchasesLoading] = useState(true);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);
  const [producerSubscription, setProducerSubscription] = useState<ProducerSubscriptionSummary | null>(null);
  const [isProducerSubscriptionLoading, setIsProducerSubscriptionLoading] = useState(false);
  const [licenseDownloadingPurchaseId, setLicenseDownloadingPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadPurchases = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setPurchases([]);
          setIsPurchasesLoading(false);
        }
        return;
      }

      setIsPurchasesLoading(true);
      setPurchasesError(null);

      try {
        const { data, error } = await supabase
          .from('purchases')
          .select(`
            *,
            product:products!purchases_product_id_fkey(
              ${PRODUCT_SAFE_COLUMNS}
            ),
            license:licenses!purchases_license_id_fkey(
              id,
              name,
              description,
              max_streams,
              max_sales,
              youtube_monetization,
              music_video_allowed,
              credit_required,
              exclusive_allowed,
              price,
              created_at,
              updated_at
            )
          ` as any)
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(100);

        if (error) {
          throw error;
        }

        if (!isCancelled) {
          const rows = (data as unknown as DashboardPurchase[] | null) ?? [];
          const producerIds = [...new Set(
            rows
              .map((purchase) => purchase.product?.producer_id)
              .filter((value): value is string => typeof value === 'string' && value.length > 0)
          )];

          let producerProfilesMap = new Map<string, PublicProducerProfileRow>();
          if (producerIds.length > 0) {
            try {
              producerProfilesMap = await fetchPublicProducerProfilesMap(producerIds);
            } catch (profilesError) {
              console.error('Error loading public producer profiles for purchases:', profilesError);
            }
          }

          const hydratedRows = rows.map((purchase) => {
            if (!purchase.product) return purchase;

            const producerProfile = toProducerPreview(producerProfilesMap.get(purchase.product.producer_id));
            if (!producerProfile) return purchase;

            return {
              ...purchase,
              product: {
                ...purchase.product,
                producer: producerProfile,
              },
            };
          });

          setPurchases(hydratedRows);
        }
      } catch (error) {
        console.error('Error loading purchases:', error);
        if (!isCancelled) {
          setPurchasesError(t('dashboard.purchasesLoadError'));
        }
      } finally {
        if (!isCancelled) {
          setIsPurchasesLoading(false);
        }
      }
    };

    void loadPurchases();

    return () => {
      isCancelled = true;
    };
  }, [t, user?.id]);

  useEffect(() => {
    let isCancelled = false;

    const loadWishlistData = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setWishlistCount(0);
          setRecentWishlist([]);
          setIsWishlistLoading(false);
        }
        return;
      }

      setIsWishlistLoading(true);

      try {
        const [{ count, error: countError }, { data, error: recentError }] = await Promise.all([
          supabase
            .from('wishlists')
            .select('product_id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabase
            .from('wishlists')
            .select(`
              product:products(
                ${PRODUCT_SAFE_COLUMNS},
                genre:genres(${GENRE_SAFE_COLUMNS}),
                mood:moods(${MOOD_SAFE_COLUMNS})
              )
            ` as any)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(3),
        ]);

        if (countError) {
          console.error('Error loading wishlist count:', countError);
        } else if (!isCancelled) {
          setWishlistCount(count ?? 0);
        }

        if (recentError) {
          console.error('Error loading recent wishlist products:', recentError);
          if (!isCancelled) {
            setRecentWishlist([]);
          }
        } else if (!isCancelled) {
          const rows = (data as unknown as WishlistProductRow[] | null) ?? [];
          const mappedProducts = rows
            .map((row) => row.product)
            .filter((product): product is ProductWithRelations => product !== null);

          const producerIds = [...new Set(
            mappedProducts
              .map((product) => product.producer_id)
              .filter((value): value is string => typeof value === 'string' && value.length > 0)
          )];

          let producerProfilesMap = new Map<string, PublicProducerProfileRow>();
          if (producerIds.length > 0) {
            try {
              producerProfilesMap = await fetchPublicProducerProfilesMap(producerIds);
            } catch (profilesError) {
              console.error('Error loading public producer profiles for wishlist:', profilesError);
            }
          }

          const hydratedProducts = mappedProducts.map((product) => {
            const producerProfile = toProducerPreview(producerProfilesMap.get(product.producer_id));
            if (!producerProfile) return product;

            return {
              ...product,
              producer: producerProfile,
            };
          });

          setRecentWishlist(hydratedProducts);
        }

        await fetchWishlist();
      } catch (error) {
        console.error('Error loading wishlist data:', error);
      } finally {
        if (!isCancelled) {
          setIsWishlistLoading(false);
        }
      }
    };

    void loadWishlistData();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, fetchWishlist]);

  useEffect(() => {
    let isCancelled = false;

    const loadProducerSubscription = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setProducerSubscription(null);
          setIsProducerSubscriptionLoading(false);
        }
        return;
      }

      setIsProducerSubscriptionLoading(true);
      try {
        const { data, error } = await supabase
          .from('producer_subscriptions')
          .select('subscription_status, current_period_end, cancel_at_period_end, stripe_subscription_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (!isCancelled) {
          setProducerSubscription((data as ProducerSubscriptionSummary | null) ?? null);
        }
      } catch (error) {
        console.error('Error loading producer subscription:', error);
        if (!isCancelled) {
          setProducerSubscription(null);
        }
      } finally {
        if (!isCancelled) {
          setIsProducerSubscriptionLoading(false);
        }
      }
    };

    void loadProducerSubscription();

    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let isCancelled = false;

    const loadAwaitingAdminCount = async () => {
      if (!user?.id || profile?.role !== 'admin') {
        if (!isCancelled) {
          setAwaitingAdminCount(0);
        }
        return;
      }

      const { count, error } = await supabase
        .from('battles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'awaiting_admin');

      if (error) {
        console.error('Error loading awaiting_admin battle count:', error);
        if (!isCancelled) {
          setAwaitingAdminCount(0);
        }
        return;
      }

      if (!isCancelled) {
        setAwaitingAdminCount(count ?? 0);
      }
    };

    void loadAwaitingAdminCount();

    return () => {
      isCancelled = true;
    };
  }, [profile?.role, user?.id]);

  const purchaseCount = purchases.length;
  const producerSubscriptionStatus = producerSubscription?.subscription_status ?? null;
  const producerSubscriptionStatusLabel = getSubscriptionStatusLabel(producerSubscriptionStatus, t);
  const nextProducerBillingDate = formatSubscriptionDate(producerSubscription?.current_period_end, t);
  const producerSubscriptionDateLabel = getSubscriptionDateLabel(
    producerSubscription?.subscription_status,
    producerSubscription?.cancel_at_period_end,
    t,
  );
  const producerAutoRenewLabel = producerSubscription
    ? (producerSubscription.cancel_at_period_end ? t('common.no') : t('common.yes'))
    : '-';

  const roleLabels: Record<string, string> = {
    visitor: t('dashboard.roleVisitor'),
    user: t('dashboard.roleUser'),
    confirmed_user: t('dashboard.roleConfirmedUser'),
    producer: t('dashboard.roleProducer'),
    admin: t('dashboard.roleAdmin'),
  };

  const stats = [
    {
      label: t('dashboard.statsPurchases'),
      value: purchaseCount,
      icon: ShoppingBag,
      color: 'text-blue-400',
    },
    {
      label: t('dashboard.statsWishlist'),
      value: wishlistCount,
      icon: Heart,
      color: 'text-rose-400',
      onClick: () => navigate('/wishlist'),
    },
    ...(profile?.role === 'admin'
      ? [{
          label: t('dashboard.statsAwaitingBattles'),
          value: awaitingAdminCount,
          icon: Shield,
          color: 'text-amber-400',
          onClick: () => navigate('/admin/battles'),
        }]
      : []),
    ...((profile?.is_producer_active || profile?.role === 'producer' || producerSubscriptionStatus)
      ? [{
          label: t('dashboard.statsProducerStatus'),
          value: producerSubscriptionStatusLabel,
          icon: Music,
          color: producerSubscriptionStatus === 'active' || producerSubscriptionStatus === 'trialing'
            ? 'text-green-400'
            : 'text-orange-400',
        }]
      : []),
  ];

  const handleRecentWishlistToggle = async (productId: string) => {
    if (!user?.id) return;

    try {
      await toggleWishlist(productId);
      setRecentWishlist((prev) => prev.filter((product) => product.id !== productId));
      setWishlistCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error toggling wishlist item from dashboard:', error);
    }
  };

  const isPreviewPathCandidate = (candidate: string) => {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) return true;
    if (normalized.includes(`${PREVIEW_BUCKET.toLowerCase()}/`) || normalized.includes('beats-watermarked/')) {
      return true;
    }
    return /(^|[/._-])preview([/._-]|$)/i.test(normalized);
  };

  const getPurchaseFilePath = (purchase: DashboardPurchase) => {
    const metadata = purchase.metadata as Record<string, unknown> | null;
    const metadataPathCandidates = [
      metadata?.master_path,
      metadata?.master_url,
      metadata?.file_path,
      metadata?.track_path,
      metadata?.storage_path,
      metadata?.download_path,
      purchase.audio_path_snapshot,
    ];

    for (const candidate of metadataPathCandidates) {
      if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        continue;
      }
      if (isPreviewPathCandidate(candidate)) {
        continue;
      }
      return candidate;
    }

    return null;
  };

  const forceFileDownload = async (url: string, fallbackName = 'track.mp3') => {
    const link = document.createElement('a');
    const triggerDirectDownload = () => {
      link.href = url;
      link.download = fallbackName;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const httpError = new Error(`Download failed with status ${response.status}`) as Error & {
          status?: number;
        };
        httpError.status = response.status;
        throw httpError;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
      link.download = fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      const status =
        typeof downloadError === 'object' &&
        downloadError !== null &&
        'status' in downloadError &&
        typeof (downloadError as { status?: unknown }).status === 'number'
          ? (downloadError as { status: number }).status
          : null;

      if (status !== null && status >= 400) {
        throw downloadError;
      }

      console.warn('Blob download failed, using direct link fallback', downloadError);
      triggerDirectDownload();
    }
  };

  const handleLegacyDownload = async (rawPath: string) => {
    const filePath = rawPath.trim();
    if (!filePath) return;

    if (isPreviewPathCandidate(filePath)) {
      throw new Error('Preview path cannot be used for purchased download');
    }

    if (filePath.startsWith('http')) {
      const isMasterUrl = MASTER_BUCKET_CANDIDATES.some((bucket) =>
        filePath.includes(`/${bucket}/`) || filePath.includes(`${bucket}%2F`)
      );
      if (!isMasterUrl) {
        throw new Error('Non-master URL blocked in legacy download');
      }
      const fallbackName = decodeURIComponent(
        filePath.split('?')[0].split('/').pop() || 'track.mp3'
      );
      await forceFileDownload(filePath, fallbackName);
      return;
    }

    let lastError: unknown = null;

    for (const bucket of MASTER_BUCKET_CANDIDATES) {
      const resolvedPath = extractStoragePathFromCandidate(filePath, bucket) || filePath;
      if (isPreviewPathCandidate(resolvedPath)) {
        continue;
      }
      const fallbackName = decodeURIComponent(resolvedPath.split('/').pop() || 'track.mp3');
      const pathCandidates = buildAudioStoragePathCandidates(resolvedPath);

      for (const pathCandidate of pathCandidates) {
        const publicUrl = supabase.storage.from(bucket).getPublicUrl(pathCandidate).data.publicUrl;
        if (!publicUrl) continue;

        try {
          await forceFileDownload(publicUrl, fallbackName);
          return;
        } catch (downloadError) {
          lastError = downloadError;
        }
      }
    }

    throw lastError ?? new Error('Legacy download failed');
  };

  const handleDownload = async (purchase: DashboardPurchase) => {
    const productId = purchase.product_id || purchase.product?.id;

    if (!productId) {
      toast.error(t('dashboard.productUnavailableDownload'));
      return;
    }

    const { data: masterData, error: masterError } = await supabase.functions.invoke<{
      url: string;
      expires_in: number;
      bucket?: string;
      path?: string;
      code?: string;
    }>('get-master-url', {
      body: { product_id: productId },
    });

    if (!masterError && masterData?.url) {
      try {
        const fallbackName = decodeURIComponent(
          (masterData.path || masterData.url).split('?')[0].split('/').pop() || 'track.mp3'
        );
        await forceFileDownload(masterData.url, fallbackName);
        toast.success(t('dashboard.downloadStarted'));
      } catch (downloadError) {
        console.error('Master download error:', downloadError);
        toast.error(t('dashboard.downloadError'));
      }
      return;
    }

    const legacyPath = getPurchaseFilePath(purchase);
    if (!legacyPath) {
      console.error('Download error: missing master and legacy path', {
        purchaseId: purchase.id,
        productId,
        masterError,
        masterData,
      });
      toast.error(t('dashboard.downloadError'));
      return;
    }

    try {
      await handleLegacyDownload(legacyPath);
      toast.success(t('dashboard.downloadStarted'));
    } catch (legacyError) {
      console.error('Legacy download error:', {
        purchaseId: purchase.id,
        productId,
        masterError,
        masterData,
        legacyError,
      });
      toast.error(t('dashboard.downloadError'));
    }
  };

  const handleLicenseDownload = async (purchase: DashboardPurchase) => {
    setLicenseDownloadingPurchaseId(purchase.id);

    try {
      const { data: contractData, error: contractError } = await supabase.functions.invoke<{
        url: string;
        expires_in: number;
        path?: string;
      }>('get-contract-url', {
        body: { purchase_id: purchase.id },
      });

      if (contractError) {
        throw contractError;
      }

      if (contractData?.url) {
        window.open(contractData.url, '_blank');
        return;
      }

      console.warn('Contract PDF unavailable', {
        purchaseId: purchase.id,
        contractData,
      });
      toast.error(t('dashboard.contractDownloadError'));
    } catch (error) {
      console.error('License download error:', {
        purchaseId: purchase.id,
        error,
      });
      toast.error(t('dashboard.contractDownloadError'));
    } finally {
      setLicenseDownloadingPurchaseId((current) => (current === purchase.id ? null : current));
    }
  };

  const selectedLicenseMetadata = (selectedLicensePurchase?.metadata as Record<string, unknown> | null) || null;
  const selectedLicense = selectedLicensePurchase?.license || null;
  const selectedLicenseName =
    selectedLicense?.name || selectedLicensePurchase?.license_type || t('dashboard.licenseFallback');
  const selectedLicenseDescription =
    selectedLicense?.description ||
    (typeof selectedLicenseMetadata?.license_description === 'string'
      ? selectedLicenseMetadata.license_description
      : t('dashboard.licenseDescriptionUnavailable'));

  const selectedMaxStreams =
    selectedLicense?.max_streams ??
    toNullableNumber(selectedLicenseMetadata?.max_streams);

  const selectedMaxSales =
    selectedLicense?.max_sales ??
    toNullableNumber(selectedLicenseMetadata?.max_sales);

  const selectedYoutubeMonetization =
    selectedLicense?.youtube_monetization ??
    toNullableBoolean(selectedLicenseMetadata?.youtube_monetization);

  const selectedMusicVideoAllowed =
    selectedLicense?.music_video_allowed ??
    toNullableBoolean(selectedLicenseMetadata?.music_video_allowed);

  const selectedCreditRequired =
    selectedLicense?.credit_required ??
    toNullableBoolean(selectedLicenseMetadata?.credit_required);

  const selectedExclusiveAllowed =
    selectedLicense?.exclusive_allowed ??
    toNullableBoolean(selectedLicenseMetadata?.exclusive_allowed);

  return (
    <div className="pt-20 pb-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('dashboard.title')}</h1>
          <p className="text-zinc-400">
            {t('dashboard.welcome', { name: profile?.username || user?.email || t('common.unknown') })}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="p-6"
              variant={stat.onClick ? 'interactive' : 'default'}
              onClick={stat.onClick}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-400 mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold text-white">{stat.value}</p>
                </div>
                <div className={`p-3 rounded-xl bg-zinc-800 ${stat.color}`}>
                  <stat.icon className="w-6 h-6" />
                </div>
              </div>
            </Card>
          ))}
        </div>

        {reputation && (
          <Card className="p-6 mb-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm text-zinc-400 mb-1">{t('dashboard.reputationTitle')}</p>
                <p className="text-2xl font-bold text-white">{reputation.xp} {t('common.xpShort')}</p>
                <p className="text-sm text-zinc-500">
                  {t('dashboard.reputationBreakdown', {
                    forumXp: reputation.forum_xp,
                    battleXp: reputation.battle_xp,
                    score: Number(reputation.reputation_score).toFixed(0),
                  })}
                </p>
              </div>
              <ReputationBadge
                rankTier={reputation.rank_tier}
                level={reputation.level}
                xp={reputation.xp}
              />
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-rose-400" />
              {t('dashboard.profileInfo')}
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">{t('dashboard.username')}</span>
                <span className="text-white font-medium">{profile?.username || '-'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">{t('common.email')}</span>
                <span className="text-white font-medium">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">{t('dashboard.roleLabel')}</span>
                <Badge className={roleColors[profile?.role || 'visitor']}>
                  {roleLabels[profile?.role || 'visitor']}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">{t('dashboard.activeProducer')}</span>
                <Badge className={profile?.is_producer_active ? 'bg-green-600' : 'bg-zinc-700'}>
                  {profile?.is_producer_active ? t('common.yes') : t('common.no')}
                </Badge>
              </div>
              {(profile?.role === 'producer' || producerSubscription || isProducerSubscriptionLoading) && (
                <>
                  <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                    <span className="text-zinc-400">{t('dashboard.subscriptionStatus')}</span>
                    <span className="text-white font-medium">
                      {isProducerSubscriptionLoading ? t('common.loading') : producerSubscriptionStatusLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                    <span className="text-zinc-400">{producerSubscriptionDateLabel}</span>
                    <span className="text-white font-medium">
                      {isProducerSubscriptionLoading ? '...' : nextProducerBillingDate}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-zinc-400">{t('subscription.autoRenew')}</span>
                    <Badge className={producerSubscription && !producerSubscription.cancel_at_period_end ? 'bg-green-600' : 'bg-zinc-700'}>
                      {isProducerSubscriptionLoading ? '...' : producerAutoRenewLabel}
                    </Badge>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-rose-400" />
              {t('dashboard.security')}
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">{t('dashboard.emailVerified')}</span>
                <Badge className={user?.email_confirmed_at ? 'bg-green-600' : 'bg-orange-600'}>
                  {user?.email_confirmed_at ? t('common.yes') : t('dashboard.pending')}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-zinc-800">
                <span className="text-zinc-400">{t('dashboard.registration')}</span>
                <span className="text-white">
                  {user?.created_at
                    ? formatDate(user.created_at)
                    : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-zinc-400">{t('dashboard.lastLogin')}</span>
                <span className="text-white">
                  {user?.last_sign_in_at
                    ? formatDate(user.last_sign_in_at)
                    : '-'}
                </span>
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-6 mt-6" id="purchases">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-rose-400" />
              {t('dashboard.purchasesTitle')}
            </h2>
            <Badge className="bg-zinc-700">{purchases.length}</Badge>
          </div>

          {isPurchasesLoading && (
            <div className="py-6 text-zinc-500">{t('dashboard.loadingPurchases')}</div>
          )}

          {!isPurchasesLoading && purchasesError && (
            <div className="py-6 text-rose-300">{purchasesError}</div>
          )}

          {!isPurchasesLoading && !purchasesError && purchases.length === 0 && (
            <div className="py-6 text-zinc-500">{t('dashboard.noPurchases')}</div>
          )}

          {!isPurchasesLoading && !purchasesError && purchases.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {purchases.map((purchase) => {
                const product = purchase.product;
                const license = purchase.license;
                const canDownload = Boolean(purchase.product_id);
                const licenseName = license?.name || purchase.license_type || t('dashboard.licenseFallback');
                const licenseDescription =
                  license?.description ||
                  t('dashboard.licenseDescriptionFallback');
                const canViewLicenseDetails = Boolean(license || purchase.license_type);

                return (
                  <li
                    key={purchase.id}
                    className="py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {product?.cover_image_url ? (
                        <img
                          src={product.cover_image_url}
                          alt={product.title}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                          {t('dashboard.audioFallback')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-white font-medium truncate">
                          {product?.title || t('dashboard.titleUnavailable')}
                        </p>
                        <p className="text-sm text-zinc-400 truncate">
                          {product?.producer?.username || t('dashboard.producerFallback')} ·{' '}
                          {formatDate(purchase.created_at)}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                            {licenseName}
                          </span>
                          <span>{purchase.is_exclusive ? t('dashboard.exclusiveType') : t('dashboard.standardType')}</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                          {licenseDescription}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2">
                      {canDownload && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleDownload(purchase);
                          }}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          {t('dashboard.downloadAudio')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          void handleLicenseDownload(purchase);
                        }}
                        disabled={licenseDownloadingPurchaseId === purchase.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Download className="w-4 h-4" />
                        {t('dashboard.downloadLicense')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLicensePurchase(purchase)}
                        disabled={!canViewLicenseDetails}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileText className="w-4 h-4" />
                        {t('dashboard.viewLicenseDetails')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-6 mt-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-400" />
              {t('dashboard.recentWishlist')}
            </h2>
            <Badge className="bg-zinc-700">{wishlistCount}</Badge>
          </div>

          {isWishlistLoading && recentWishlist.length === 0 && (
            <div className="py-6 text-zinc-500">{t('dashboard.loadingWishlist')}</div>
          )}

          {!isWishlistLoading && recentWishlist.length === 0 && (
            <div className="py-6 text-zinc-500">{t('dashboard.noWishlist')}</div>
          )}

          {recentWishlist.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {recentWishlist.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  isWishlisted={true}
                  onWishlistToggle={handleRecentWishlistToggle}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Mail className="w-5 h-5 text-rose-400" />
            {t('dashboard.recentActivity')}
          </h2>
          {purchases.length > 0 ? (
            <ul className="space-y-2">
              {purchases.slice(0, 5).map((purchase) => (
                <li key={`activity-${purchase.id}`} className="text-sm text-zinc-400">
                  {t('dashboard.activityPurchase', {
                    title: purchase.product?.title || t('dashboard.activityTitleFallback'),
                    date: formatDate(purchase.created_at),
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-8 text-zinc-500">
              {t('dashboard.noActivity')}
            </div>
          )}
        </Card>

        <Modal
          isOpen={Boolean(selectedLicensePurchase)}
          onClose={() => setSelectedLicensePurchase(null)}
          title={selectedLicensePurchase
            ? t('dashboard.licenseModalTitle', { name: selectedLicenseName })
            : t('dashboard.licenseModalTitleDefault')}
          description={t('dashboard.licenseModalDescription')}
          size="lg"
        >
          {selectedLicensePurchase && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-sm text-zinc-400 mb-1">{t('common.description')}</p>
                <p className="text-sm text-zinc-200">{selectedLicenseDescription}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">{t('dashboard.maxStreams')}</p>
                  <p className="text-sm text-white">{formatLimit(selectedMaxStreams, t)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">{t('dashboard.maxSales')}</p>
                  <p className="text-sm text-white">{formatLimit(selectedMaxSales, t)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">{t('dashboard.youtubeMonetization')}</p>
                  <p className="text-sm text-white">{formatBoolean(selectedYoutubeMonetization, t)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">{t('dashboard.musicVideoAllowed')}</p>
                  <p className="text-sm text-white">{formatBoolean(selectedMusicVideoAllowed, t)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">{t('dashboard.creditRequired')}</p>
                  <p className="text-sm text-white">{formatBoolean(selectedCreditRequired, t)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs text-zinc-500 mb-1">{t('dashboard.exclusiveAllowed')}</p>
                  <p className="text-sm text-white">{formatBoolean(selectedExclusiveAllowed, t)}</p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-xs text-zinc-500 mb-1">{t('dashboard.pricePaid')}</p>
                <p className="text-sm text-white">
                  {formatPrice(
                    selectedLicensePurchase.amount,
                    selectedLicensePurchase.currency || 'EUR',
                  )}
                </p>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
