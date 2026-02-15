import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Music, ShoppingCart, Trash2, AlertCircle } from 'lucide-react';
import { useCartStore } from '../lib/stores/cart';
import { useTranslation } from '../lib/i18n';
import { formatPrice } from '../lib/utils/format';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabase/client';

export function CartPage() {
  const { t } = useTranslation();
  const { items, isLoading, fetchCart, removeFromCart, getTotal } = useCartStore();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  const total = getTotal();
  const hasItems = items.length > 0;
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
    if (!firstItem) return;

    setCheckoutError(null);
    setIsCheckoutLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error('Session expirée, merci de vous reconnecter.');
      }

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          productId: firstItem.product_id,
          licenseType: firstItem.license_type,
          successUrl: `${window.location.origin}/cart?status=success`,
          cancelUrl: `${window.location.origin}/cart?status=cancel`,
        },
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) {
        const apiError = (data as { error?: string })?.error;
        throw new Error(apiError || error.message || 'Impossible de démarrer le paiement.');
      }

      const url = (data as { url?: string })?.url;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('URL de paiement introuvable.');
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
          <div className="w-10 h-10 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
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
                        {item.product?.producer?.username || 'Unknown'}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {item.product?.product_type === 'kit' ? 'Kit' : 'Beat'}
                        {item.product?.bpm && <span>{item.product.bpm} BPM</span>}
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
              disabled={!hasItems || isCheckoutLoading}
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
