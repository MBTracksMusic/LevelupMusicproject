import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Play, Pause, Heart, ShoppingCart, Star, Lock } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAudioPlayer, type Track } from '../../context/AudioPlayerContext';
import type { ProductWithRelations } from '../../lib/supabase/types';
import { trackAddToCart, trackBeatLike } from '../../lib/analytics';
import { useCartStore } from '../../lib/stores/cart';
import { useAuth, usePermissions } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { getLocalizedField } from '../../lib/i18n/localized';
import { isEarlyAccessActive, isEarlyAccessLocked } from '../../lib/products/earlyAccess';
import { trackInteraction } from '../../lib/tracking';
import { formatPrice } from '../../lib/utils/format';

interface ProductCardProps {
  product: ProductWithRelations;
  playbackQueue?: Track[];
  onWishlistToggle?: (productId: string) => void | Promise<void>;
  isWishlisted?: boolean;
  hasPremiumAccess?: boolean;
}

export function ProductCard({
  product,
  playbackQueue,
  onWishlistToggle,
  isWishlisted,
  hasPremiumAccess = false,
}: ProductCardProps) {
  const { t, language } = useTranslation();
  const { isAuthenticated } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentTrack, isPlaying, playQueue, playTrack } = useAudioPlayer();
  const { addToCart } = useCartStore();
  const [isHovered, setIsHovered] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const hasPreview = Boolean(product.preview_url?.trim());
  const isEarlyAccess = isEarlyAccessActive(product.early_access_until);
  const isEarlyAccessPurchaseLocked = isEarlyAccessLocked(product.early_access_until, hasPremiumAccess);

  const isCurrentTrack = currentTrack?.id === product.id;
  const isPlayingCurrent = hasPreview && isCurrentTrack && isPlaying;

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hasPreview) return;

    const queueIndex = playbackQueue?.findIndex((track) => track.id === product.id) ?? -1;

    if (playbackQueue && queueIndex >= 0) {
      playQueue(playbackQueue, queueIndex);
      return;
    }

    playTrack({
      id: product.id,
      title: product.title,
      audioUrl: product.preview_url!.trim(),
      cover_image_url: product.cover_image_url,
      producerId: product.producer_id,
    });
  };

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isEarlyAccessPurchaseLocked) {
      return;
    }

    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: location.pathname } } });
      return;
    }

    setIsAddingToCart(true);
    try {
      await addToCart(product.id);
      trackAddToCart({
        productId: product.id,
        productName: product.title,
        price: product.price,
      });
      if (product.product_type === 'beat') {
        void trackInteraction({
          beatId: product.id,
          action: 'add_to_cart',
        });
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await onWishlistToggle?.(product.id);
      if (product.product_type === 'beat' && !isWishlisted) {
        trackBeatLike(product.id);
        void trackInteraction({
          beatId: product.id,
          action: 'like',
        });
      }
    } catch (error) {
      console.error('Error toggling wishlist:', error);
    }
  };

  const getGenreName = () => {
    return getLocalizedField(product.genre, language);
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
              disabled={!hasPreview}
              className="w-14 h-14 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-transform disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={
                hasPreview
                  ? (isPlayingCurrent ? t('common.pause') : t('common.play'))
                  : t('products.previewUnavailable')
              }
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
            {isEarlyAccess && (
              <Badge variant="warning">
                🔥 {t('products.earlyAccess')}
              </Badge>
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
                {product.producer?.username || t('home.unknownProducer')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-3">
            {getGenreName() && (
              <span className="px-2 py-0.5 bg-zinc-800 rounded-full">
                {getGenreName()}
              </span>
            )}
            {product.bpm && <span>{product.bpm} {t('products.bpm')}</span>}
            {product.key_signature && <span>{product.key_signature}</span>}
          </div>

          {!hasPreview && (
            <p className="mb-3 text-xs text-zinc-500">{t('products.previewUnavailable')}</p>
          )}
          {isEarlyAccessPurchaseLocked && (
            <p className="mb-3 text-xs text-amber-300">{t('products.availableSoon')}</p>
          )}

          <div className="flex items-center justify-between">
            <div>
              <span className="text-lg font-bold text-white">
                {formatPrice(product.price)}
              </span>
            </div>
            {!product.is_sold && (
              <Button
                size="sm"
                onClick={handleAddToCart}
                disabled={isEarlyAccessPurchaseLocked}
                isLoading={isAddingToCart}
                leftIcon={<ShoppingCart className="w-4 h-4" />}
                variant={isAuthenticated ? 'primary' : 'outline'}
              >
                {isEarlyAccessPurchaseLocked
                  ? t('products.availableSoon')
                  : isAuthenticated
                    ? t('products.addToCart')
                    : t('auth.loginButton')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
