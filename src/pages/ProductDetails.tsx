import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Coins, Pause, Play, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { getLocalizedName } from '../lib/i18n/localized';
import { fetchCatalogProductBySlug } from '../lib/supabase/catalog';
import type { ProductWithRelations } from '../lib/supabase/types';
import { formatPrice } from '../lib/utils/format';
import { useCartStore } from '../lib/stores/cart';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '@/lib/supabase/client';
import { useCreditBalance } from '../lib/credits/useCreditBalance';
import { isEarlyAccessActive, isEarlyAccessLocked } from '../lib/products/earlyAccess';
import { useUserSubscriptionStatus } from '../lib/subscriptions/useUserSubscriptionStatus';
import {
  trackAddToCart,
  trackClickBuy,
  trackPriceViewed,
  trackPurchase,
  trackViewItem,
} from '../lib/analytics';
import { getExperimentVariant } from '../lib/experiments';
import { trackInteraction } from '../lib/tracking';

interface CreditPurchaseResult {
  balance_after: number;
  balance_before: number;
  credits_spent: number;
  entitlement_id: string;
  product_id: string;
  purchase_id: string;
  status: string;
}

const CREDIT_VALUE_EUR = 10;
const CREDIT_VALUE_CENTS = CREDIT_VALUE_EUR * 100;
const DEFAULT_OG_IMAGE = 'https://beatelion.com/og-default.jpg';

const mapCreditPurchaseError = (message: string, t: TranslateFn) => {
  if (message.includes('insufficient_credits')) return t('productDetails.creditPurchaseInsufficient');
  if (message.includes('Not enough credits')) return t('productDetails.creditPurchaseInsufficient');
  if (message.includes('purchase_already_exists')) return t('productDetails.creditPurchaseAlreadyOwned');
  if (message.includes('exclusive_not_allowed_with_credits')) return t('productDetails.creditPurchaseUnavailable');
  if (message.includes('duplicate_request')) return t('productDetails.creditPurchaseDuplicate');
  if (message.includes('product_not_available')) return t('productDetails.creditPurchaseUnavailable');
  if (message.includes('product_not_published')) return t('productDetails.creditPurchaseUnavailable');
  if (message.includes('product_deleted')) return t('productDetails.creditPurchaseUnavailable');
  if (message.includes('product_not_active')) return t('productDetails.creditPurchaseUnavailable');
  if (message.includes('product_not_credit_eligible')) return t('productDetails.creditPurchaseUnavailable');
  if (message.includes('early_access_premium_only')) return t('products.availableSoon');
  if (message.includes('concurrent_purchase_conflict')) return t('productDetails.creditPurchaseInProgress');
  return t('productDetails.creditPurchaseGenericError');
};

