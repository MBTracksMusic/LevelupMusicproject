import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Pause, Play, ShoppingCart } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { ProductWithRelations } from '../lib/supabase/types';
import { formatPrice } from '../lib/utils/format';
import { usePlayerStore } from '../lib/stores/player';
import { useCartStore } from '../lib/stores/cart';
import { useAuth } from '../lib/auth/hooks';

export function ProductDetailsPage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { currentTrack, setCurrentTrack, isPlaying, setIsPlaying } = usePlayerStore();
  const { addToCart } = useCartStore();

  const [product, setProduct] = useState<ProductWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const routePrefix = useMemo(() => location.pathname.split('/')[1] || 'beats', [location.pathname]);

  useEffect(() => {
    let isCancelled = false;

    const loadProduct = async () => {
      if (!slug) {
        setError('Titre introuvable.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        let query = supabase
          .from('products')
          .select(`
            *,
            producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
            genre:genres(*),
            mood:moods(*)
          `)
          .eq('slug', slug)
          .eq('is_published', true);

        if (routePrefix === 'exclusives') {
          query = query.eq('is_exclusive', true);
        } else if (routePrefix === 'kits') {
          query = query.eq('product_type', 'kit');
        } else if (routePrefix === 'beats') {
          query = query.eq('product_type', 'beat').eq('is_exclusive', false);
        }

        const { data, error: fetchError } = await query.maybeSingle();

        if (fetchError) {
          throw fetchError;
        }

        if (!isCancelled) {
          setProduct((data as ProductWithRelations | null) ?? null);
        }
      } catch (e) {
        if (!isCancelled) {
          console.error('Error loading product details', e);
          setError('Impossible de charger ce titre.');
          setProduct(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadProduct();
    return () => {
      isCancelled = true;
    };
  }, [slug, routePrefix]);

  const isCurrentTrack = currentTrack?.id === product?.id;
  const isPlayingCurrent = isCurrentTrack && isPlaying;

  const handlePlay = () => {
    if (!product) return;

    if (isCurrentTrack) {
      setIsPlaying(!isPlaying);
      return;
    }

    setCurrentTrack(product);
    setIsPlaying(true);
  };

  const handleAddToCart = async () => {
    if (!product || !isAuthenticated || product.is_sold) return;
    setIsAddingToCart(true);
    try {
      await addToCart(product.id);
    } catch (e) {
      console.error('Error adding to cart from details page', e);
    } finally {
      setIsAddingToCart(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-5xl mx-auto px-4">
          <div className="h-8 w-48 bg-zinc-800 rounded mb-6 animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="aspect-square bg-zinc-800 rounded-2xl animate-pulse" />
            <div className="space-y-4">
              <div className="h-10 w-3/4 bg-zinc-800 rounded animate-pulse" />
              <div className="h-6 w-1/2 bg-zinc-800 rounded animate-pulse" />
              <div className="h-24 w-full bg-zinc-800 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product || error) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-5xl mx-auto px-4 text-center py-20">
          <h1 className="text-3xl font-bold text-white mb-3">Titre introuvable</h1>
          <p className="text-zinc-400 mb-6">{error || "Ce titre n'existe pas ou n'est plus disponible."}</p>
          <Link to="/beats" className="inline-flex items-center gap-2 text-rose-400 hover:text-rose-300">
            <ArrowLeft className="w-4 h-4" />
            Retour aux beats
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4">
        <Link
          to={routePrefix === 'exclusives' ? '/exclusives' : routePrefix === 'kits' ? '/kits' : '/beats'}
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900">
            {product.cover_image_url ? (
              <img src={product.cover_image_url} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              <div className="aspect-square w-full bg-gradient-to-br from-zinc-800 to-zinc-900" />
            )}
          </div>

          <div>
            <p className="text-sm text-zinc-500 mb-2">{product.producer?.username || 'Unknown'}</p>
            <h1 className="text-4xl font-bold text-white mb-3">{product.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400 mb-6">
              {product.bpm && <span>{product.bpm} BPM</span>}
              {product.key_signature && <span>{product.key_signature}</span>}
              {product.genre?.name && <span>{product.genre.name}</span>}
              {product.mood?.name && <span>{product.mood.name}</span>}
            </div>

            <p className="text-zinc-300 leading-relaxed mb-8">
              {product.description || 'Aucune description fournie.'}
            </p>

            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handlePlay}
                className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
                aria-label={isPlayingCurrent ? 'Pause' : 'Play'}
              >
                {isPlayingCurrent ? (
                  <Pause className="w-5 h-5 text-zinc-900" fill="currentColor" />
                ) : (
                  <Play className="w-5 h-5 text-zinc-900 ml-0.5" fill="currentColor" />
                )}
              </button>

              <span className="text-3xl font-bold text-white">{formatPrice(product.price)}</span>
            </div>

            {!product.is_sold && isAuthenticated && (
              <Button
                onClick={handleAddToCart}
                isLoading={isAddingToCart}
                leftIcon={<ShoppingCart className="w-4 h-4" />}
              >
                {t('products.addToCart')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
