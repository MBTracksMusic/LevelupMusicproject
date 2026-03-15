import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Music, ShoppingCart, Trash2, AlertCircle } from 'lucide-react';
import { useCartStore } from '../lib/stores/cart';
import { useTranslation } from '../lib/i18n';
import { formatPrice } from '../lib/utils/format';
import { Button } from '../components/ui/Button';
import { LogoLoader } from '../components/ui/LogoLoader';
import { supabase } from '../lib/supabase/client';

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseCheckoutErrorMessage = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  return asNonEmptyString(record.error) || asNonEmptyString(record.message);
};

const toEdgeInvokeErrorMessage = async (error: unknown) => {
  if (!error || typeof error !== 'object') return null;

  const message = 'message' in error
    ? asNonEmptyString((error as { message?: unknown }).message)
    : null;
  const context = 'context' in error
    ? (error as { context?: unknown }).context
    : null;

  if (!(context instanceof Response)) {
    return message;
  }

  try {
    const payload = await context.clone().json() as Record<string, unknown>;
    return parseCheckoutErrorMessage(payload) || message;
  } catch {
    try {
      const text = asNonEmptyString(await context.clone().text());
      return text || message;
    } catch {
      return message;
    }
  }
};

export function CartPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { items, isLoading, fetchCart, removeFromCart, clearCart, getTotal } = useCartStore();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');

    if (status !== 'success') return;

    void (async () => {
      try {
        await clearCart();
      } catch (error) {
        console.error('Error clearing cart after successful checkout:', error);
      } finally {
        localStorage.removeItem('cart');
        navigate('/', { replace: true });
      }
    })();
  }, [clearCart, navigate]);

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  const total = getTotal();
  const hasItems = items.length > 0;
  const isSingleItemCheckout = items.length === 1;
  const firstItem = items[0];

  const handleRemove = async (productId: string) => {
    setRemovingId(productId);
    try {
      await removeFromCart(productId);
    } finally {
      setRemovingId(null);
    }
  };

  const handleCheckout = async () => {
    if (!isSingleItemCheckout) {
      setCheckoutError(t('checkout.singleItemOnly'));
      return;
    }

    if (!firstItem) return;

    setCheckoutError(null);
    setIsCheckoutLoading(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        console.error('No active session', sessionError);
        setCheckoutError('Please login again');
        alert('Please login again');
        return;
      }

      const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshedData.session) {
        console.error('Checkout session refresh error:', refreshError);
        setCheckoutError('Please login again');
        alert('Please login again');
        return;
      }

      const { data, error } = await supabase.functions.invoke<{ url?: string }>('create-checkout', {
        body: {
          beatId: firstItem.product_id,
          licenseType: firstItem.license_type,
          successUrl: `${window.location.origin}/checkout/success`,
          cancelUrl: `${window.location.origin}/checkout/cancel`,
        },
      });

      if (error) {
        const message = await toEdgeInvokeErrorMessage(error);
        console.error('Checkout error:', message || error);
        setCheckoutError(message || 'Unable to start checkout. Please try again.');
        alert(message || 'Unable to start checkout. Please try again.');
        return;
      }

      const url = asNonEmptyString(data?.url);
      if (url) {
        window.location.href = url;
      } else {
        throw new Error(t('checkout.paymentUrlMissing'));
      }
    } catch (err) {
      setCheckoutError((err as Error).message);
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-rose-400/80">{t('checkout.title')}</p>
          <h1 className="text-3xl font-bold text-white mt-2">{t('checkout.cart')}</h1>
        </div>

        <Link to="/beats">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
          >
            {t('checkout.continueShopping')}
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <LogoLoader label={t('common.loading')} />
        </div>
      ) : !hasItems ? (
        <div className="min-h-[40vh] border border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-4 bg-zinc-900/40">
          <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
            <ShoppingCart className="w-6 h-6 text-zinc-400" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-semibold text-white">{t('checkout.emptyCart')}</h2>
            <p className="text-sm text-zinc-500 mt-1">{t('checkout.continueShopping')}</p>
          </div>
          <Link to="/beats">
            <Button size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
              {t('checkout.continueShopping')}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex gap-4 p-4 bg-zinc-900 border border-zinc-800 rounded-xl"
              >
                {item.product?.cover_image_url ? (
                  <img
                    src={item.product.cover_image_url}
                    alt={item.product.title}
                    className="w-20 h-20 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-zinc-800 flex items-center justify-center">
                    <Music className="w-6 h-6 text-zinc-500" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-white font-semibold truncate">
                        {item.product?.title || t('errors.productNotAvailable')}
                      </h3>
                      <p className="text-sm text-zinc-400 truncate">
                        {item.product?.producer?.username || t('checkout.unknownProducer')}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {item.product?.product_type === 'kit' ? t('checkout.itemKit') : t('checkout.itemBeat')}
                        {item.product?.bpm && <span>{item.product.bpm} {t('products.bpm')}</span>}
                        {item.product?.key_signature && <span>{item.product.key_signature}</span>}
                        <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-rose-300">
                          {item.license_type}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-white">
                        {formatPrice(item.product?.price || 0)}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 text-rose-400 hover:text-rose-300"
                        onClick={() => handleRemove(item.product_id)}
                        isLoading={removingId === item.product_id}
                        leftIcon={<Trash2 className="w-4 h-4" />}
                      >
                        {t('checkout.remove')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 h-max lg:sticky lg:top-24">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" /> {t('checkout.orderSummary')}
            </h3>

            {checkoutError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            {items.length > 1 && (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {t('checkout.singleItemOnly')}
              </div>
            )}

            <div className="flex items-center justify-between text-sm text-zinc-400 mb-3">
              <span>{t('checkout.subtotal')}</span>
              <span className="text-white">{formatPrice(total)}</span>
            </div>

            <div className="border-t border-zinc-800 pt-4 mt-4 flex items-center justify-between">
              <span className="text-base text-zinc-300">{t('checkout.total')}</span>
              <span className="text-2xl font-bold text-white">{formatPrice(total)}</span>
            </div>

            <Button
              className="w-full mt-6"
              size="lg"
              leftIcon={<ArrowRight className="w-4 h-4" />}
              disabled={!hasItems || isCheckoutLoading || !isSingleItemCheckout}
              isLoading={isCheckoutLoading}
              onClick={handleCheckout}
            >
              {t('checkout.proceedToCheckout')}
            </Button>
            <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
              {t('checkout.exclusiveWarning')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