export function ProductDetailsPage() {
  const { t, language } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const { isActive: hasPremiumAccess } = useUserSubscriptionStatus(user?.id);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { currentTrack, isPlaying, playTrack } = useAudioPlayer();
  const { addToCart } = useCartStore();

  const [product, setProduct] = useState<ProductWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isPurchasingWithCredits, setIsPurchasingWithCredits] = useState(false);
  const [creditPurchaseError, setCreditPurchaseError] = useState<string | null>(null);
  const [hasPurchasedProduct, setHasPurchasedProduct] = useState(false);
  const [isOwnershipLoading, setIsOwnershipLoading] = useState(false);
  const { balance: creditBalance, isLoading: isCreditBalanceLoading, error: creditBalanceError, refetch: refetchCreditBalance } =
    useCreditBalance(user?.id);

  const routePrefix = useMemo(() => location.pathname.split('/')[1] || 'beats', [location.pathname]);
  const ctaVariant = useMemo(
    () => getExperimentVariant(user?.id ?? 'guest', 'product-buy-cta'),
    [user?.id],
  );

  useEffect(() => {
    let isCancelled = false;

    const loadProduct = async () => {
      if (!slug) {
        setError(t('productDetails.missingSlug'));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (!isCancelled) {
          const row = await fetchCatalogProductBySlug({
            slug,
            routePrefix,
          });

          if (isCancelled) return;

          if (row === null) {
            setProduct(null);
          } else {
            setProduct(row);
          }
        }
      } catch (e) {
        if (!isCancelled) {
          console.error('Error loading product details', e);
          setError(t('productDetails.loadError'));
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
  }, [slug, routePrefix, t]);

  useEffect(() => {
    let isCancelled = false;

    const loadOwnership = async () => {
      if (!user?.id || !product?.id) {
        if (!isCancelled) {
          setHasPurchasedProduct(false);
          setIsOwnershipLoading(false);
          setCreditPurchaseError(null);
        }
        return;
      }

      setIsOwnershipLoading(true);

      try {
        const { count, error: purchaseError } = await supabase
          .from('purchases')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('product_id', product.id)
          .eq('status', 'completed');

        if (purchaseError) {
          throw purchaseError;
        }

        if (!isCancelled) {
          setHasPurchasedProduct((count ?? 0) > 0);
        }
      } catch (ownershipError) {
        console.error('Error loading purchase ownership for product details', ownershipError);
        if (!isCancelled) {
          setHasPurchasedProduct(false);
        }
      } finally {
        if (!isCancelled) {
          setIsOwnershipLoading(false);
        }
      }
    };

    void loadOwnership();

    return () => {
      isCancelled = true;
    };
  }, [product?.id, user?.id]);

  const displayPrice = product?.price ?? 0;
  const requiredCredits = useMemo(() => {
    if (!product) {
      return 0;
    }

    if (product.price <= 0) {
      return 0;
    }

    return Math.ceil(product.price / CREDIT_VALUE_CENTS);
  }, [product]);
  const missingCredits =
    typeof creditBalance === 'number'
      ? Math.max(requiredCredits - creditBalance, 0)
      : requiredCredits;

  useEffect(() => {
    if (!product) {
      return;
    }

    const previousTitle = document.title;
    const previousMetaDescription =
      document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    const previousOgTitle =
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '';
    const previousOgDescription =
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';
    const previousOgType =
      document.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? '';
    const previousOgUrl =
      document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? '';
    const previousOgImage =
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';
    const previousOgSiteName =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? '';
    const previousTwitterCard =
      document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? '';
    const nextTitle = `${product.title} | Beatelion`;
    const producerName = product.producer?.username?.trim();
    const descriptionParts = [
      producerName ? `Beat de ${producerName}` : null,
      product.genre?.name ? product.genre.name : null,
      typeof product.bpm === 'number' ? `${product.bpm} BPM` : null,
      `Disponible sur Beatelion`,
    ].filter(Boolean);
    const nextDescription = descriptionParts.join(' • ').slice(0, 155);
    const currentPageUrl = window.location.href;
    const ogImage = product.cover_image_url ?? DEFAULT_OG_IMAGE;
    const getOrCreateMeta = (attribute: 'name' | 'property', value: string) => {
      let metaTag = document.querySelector(`meta[${attribute}="${value}"]`);

      if (!metaTag) {
        metaTag = document.createElement('meta');
        metaTag.setAttribute(attribute, value);
        document.head.appendChild(metaTag);
      }

      return metaTag;
    };
    const descriptionMeta = getOrCreateMeta('name', 'description');
    const ogTitleMeta = getOrCreateMeta('property', 'og:title');
    const ogDescriptionMeta = getOrCreateMeta('property', 'og:description');
    const ogTypeMeta = getOrCreateMeta('property', 'og:type');
    const ogUrlMeta = getOrCreateMeta('property', 'og:url');
    const ogImageMeta = getOrCreateMeta('property', 'og:image');
    const ogSiteNameMeta = getOrCreateMeta('property', 'og:site_name');
    const twitterCardMeta = getOrCreateMeta('name', 'twitter:card');

    document.title = nextTitle;
    descriptionMeta.setAttribute('content', nextDescription);
    ogTitleMeta.setAttribute('content', product.title);
    ogDescriptionMeta.setAttribute('content', nextDescription);
    ogTypeMeta.setAttribute('content', 'product');
    ogUrlMeta.setAttribute('content', currentPageUrl);
    ogImageMeta.setAttribute('content', ogImage);
    ogSiteNameMeta.setAttribute('content', 'Beatelion');
    twitterCardMeta.setAttribute('content', 'summary_large_image');

    trackViewItem({
      itemId: product.id,
      itemName: product.title,
      price: product.price / 100,
    });
    trackPriceViewed({
      productId: product.id,
      productName: product.title,
      value: product.price / 100,
    });

    return () => {
      document.title = previousTitle;
      descriptionMeta.setAttribute('content', previousMetaDescription);
      ogTitleMeta.setAttribute('content', previousOgTitle);
      ogDescriptionMeta.setAttribute('content', previousOgDescription);
      ogTypeMeta.setAttribute('content', previousOgType);
      ogUrlMeta.setAttribute('content', previousOgUrl);
      ogImageMeta.setAttribute('content', previousOgImage);
      ogSiteNameMeta.setAttribute('content', previousOgSiteName);
      twitterCardMeta.setAttribute('content', previousTwitterCard);
    };
  }, [product]);

  const isCurrentTrack = currentTrack?.id === product?.id;
  const hasPreview = Boolean(product?.preview_url?.trim());
  const isPlayingCurrent = hasPreview && isCurrentTrack && isPlaying;
  const isEarlyAccess = isEarlyAccessActive(product?.early_access_until);
  const isEarlyAccessPurchaseLocked = isEarlyAccessLocked(product?.early_access_until, hasPremiumAccess);
  const isCreditEligible = product?.product_type === 'beat' && !product?.is_exclusive && !product?.is_sold;
  const hasEnoughCredits = typeof creditBalance === 'number' && creditBalance >= requiredCredits;
  const isCreditPurchaseDisabled =
    !isAuthenticated ||
    !isCreditEligible ||
    hasPurchasedProduct ||
    isOwnershipLoading ||
    isPurchasingWithCredits ||
    isCreditBalanceLoading ||
    isEarlyAccessPurchaseLocked ||
    !hasEnoughCredits ||
    requiredCredits <= 0;
  const shouldShowGetCreditsCta =
    isAuthenticated &&
    isCreditEligible &&
    !hasPurchasedProduct &&
    !isCreditBalanceLoading &&
    !isEarlyAccessPurchaseLocked &&
    typeof creditBalance === 'number' &&
    creditBalance < requiredCredits;

  const handlePlay = () => {
    if (!product || !hasPreview) return;

    playTrack({
      id: product.id,
      title: product.title,
      audioUrl: product.preview_url!.trim(),
      cover_image_url: product.cover_image_url,
      producerId: product.producer_id,
    });
  };

  const handleAddToCart = async () => {
    if (!product || product.is_sold || isEarlyAccessPurchaseLocked) return;

    trackClickBuy({
      productId: product.id,
      price: product.price / 100,
      productName: product.title,
    });

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
    } catch (e) {
      console.error('Error adding to cart from details page', e);
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleCreditPurchase = async () => {
    if (!product || isEarlyAccessPurchaseLocked) return;

    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: location.pathname } } });
      return;
    }

    setCreditPurchaseError(null);
    setIsPurchasingWithCredits(true);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        'purchase_beat_with_credits',
        {
          p_product_id: product.id,
        },
      );

      if (rpcError) {
        throw rpcError;
      }

      const purchaseResult = ((data as CreditPurchaseResult[] | null) ?? [])[0] ?? null;
      if (!purchaseResult) {
        throw new Error('credit_purchase_failed');
      }
      setHasPurchasedProduct(true);
      trackPurchase({
        transactionId: purchaseResult.purchase_id,
        value: product.price / 100,
        currency: 'EUR',
        itemId: product.id,
        itemName: product.title,
      });
      await refetchCreditBalance();
      toast.success(t('productDetails.creditPurchaseSuccess'));
    } catch (purchaseError) {
      console.error('Error purchasing beat with credits', purchaseError);
      const message = purchaseError instanceof Error ? purchaseError.message : 'credit_purchase_failed';
      const friendlyMessage = mapCreditPurchaseError(message, t);
      setCreditPurchaseError(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      setIsPurchasingWithCredits(false);
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
          <h1 className="text-3xl font-bold text-white mb-3">{t('productDetails.notFoundTitle')}</h1>
          <p className="text-zinc-400 mb-6">{error || t('productDetails.notFoundDescription')}</p>
          <Link to="/beats" className="inline-flex items-center gap-2 text-rose-400 hover:text-rose-300">
            <ArrowLeft className="w-4 h-4" />
            {t('productDetails.backToBeats')}
          </Link>
        </div>
      </div>
    );
  }

  if (!product.price || product.price <= 0) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4">
        <Link
          to={routePrefix === 'exclusives' ? '/exclusives' : routePrefix === 'kits' ? '/kits' : '/beats'}
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('productDetails.backToCatalog')}
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
            <p className="text-sm text-zinc-500 mb-2">{product.producer?.username || t('productDetails.unknownProducer')}</p>
            <h1 className="text-4xl font-bold text-white mb-3">{product.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400 mb-6">
              {isEarlyAccess && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
                  🔥 {t('products.earlyAccess')}
                </span>
              )}
              {product.bpm && <span>{product.bpm} {t('products.bpm')}</span>}
              {product.key_signature && <span>{product.key_signature}</span>}
              {product.genre && <span>{getLocalizedName(product.genre, language)}</span>}
              {product.mood && <span>{getLocalizedName(product.mood, language)}</span>}
            </div>

            <p className="text-zinc-300 leading-relaxed mb-8">
              {product.description || t('productDetails.noDescription')}
            </p>

            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handlePlay}
                disabled={!hasPreview}
                className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={hasPreview ? (isPlayingCurrent ? t('common.pause') : t('common.play')) : t('audio.previewUnavailable')}
              >
                {isPlayingCurrent ? (
                  <Pause className="w-5 h-5 text-zinc-900" fill="currentColor" />
                ) : (
                  <Play className="w-5 h-5 text-zinc-900 ml-0.5" fill="currentColor" />
                )}
              </button>

              <div>
                <span className="text-2xl font-bold text-white">{formatPrice(displayPrice)}</span>
                <div className="mt-1 text-sm text-zinc-400">
                  {formatPrice(displayPrice)} → {requiredCredits} {t('productDetails.creditsLabel')}
                </div>
              </div>
            </div>

            {!hasPreview && (
              <p className="mb-6 text-sm text-zinc-500">{t('audio.previewUnavailable')}</p>
            )}

            <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-400">{t('productDetails.availableCredits')}</p>
                <p className="text-lg font-semibold text-white">
                  {isAuthenticated
                    ? isCreditBalanceLoading
                      ? t('common.loading')
                      : typeof creditBalance === 'number'
                        ? creditBalance
                        : '—'
                    : '—'}
                </p>
              </div>
              {isAuthenticated && creditBalanceError && (
                <p className="mt-2 text-xs text-zinc-500">{t('productDetails.creditBalanceError')}</p>
              )}
              {!isAuthenticated && (
                <p className="mt-2 text-xs text-zinc-500">{t('productDetails.creditPurchaseLogin')}</p>
              )}
            </div>

            {hasPurchasedProduct && (
              <p className="mb-4 text-sm font-medium text-emerald-400">
                {t('productDetails.creditPurchaseAlreadyOwned')}
              </p>
            )}

            {creditPurchaseError && (
              <p className="mb-4 text-sm text-red-400">{creditPurchaseError}</p>
            )}
            {isEarlyAccessPurchaseLocked && (
              <p className="mb-4 text-sm text-amber-300">{t('products.availableSoon')}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {shouldShowGetCreditsCta ? (
                <Button
                  onClick={() => navigate('/pricing')}
                  leftIcon={<Coins className="w-4 h-4" />}
                  variant="secondary"
                >
                  {t('pricing.getCredits')}
                </Button>
              ) : (
                <Button
                  onClick={handleCreditPurchase}
                  isLoading={isPurchasingWithCredits}
                  disabled={isCreditPurchaseDisabled}
                  leftIcon={<Coins className="w-4 h-4" />}
                  variant="secondary"
                >
                  {t('productDetails.buyWithCredits', { count: requiredCredits })}
                </Button>
              )}

              {!product.is_sold && (
                <Button
                  onClick={handleAddToCart}
                  disabled={isEarlyAccessPurchaseLocked}
                  isLoading={isAddingToCart}
                  leftIcon={<ShoppingCart className="w-4 h-4" />}
                  variant={isAuthenticated ? (ctaVariant === 'A' ? 'primary' : 'secondary') : 'outline'}
                >
                  {isEarlyAccessPurchaseLocked
                    ? t('products.availableSoon')
                    : isAuthenticated
                      ? t('products.addToCart')
                      : t('auth.loginButton')}
                </Button>
              )}
            </div>

            {!isAuthenticated && (
              <p className="mt-3 text-xs text-zinc-500">{t('productDetails.creditPurchaseLogin')}</p>
            )}
            {product.is_exclusive && (
              <p className="mt-3 text-xs text-zinc-500">{t('productDetails.creditPurchaseUnavailable')}</p>
            )}
            {!product.is_exclusive && !product.is_sold && isAuthenticated && !isCreditBalanceLoading && typeof creditBalance === 'number' && creditBalance < requiredCredits && (
              <p className="mt-3 text-xs text-zinc-500">
                {t('productDetails.creditPurchaseMissingCredits', { count: missingCredits })}
              </p>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
