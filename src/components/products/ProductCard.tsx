import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, Heart, ShoppingCart, Star, Lock } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import type { ProductWithRelations } from '../../lib/supabase/types';
import { usePlayerStore } from '../../lib/stores/player';
import { useCartStore } from '../../lib/stores/cart';
import { useAuth, usePermissions } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { formatPrice } from '../../lib/utils/format';

interface ProductCardProps {
  product: ProductWithRelations;
  onWishlistToggle?: (productId: string) => void;
  isWishlisted?: boolean;
}

export function ProductCard({ product, onWishlistToggle, isWishlisted }: ProductCardProps) {
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuth();
  const permissions = usePermissions();
  const { currentTrack, setCurrentTrack, isPlaying, setIsPlaying } = usePlayerStore();
  const { addToCart } = useCartStore();
  const [isHovered, setIsHovered] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const isCurrentTrack = currentTrack?.id === product.id;
  const isPlayingCurrent = isCurrentTrack && isPlaying;

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isCurrentTrack) {
      setIsPlaying(!isPlaying);
    } else {
      setCurrentTrack(product);
      setIsPlaying(true);
    }
  };

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) return;

    setIsAddingToCart(true);
    try {
      await addToCart(product.id);
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onWishlistToggle?.(product.id);
  };

  const getGenreName = () => {
    if (!product.genre) return null;
    switch (language) {
      case 'en':
        return product.genre.name_en;
      case 'de':
        return product.genre.name_de;
      default:
        return product.genre.name;
    }
  };

  const productUrl = product.is_exclusive
    ? `/exclusives/${product.slug}`
    : product.product_type === 'kit'
    ? `/kits/${product.slug}`
    : `/beats/${product.slug}`;

  const canAccessExclusive = product.is_exclusive ? permissions.canPurchaseExclusive : true;

  return (
    <Link
      to={productUrl}
      className="group block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-700 transition-all duration-300 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1">
        <div className="relative aspect-square">
          {product.cover_image_url ? (
            <img
              src={product.cover_image_url}
              alt={product.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
              <Play className="w-12 h-12 text-zinc-700" />
            </div>
          )}

          <div
            className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity duration-200 ${
              isHovered || isPlayingCurrent ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <button
              onClick={handlePlay}
              className="w-14 h-14 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform"
            >
              {isPlayingCurrent ? (
                <Pause className="w-6 h-6 text-zinc-900" fill="currentColor" />
              ) : (
                <Play className="w-6 h-6 text-zinc-900 ml-1" fill="currentColor" />
              )}
            </button>
          </div>

          <div className="absolute top-3 left-3 flex flex-wrap gap-2">
            {product.is_exclusive && (
              <Badge variant="premium">
                <Star className="w-3 h-3" />
                {t('products.exclusive')}
              </Badge>
            )}
            {product.product_type === 'kit' && (
              <Badge variant="info">{t('products.kit')}</Badge>
            )}
            {product.is_sold && (
              <Badge variant="danger">{t('products.sold')}</Badge>
            )}
          </div>

          {isAuthenticated && (
            <button
              onClick={handleWishlist}
              className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                isWishlisted
                  ? 'bg-rose-500 text-white'
                  : 'bg-black/50 text-white hover:bg-black/70'
              }`}
            >
              <Heart
                className="w-4 h-4"
                fill={isWishlisted ? 'currentColor' : 'none'}
              />
            </button>
          )}

          {product.is_exclusive && !canAccessExclusive && (
            <div className="absolute bottom-3 left-3 right-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-black/70 backdrop-blur-sm rounded-lg text-xs text-zinc-300">
                <Lock className="w-3 h-3" />
                {t('battles.mustBeConfirmed')}
              </div>
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-white truncate group-hover:text-rose-400 transition-colors">
                {product.title}
              </h3>
              <p className="text-sm text-zinc-400 truncate">
                {product.producer?.username || 'Unknown'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-3">
            {getGenreName() && (
              <span className="px-2 py-0.5 bg-zinc-800 rounded-full">
                {getGenreName()}
              </span>
            )}
            {product.bpm && <span>{product.bpm} BPM</span>}
            {product.key_signature && <span>{product.key_signature}</span>}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-white">
              {formatPrice(product.price)}
            </span>
            {!product.is_sold && isAuthenticated && (
              <Button
                size="sm"
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
    </Link>
  );
}
