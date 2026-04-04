import { useState } from 'react';
import { Crown, Lock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n';
import { invokeProtectedEdgeFunction } from '@/lib/supabase/edgeAuth';
import toast from 'react-hot-toast';

interface FoundingTrialExpiredPaywallProps {
  /** Afficher en mode overlay plein écran (défaut) ou en mode inline */
  variant?: 'overlay' | 'inline';
}

export function FoundingTrialExpiredPaywall({
  variant = 'overlay',
}: FoundingTrialExpiredPaywallProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      const data = await invokeProtectedEdgeFunction<{ url?: string }>(
        'producer-checkout',
        { tier: 'pro' },
      );
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error(t('errors.checkoutFailed'));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // founding_trial_active ne devrait jamais arriver ici (trial expiré),
      // mais on le gère proprement au cas où.
      if (message.includes('founding_trial_active')) {
        toast.error(t('founding.trialStillActive'));
      } else {
        toast.error(t('errors.checkoutFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const content = (
    <div className="flex flex-col items-center text-center space-y-6 p-8 max-w-md w-full">
      <div className="rounded-full bg-yellow-400/10 p-4">
        <Crown className="text-yellow-400" size={40} />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">
          {t('founding.trialExpiredTitle')}
        </h2>
        <p className="text-gray-400 text-sm">
          {t('founding.trialExpiredSubtitle')}
        </p>
      </div>

      <div className="w-full rounded-xl bg-white/5 border border-white/10 p-4 space-y-2">
        <p className="text-gray-300 text-sm">
          {t('founding.continueWith')}
        </p>
        <p className="text-3xl font-bold text-white">
          19,99€<span className="text-base font-normal text-gray-400">/mois</span>
        </p>
      </div>

      <Button
        onClick={handleSubscribe}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 py-3 text-base"
      >
        {isLoading ? t('common.loading') : t('founding.subscribeCta')}
        {!isLoading && <ArrowRight size={18} />}
      </Button>

      <div className="flex items-center gap-2 text-gray-500 text-xs">
        <Lock size={12} />
        <span>{t('founding.readAccessRemains')}</span>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className="flex items-center justify-center min-h-[400px] rounded-2xl bg-gray-900 border border-white/10">
        {content}
      </div>
    );
  }

  // overlay : bloque la page entière, ne bloque pas la lecture (le composant est
  // monté uniquement sur les pages qui nécessitent canSell / canCreateBattle)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-2xl border border-white/10 shadow-2xl">
        {content}
      </div>
    </div>
  );
}
