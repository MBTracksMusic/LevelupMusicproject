import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Music, BarChart3, ShoppingBag, UploadCloud, Trash2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import type { Database, Product } from '../lib/supabase/types';
import { formatPrice } from '../lib/utils/format';
import { extractStoragePathFromCandidate } from '../lib/utils/storage';

interface ProducerStatsRow {
  total_revenue: number | null;
  total_plays: number | null;
}

export function ProducerDashboardPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [revenueCents, setRevenueCents] = useState(0);
  const [viewsCount, setViewsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
          { count: totalSales, error: salesError },
        ] = await Promise.all([
          supabase
            .from('products')
            .select('id', { count: 'exact', head: true })
            .eq('producer_id', profile.id)
            .is('deleted_at', null),
          supabase
            .from('products')
            .select('*')
            .eq('producer_id', profile.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
          supabase
            .from('purchases')
            .select('id', { count: 'exact', head: true })
            .eq('producer_id', profile.id)
            .eq('status', 'completed'),
        ]);

        if (productCountError) {
          console.error('Error loading producer product count', productCountError);
        }
        if (!isCancelled) {
          setProductCount(totalProducts ?? 0);
        }

        if (productsError) {
          console.error('Error loading producer products', productsError);
          if (!isCancelled) {
            setProducts([]);
            setError(productsError.message);
          }
        } else if (!isCancelled) {
          setProducts((productsData as Product[]) || []);
        }

        if (salesError) {
          console.error('Error loading producer sales count', salesError);
        }
        if (!isCancelled) {
          setSalesCount(totalSales ?? 0);
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
          const fallbackViewsCount = ((productsData as Product[]) || []).reduce(
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
  }, [profile?.id]);
  const AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';
  const COVER_BUCKET = import.meta.env.VITE_SUPABASE_COVER_BUCKET || 'beats-covers';

  const deleteProduct = async (product: Product) => {
    if (!profile?.id) return;

    const { count: purchaseCount, error: purchaseCheckError } = await supabase
      .from('purchases')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', product.id)
      .eq('producer_id', profile.id);

    if (purchaseCheckError) {
      console.error('Error checking product purchases before delete', purchaseCheckError);
      setError("Impossible de verifier l'historique des ventes pour ce produit.");
      return;
    }

    if ((purchaseCount ?? 0) > 0) {
      window.alert('Ce produit a deja ete vendu et ne peut pas etre supprime.');
      return;
    }

    const confirm = window.confirm(
      `Supprimer définitivement "${product.title}" ? Cette action retire aussi les fichiers et les favoris associés.`
    );
    if (!confirm) return;

    setDeletingId(product.id);
    setError(null);

    // Collect storage paths to delete
    const audioPaths = [
      extractStoragePathFromCandidate(product.master_url, AUDIO_BUCKET),
      extractStoragePathFromCandidate(product.preview_url, AUDIO_BUCKET),
      extractStoragePathFromCandidate(product.exclusive_preview_url, AUDIO_BUCKET),
    ].filter(Boolean) as string[];

    const coverPaths = [extractStoragePathFromCandidate(product.cover_image_url, COVER_BUCKET)].filter(
      Boolean
    ) as string[];

    try {
      // Clean related rows first to avoid FK constraints
      await supabase.from('wishlists').delete().eq('product_id', product.id);
      await supabase.from('cart_items').delete().eq('product_id', product.id);
      await supabase.from('product_files').delete().eq('product_id', product.id);

      // Delete storage files (ignore errors but log them)
      if (audioPaths.length) {
        const { error: storageError } = await supabase.storage
          .from(AUDIO_BUCKET)
          .remove(audioPaths);
        if (storageError) {
          console.warn('Audio deletion warning', storageError);
        }
      }
      if (coverPaths.length) {
        const { error: coverError } = await supabase.storage
          .from(COVER_BUCKET)
          .remove(coverPaths);
        if (coverError) {
          console.warn('Cover deletion warning', coverError);
        }
      }

      // Soft-delete the product row (scoped to the producer for safety)
      const { error: productError } = await supabase
        .from('products')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', product.id)
        .eq('producer_id', profile.id);

      if (productError) {
        throw productError;
      }

      // Update local state
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      setProductCount((prev) => Math.max(0, prev - 1));
      setViewsCount((prev) => Math.max(0, prev - (product.play_count || 0)));
    } catch (e) {
      console.error('Error deleting product', e);
      setError(e instanceof Error ? e.message : 'Suppression impossible pour le moment.');
    } finally {
      setDeletingId(null);
    }
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
          <UploadBeatButton label={t('producer.uploadBeat')} />
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Music} label={t('producer.products')} value={productCount} />
          <StatCard icon={ShoppingBag} label={t('producer.sales')} value={salesCount} />
          <StatCard icon={BarChart3} label="Lectures" value={viewsCount} />
          <StatCard icon={Music} label={t('producer.earnings')} value={formatPrice(revenueCents)} />
        </section>

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
              {profile?.is_producer_active ? 'Aucun produit pour le moment.' : t('producer.subscriptionRequired')}
            </p>
          )}
          {!isLoading && !error && products.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {products.map((product) => (
                <li key={product.id} className="py-3 flex items-center justify-between text-sm gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{product.title}</p>
                    <p className="text-zinc-500">
                      {product.bpm ? `${product.bpm} BPM` : '—'} ·{' '}
                      {product.key_signature || '—'} · {product.is_published ? t('producer.published') : t('producer.draft')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-300 whitespace-nowrap">
                      {formatPrice(product.price || 0)}
                    </span>
                    <button
                      onClick={() => deleteProduct(product)}
                      disabled={deletingId === product.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-500/30 text-red-300 hover:text-red-100 hover:border-red-400/70 bg-red-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                      {deletingId === product.id ? 'Suppression...' : 'Supprimer'}
                    </button>
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
