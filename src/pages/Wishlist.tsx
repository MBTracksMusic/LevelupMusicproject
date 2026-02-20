import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Heart, AlertCircle, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ProductCard } from '../components/products/ProductCard';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';
import { useWishlistStore } from '../lib/stores/wishlist';
import type { ProductWithRelations } from '../lib/supabase/types';

interface WishlistProductRow {
  product: ProductWithRelations | null;
}

export function WishlistPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { fetchWishlist, toggleWishlist, clearWishlist } = useWishlistStore();
  const [products, setProducts] = useState<ProductWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadWishlistProducts = async () => {
      if (!user?.id) {
        if (!isCancelled) {
          setProducts([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const { data, error: queryError } = await supabase
          .from('wishlists')
          .select(`
            product:products(
              *,
              producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
              genre:genres(*),
              mood:moods(*)
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (queryError) {
          throw queryError;
        }

        const rows = (data as WishlistProductRow[] | null) ?? [];
        const mappedProducts = rows
          .map((row) => row.product)
          .filter((product): product is ProductWithRelations => product !== null);

        if (!isCancelled) {
          setProducts(mappedProducts);
        }

        await fetchWishlist();
      } catch (loadError) {
        console.error('Error loading wishlist:', loadError);
        if (!isCancelled) {
          setError("Impossible de charger vos favoris pour l'instant.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadWishlistProducts();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, fetchWishlist]);

  const handleWishlistToggle = async (productId: string) => {
    try {
      await toggleWishlist(productId);
      setProducts((prev) => prev.filter((product) => product.id !== productId));
    } catch (toggleError) {
      console.error('Error removing from wishlist:', toggleError);
      setError("Impossible de mettre à jour vos favoris pour l'instant.");
    }
  };

  const handleClearWishlist = async () => {
    if (!user?.id) return;

    const shouldClear = window.confirm('Voulez-vous vraiment vider toute votre wishlist ?');
    if (!shouldClear) return;

    setIsClearing(true);
    setError(null);

    try {
      const { error: clearError } = await supabase
        .from('wishlists')
        .delete()
        .eq('user_id', user.id);

      if (clearError) {
        throw clearError;
      }

      setProducts([]);
      clearWishlist();
    } catch (clearAllError) {
      console.error('Error clearing wishlist:', clearAllError);
      setError("Impossible de vider vos favoris pour l'instant.");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-rose-400/80">{t('user.wishlist')}</p>
            <h1 className="text-3xl font-bold text-white mt-2">{t('nav.wishlist')}</h1>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/beats">
              <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
                {t('checkout.continueShopping')}
              </Button>
            </Link>
            {products.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Trash2 className="w-4 h-4" />}
                onClick={handleClearWishlist}
                isLoading={isClearing}
              >
                Vider la wishlist
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="min-h-[40vh] flex items-center justify-center">
            <div className="w-10 h-10 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="min-h-[40vh] border border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-4 bg-zinc-900/40">
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              <Heart className="w-6 h-6 text-zinc-400" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-white">Votre liste est vide</h2>
              <p className="text-sm text-zinc-500 mt-1">Ajoutez des beats à vos favoris pour les retrouver ici.</p>
            </div>
            <Link to="/beats">
              <Button size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
                {t('checkout.continueShopping')}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isWishlisted={true}
                onWishlistToggle={handleWishlistToggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

