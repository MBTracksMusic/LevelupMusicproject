import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Zap, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/auth/hooks';
import { supabase } from '../lib/supabase/client';

const featureLabels: Record<string, { fr: string; en: string; de: string }> = {
  uploads: {
    fr: '{value} uploads/mois',
    en: '{value} uploads/month',
    de: '{value} Uploads/Monat',
  },
  analytics_basic: {
    fr: 'Statistiques de base',
    en: 'Basic analytics',
    de: 'Grundlegende Statistiken',
  },
  analytics: {
    fr: 'Statistiques avancees',
    en: 'Advanced analytics',
    de: 'Erweiterte Statistiken',
  },
  battles_basic: {
    fr: 'Participation aux battles (1/mois)',
    en: 'Battle participation (1/month)',
    de: 'Battle-Teilnahme (1/Monat)',
  },
  battles: {
    fr: 'Participation illimitee aux battles',
    en: 'Unlimited battle participation',
    de: 'Unbegrenzte Battle-Teilnahme',
  },
  exclusive: {
    fr: 'Vente de beats exclusifs',
    en: 'Sell exclusive beats',
    de: 'Exklusive Beats verkaufen',
  },
  promotion: {
    fr: 'Mise en avant sur la page daccueil',
    en: 'Homepage featured placement',
    de: 'Platzierung auf der Startseite',
  },
  promotion_premium: {
    fr: 'Mise en avant premium + newsletter',
    en: 'Premium placement + newsletter',
    de: 'Premium-Platzierung + Newsletter',
  },
  support_email: {
    fr: 'Support par email',
    en: 'Email support',
    de: 'E-Mail-Support',
  },
  priority: {
    fr: 'Support prioritaire',
    en: 'Priority support',
    de: 'Prioritats-Support',
  },
  priority_vip: {
    fr: 'Support VIP 24/7',
    en: 'VIP 24/7 support',
    de: 'VIP 24/7-Support',
  },
  account_manager: {
    fr: 'Account manager dedie',
    en: 'Dedicated account manager',
    de: 'Dedizierter Account Manager',
  },
  api_access: {
    fr: 'Acces API',
    en: 'API access',
    de: 'API-Zugang',
  },
  anti_fraud: {
    fr: 'Contrôles anti-fraude côté serveur',
    en: 'Server-side anti-fraud checks',
    de: 'Serverseitige Betrugsprüfung',
  },
  stripe_webhooks: {
    fr: 'Abonnement géré 100% via Stripe + webhooks',
    en: 'Subscription managed 100% via Stripe + webhooks',
    de: 'Abo komplett über Stripe + Webhooks verwaltet',
  },
  server_first: {
    fr: 'Règles métier exécutées côté serveur uniquement',
    en: 'Business rules enforced server-side only',
    de: 'Geschäftslogik ausschließlich serverseitig',
  },
};

export function PricingPage() {
  const { t, language } = useTranslation();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{
    stripe_price_id: string;
    amount_cents: number;
    currency: string;
  } | null>(null);

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  const getFeatureLabel = (feature: string | { key: string; value: string }) => {
    if (typeof feature === 'object') {
      const label = featureLabels[feature.key]?.[language as keyof typeof featureLabels['uploads']] || feature.key;
      return label.replace('{value}', feature.value);
    }
    return featureLabels[feature]?.[language as keyof typeof featureLabels['uploads']] || feature;
  };

  useEffect(() => {
    const fetchPlan = async () => {
      setIsLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('producer_plan_config')
        .select('stripe_price_id, amount_cents, currency')
        .maybeSingle();

      if (fetchError || !data) {
        setError('Impossible de charger le plan producteur. Réessayez plus tard.');
        setIsLoading(false);
        return;
      }

      setPlan({
        stripe_price_id: data.stripe_price_id,
        amount_cents: data.amount_cents,
        currency: data.currency || 'EUR',
      });
      setIsLoading(false);
    };

    fetchPlan();
  }, []);

  const startCheckout = async () => {
    if (!plan) return;
    if (!user) {
      navigate('/login', { state: { from: '/pricing' } });
      return;
    }
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error('Session expirée. Merci de vous reconnecter.');
      }

      const headers: Record<string, string> = {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
        'x-supabase-auth': `Bearer ${accessToken}`,
      };

      const { data, error: fnError } = await supabase.functions.invoke('producer-checkout', {
        body: {
          price_id: plan.stripe_price_id,
          success_url: `${window.location.origin}/pricing?status=success`,
          cancel_url: `${window.location.origin}/pricing?status=cancel`,
        },
        headers,
        jwt: accessToken, // force Authorization: Bearer <user token> pour la gateway
      });

      if (fnError) {
        console.error('producer-checkout error', fnError, data);
        const apiError = (data as { error?: string })?.error;
        const contextError = (fnError as unknown as { context?: { response?: { error?: string } } })
          ?.context?.response?.error;
        throw new Error(
          apiError ||
          contextError ||
          `${fnError.status ?? ''} ${fnError.message || 'Checkout indisponible pour le moment.'}`.trim()
        );
      }

      const url = (data as { url?: string })?.url;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('URL de paiement manquante.');
      }
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  };

  const isCurrentPlan = profile?.subscription_status === 'active' && profile?.is_producer_active;

  const singlePlanFeatures: Array<string | { key: string; value: string }> = [
    { key: 'uploads', value: 'Illimité' },
    'analytics',
    'battles',
    'exclusive',
    'promotion',
    'priority',
    'anti_fraud',
    'stripe_webhooks',
    'server_first',
  ];

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">
            {t('subscription.title')}
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            {t('subscription.subtitle')}
          </p>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="relative bg-zinc-900 rounded-2xl border border-rose-500 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-center text-sm py-1 font-medium">
              Accès producteur (unique)
            </div>

            <div className="p-8 pt-12">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
                    <Zap className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">Producer Subscription</h3>
                    <p className="text-zinc-400 text-sm">
                      Abonnement mensuel unique, géré intégralement côté serveur (Stripe + webhooks).
                    </p>
                  </div>
                </div>
                <Badge variant="success">Mensuel</Badge>
              </div>

              <div className="mb-6">
                {isLoading ? (
                  <span className="text-zinc-400">Chargement du tarif...</span>
                ) : plan ? (
                  <>
                    <span className="text-4xl font-bold text-white">
                      {formatPrice(plan.amount_cents)}
                    </span>
                    <span className="text-zinc-400"> {t('subscription.perMonth')}</span>
                  </>
                ) : (
                  <span className="text-red-400 text-sm">{error}</span>
                )}
              </div>

              <ul className="space-y-3 mb-8">
                {singlePlanFeatures.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span className="text-zinc-300">
                      {getFeatureLabel(feature)}
                    </span>
                  </li>
                ))}
              </ul>

              {error && (
                <div className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {user ? (
                <Button
                  className="w-full"
                  variant="primary"
                  size="lg"
                  disabled={isCurrentPlan || isLoading || !plan}
                  onClick={startCheckout}
                >
                  {isCurrentPlan
                    ? t('subscription.currentPlan')
                    : t('subscription.subscribe')}
                </Button>
              ) : (
                <Link to="/register">
                  <Button
                    className="w-full"
                    variant="primary"
                    size="lg"
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    disabled={isLoading || !plan}
                  >
                    {t('nav.register')}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="mt-16 text-center">
          <p className="text-zinc-400 mb-4">
            Des questions sur nos offres ?
          </p>
          <Link to="/contact">
            <Button variant="ghost">Contactez-nous</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
