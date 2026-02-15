import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Music, BarChart3, ShoppingBag, UploadCloud, Trash2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import type { Product } from '../lib/supabase/types';
import { formatPrice } from '../lib/utils/format';
import { extractStoragePathFromCandidate } from '../lib/utils/storage';

export function ProducerDashboardPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    // Scroll to top when arriving on dashboard
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    async function loadProducts() {
      if (!profile?.id) {
        setProducts([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('producer_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (fetchError) {
        console.error('Error loading producer products', fetchError);
        setError(fetchError.message);
      } else {
        setProducts((data as Product[]) || []);
      }
      setIsLoading(false);
    }

    loadProducts();
  }, [profile?.id]);

  const productCount = products.length;

  const AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';
  const COVER_BUCKET = import.meta.env.VITE_SUPABASE_COVER_BUCKET || 'beats-covers';

  const deleteProduct = async (product: Product) => {
    if (!profile?.id) return;
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

      // Delete the product row (scoped to the producer for safety)
      const { error: productError } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id)
        .eq('producer_id', profile.id);

      if (productError) {
        throw productError;
      }

      // Update local state
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
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
          <StatCard icon={ShoppingBag} label={t('producer.sales')} value="—" />
          <StatCard icon={BarChart3} label={t('producer.analytics')} value="—" />
          <StatCard icon={Music} label={t('producer.earnings')} value="—" />
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
          {!isLoading && !error && productCount === 0 && (
            <p className="text-zinc-400 text-sm">
              {profile?.is_producer_active ? 'Aucun produit pour le moment.' : t('producer.subscriptionRequired')}
            </p>
          )}
          {!isLoading && !error && productCount > 0 && (
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
