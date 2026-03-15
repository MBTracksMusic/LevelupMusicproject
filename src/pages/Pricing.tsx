import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BadgeCheck,
  Check,
  Coins,
  Flame,
  Globe2,
  Music2,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation } from '../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import toast from 'react-hot-toast';
import type { Database } from '../lib/supabase/types';
import { formatPrice } from '../lib/utils/format';

type ProducerTier = 'starter' | 'pro' | 'elite';
type CheckoutTier = 'pro' | 'elite';
const eliteWaitlistSource = 'elite_interest' as unknown as keyof Database['public']['Tables'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
interface PlanItem {
  icon: LucideIcon;
  text: string;
}

interface ProducerPlan {
  tier: ProducerTier;
  max_beats_published: number | null;
  max_battles_created_per_month: number | null;
  commission_rate: number | null;
  stripe_price_id: string | null;
  is_active: boolean;
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  stripe_price_active: boolean | null;
}

const DEFAULT_PLANS: Record<ProducerTier, ProducerPlan> = {
  starter: {
    tier: 'starter',
    max_beats_published: 3,
    max_battles_created_per_month: 1,
    commission_rate: 0.12,
    stripe_price_id: null,
    is_active: true,
    amount_cents: 0,
    currency: 'EUR',
    interval: null,
    stripe_price_active: null,
  },
  pro: {
    tier: 'pro',
    max_beats_published: 10,
    max_battles_created_per_month: 3,
    commission_rate: 0.05,
    stripe_price_id: null,
    is_active: true,
    amount_cents: 1999,
    currency: 'EUR',
    interval: 'month',
    stripe_price_active: null,
  },
  elite: {
    tier: 'elite',
    max_beats_published: null,
    max_battles_created_per_month: null,
    commission_rate: 0.03,
    stripe_price_id: null,
    is_active: true,
    amount_cents: 2999,
    currency: 'EUR',
    interval: 'month',
    stripe_price_active: null,
  },
};

const toNullableNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toNullableString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizePlanTier = (value: unknown): ProducerTier | null => {
  if (value === 'elite') return 'elite';
  if (value === 'pro' || value === 'producteur') return 'pro';
  if (value === 'starter' || value === 'user') return 'starter';
  return null;
};

const buildPlansFromPayload = (payload: unknown) => {
  const nextPlans: Record<ProducerTier, ProducerPlan> = {
    starter: { ...DEFAULT_PLANS.starter },
    pro: { ...DEFAULT_PLANS.pro },
    elite: { ...DEFAULT_PLANS.elite },
  };

  if (!Array.isArray(payload)) return nextPlans;

  payload.forEach((row) => {
    const item = row as Record<string, unknown>;
    const tier = normalizePlanTier(item?.tier);
    if (!tier) return;

    nextPlans[tier] = {
      tier,
      max_beats_published: toNullableNumber(item.max_beats_published),
      max_battles_created_per_month: toNullableNumber(item.max_battles_created_per_month),
      commission_rate: toNullableNumber(item.commission_rate),
      stripe_price_id: toNullableString(item.stripe_price_id),
      is_active: item.is_active !== false,
      amount_cents: toNullableNumber(item.amount_cents) ?? DEFAULT_PLANS[tier].amount_cents,
      currency: toNullableString(item.currency) ?? DEFAULT_PLANS[tier].currency,
      interval: toNullableString(item.interval) ?? DEFAULT_PLANS[tier].interval,
      stripe_price_active: typeof item.stripe_price_active === 'boolean' ? item.stripe_price_active : null,
    };
  });

  return nextPlans;
};

const formatPlanPrice = (
  plan: ProducerPlan,
  freeLabel: string,
  priceUnavailableLabel: string,
  monthlyLabel: string,
) => {
  if (plan.tier === 'starter') {
    return { amount: freeLabel, interval: null as string | null };
  }

  if (
    typeof plan.amount_cents === 'number' &&
    Number.isFinite(plan.amount_cents) &&
    plan.amount_cents >= 0
  ) {
    const amount = formatPrice(plan.amount_cents, plan.currency || 'EUR');
    const interval = plan.interval ? (plan.interval === 'month' ? monthlyLabel : ` / ${plan.interval}`) : null;
    return { amount, interval };
  }

  return { amount: priceUnavailableLabel, interval: null as string | null };
};

interface ProfileWithTier {
  producer_tier?: ProducerTier | null;
}

const toProducerTier = (value: unknown): ProducerTier => {
  return normalizePlanTier(value) ?? 'starter';
};

export function PricingPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [isPlanLoading, setIsPlanLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<ProducerTier, ProducerPlan>>({
    starter: { ...DEFAULT_PLANS.starter },
    pro: { ...DEFAULT_PLANS.pro },
    elite: { ...DEFAULT_PLANS.elite },
  });
  const [isEliteModalOpen, setIsEliteModalOpen] = useState(false);
  const [eliteEmail, setEliteEmail] = useState('');
  const [isEliteSubmitting, setIsEliteSubmitting] = useState(false);
  const currentTier = user
    ? toProducerTier((profile as unknown as ProfileWithTier | null)?.producer_tier)
    : null;
  const proPlan = plans.pro;

  useEffect(() => {
    const fetchPlan = async () => {
      setIsPlanLoading(true);
      setError(null);
      let nextPlans: Record<ProducerTier, ProducerPlan> = {
        starter: { ...DEFAULT_PLANS.starter },
        pro: { ...DEFAULT_PLANS.pro },
        elite: { ...DEFAULT_PLANS.elite },
      };

      try {
        const { data, error: fetchError } = await supabase.functions.invoke('get-producer-plans', {
          body: {},
        });

        if (!fetchError) {
          nextPlans = buildPlansFromPayload((data as { plans?: unknown })?.plans);
        } else {
          console.error('get-producer-plans failed', fetchError, data);
          setError(t('pricing.loadOffersError'));
        }
      } catch (fetchPlansError) {
        console.error('get-producer-plans invoke failed', fetchPlansError);
        setError(t('pricing.loadOffersError'));
      } finally {
        setPlans(nextPlans);
        setIsPlanLoading(false);
      }
    };

    void fetchPlan();
  }, [t]);

  const startCheckout = async (tier: CheckoutTier) => {
    if (!user) {
      navigate('/register', { state: { from: { pathname: '/pricing' } } });
      return;
    }
    const targetPlan = plans[tier];
    if (!targetPlan?.is_active) {
      setError(t('pricing.planUnavailable'));
      return;
    }
    setError(null);
    try {
      const handleSessionExpired = () => {
        setError(t('pricing.sessionExpired'));
      };

      const checkoutPayload = {
        tier,
        success_url: `${window.location.origin}/pricing?status=success`,
        cancel_url: `${window.location.origin}/pricing?status=cancel`,
      };
      const invokeCheckout = () => supabase.functions.invoke('producer-checkout', {
        body: {
          ...checkoutPayload,
        },
      });
      const parseCheckoutError = async (
        fnErrorValue: { status?: number; message?: string; context?: unknown },
        dataValue: unknown,
      ) => {
        const apiPayload = (dataValue && typeof dataValue === 'object')
          ? dataValue as Record<string, unknown>
          : null;
        const apiError = typeof apiPayload?.error === 'string' ? apiPayload.error : null;
        const apiMessage = typeof apiPayload?.message === 'string' ? apiPayload.message : null;
        let contextPayload: Record<string, unknown> | null = null;
        let contextError: string | null = null;
        let contextMessage: string | null = null;
        let contextCode: string | null = null;
        const context = fnErrorValue.context;

        if (context instanceof Response) {
          try {
            const payload = await context.clone().json() as Record<string, unknown>;
            contextPayload = payload;
            contextError = typeof payload.error === 'string' ? payload.error : null;
            contextMessage = typeof payload.message === 'string' ? payload.message : null;
            contextCode = typeof payload.code === 'string' || typeof payload.code === 'number'
              ? String(payload.code)
              : null;
          } catch {
            try {
              const rawText = await context.clone().text();
              contextError = rawText || null;
            } catch {
              contextError = null;
            }
          }
        }

        console.error('producer-checkout error', {
          error: fnErrorValue,
          status: fnErrorValue.status ?? null,
          apiPayload,
          contextPayload,
        });

        const rawError =
          apiError ||
          contextError ||
          apiMessage ||
          contextMessage ||
          contextCode ||
          `${fnErrorValue.status ?? ''} ${fnErrorValue.message || t('pricing.checkoutUnavailable')}`.trim();
        const normalizedRawError = [
          rawError,
          apiError,
          apiMessage,
          contextError,
          contextMessage,
          contextCode,
          fnErrorValue.message,
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' | ')
          .toLowerCase();

        return { rawError, normalizedRawError };
      };
      const isAuthCheckoutError = (normalizedRawError: string) =>
        normalizedRawError.includes('invalid jwt') ||
        normalizedRawError.includes('unauthorized') ||
        normalizedRawError.includes('missing sub claim') ||
        normalizedRawError.includes('missing sub');

      const { data, error: fnError } = await invokeCheckout();

      if (fnError) {
        const parsedError = await parseCheckoutError(fnError, data);

        if (isAuthCheckoutError(parsedError.normalizedRawError)) {
          handleSessionExpired();
          return;
        }

        if (
          parsedError.normalizedRawError.includes('already_subscribed') ||
          parsedError.normalizedRawError.includes('already subscribed')
        ) {
          throw new Error(t('pricing.alreadySubscribed'));
        }
        if (parsedError.normalizedRawError.includes('plan_unavailable')) {
          throw new Error(t('pricing.planUnavailable'));
        }
        if (
          parsedError.normalizedRawError.includes('stripe_price_not_configured') ||
          parsedError.normalizedRawError.includes('stripe price id not configured') ||
          parsedError.normalizedRawError.includes('missing_price_id')
        ) {
          throw new Error(t('pricing.missingPriceId'));
        }
        if (parsedError.normalizedRawError.includes('invalid_tier')) {
          throw new Error(t('pricing.invalidOffer'));
        }
        throw new Error(parsedError.rawError);
      }

      const url = (data as { url?: string })?.url;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error(t('pricing.missingCheckoutUrl'));
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error && err.message
        ? err.message
        : t('pricing.checkoutUnavailable');
      setError(errorMessage);
    }
  };

  const hasActiveProducerSubscription = Boolean(user && profile?.is_producer_active === true);
  const isUserCurrent = Boolean(user) && !hasActiveProducerSubscription;
  const isProCurrent = hasActiveProducerSubscription && currentTier === 'pro';
  const isEliteCurrent = hasActiveProducerSubscription && currentTier === 'elite';
  const proBeatsLimit = typeof proPlan.max_beats_published === 'number' ? proPlan.max_beats_published : 10;
  const proBattlesLimit = typeof proPlan.max_battles_created_per_month === 'number'
    ? proPlan.max_battles_created_per_month
    : 3;
  const starterPlanItems: PlanItem[] = [
    { icon: Music2, text: t('pricing.userItemBuyBeats') },
    { icon: Users, text: t('pricing.userItemVoteComment') },
    { icon: Flame, text: t('pricing.userItemBattleVote') },
    { icon: Globe2, text: t('pricing.userItemPersonalProfile') },
  ];
  const proPlanItems: PlanItem[] = [
    { icon: Music2, text: t('pricing.proItemPublishedBeats', { count: proBeatsLimit }) },
    { icon: Users, text: t('pricing.proItemBattlesPerMonth', { count: proBattlesLimit }) },
    { icon: Flame, text: t('pricing.proItemUnlimitedBattles') },
    { icon: Globe2, text: t('pricing.proItemPublicRanking') },
    { icon: BadgeCheck, text: t('pricing.proItemVerifiedBadge') },
    { icon: BarChart3, text: t('pricing.proItemAdvancedStats') },
    { icon: Coins, text: t('pricing.proItemReducedCommission') },
  ];
  const proPrice = formatPlanPrice(
    proPlan,
    t('pricing.free'),
    t('pricing.priceUnavailable'),
    t('subscription.perMonth'),
  );
  const isProCheckoutAvailable =
    proPlan.is_active;
  const normalizeEmail = (value: string) => value.trim().toLowerCase();

  const addToEliteWaitlist = async (rawEmail: string) => {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_REGEX.test(email)) {
      toast.error(t('pricing.invalidEmail'));
      return false;
    }

    const { error: insertError } = await supabase
      .from(eliteWaitlistSource)
      .insert({ email } as never);

    if (insertError) {
      if ((insertError as { code?: string }).code === '23505') {
        toast.success(t('pricing.eliteAlreadyRegistered'));
        return true;
      }
      console.error('elite waitlist insert error', insertError);
      toast.error(t('pricing.eliteWaitlistError'));
      return false;
    }

    toast.success(t('pricing.eliteWaitlistSuccess'));
    return true;
  };

  const closeEliteModal = () => {
    if (isEliteSubmitting) return;
    setIsEliteModalOpen(false);
  };

  const handleEliteNotifyClick = async () => {
    if (isEliteCurrent || isEliteSubmitting) return;
    const accountEmail = normalizeEmail(profile?.email || user?.email || '');
    setEliteEmail(accountEmail);
    setIsEliteModalOpen(true);
  };

  const handleEliteModalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isEliteSubmitting) return;
    setIsEliteSubmitting(true);
    try {
      const inserted = await addToEliteWaitlist(eliteEmail);
      if (inserted) {
        setIsEliteModalOpen(false);
        setEliteEmail('');
      }
    } finally {
      setIsEliteSubmitting(false);
    }
  };

  const renderPlanItem = (item: PlanItem) => {
    const Icon = item.icon;
    return (
      <li key={item.text} className="flex items-start gap-3">
        <Icon className="w-4 h-4 text-zinc-200 flex-shrink-0 mt-1" />
        <span className="text-zinc-200/95 text-sm">{item.text}</span>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">{t('pricing.title')}</h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            {t('pricing.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="relative h-full flex flex-col border border-emerald-700/60 bg-zinc-900 p-6">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">{t('pricing.userPlanTitle')}</h3>
                <p className="text-zinc-200 font-semibold">{t('pricing.userPlanSubtitle')}</p>
                <p className="text-zinc-400 text-sm mt-1 flex items-start gap-2">
                  <Target className="w-4 h-4 mt-0.5 text-zinc-300" />
                  {t('pricing.userPlanAudience')}
                </p>
              </div>
              {isUserCurrent && <Badge variant="info">{t('subscription.currentPlan')}</Badge>}
            </div>

            <div className="mb-5">
              <span className="text-4xl font-bold text-white">{t('pricing.free')}</span>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-400" />
              <p className="text-xl font-bold text-white">{t('pricing.includedTitle')}</p>
            </div>
            <ul className="space-y-2 mb-6">
              {starterPlanItems.map(renderPlanItem)}
            </ul>

            <div className="mt-auto pt-6">
              {user ? (
                <Button
                  className="w-full"
                  variant="secondary"
                  size="lg"
                  onClick={() => navigate('/dashboard')}
                >
                  {isUserCurrent ? t('subscription.currentPlan') : t('pricing.startFree')}
                </Button>
              ) : (
                <Link to="/register">
                  <Button
                    className="w-full"
                    variant="secondary"
                    size="lg"
                  >
                    {isUserCurrent ? t('subscription.currentPlan') : t('pricing.startFree')}
                  </Button>
                </Link>
              )}
            </div>
          </Card>

          <Card className="relative h-full flex flex-col border border-rose-500 bg-zinc-900 p-6">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">{t('pricing.proPlanTitle')}</h3>
                <p className="text-zinc-200 font-semibold">{t('pricing.proPlanSubtitle')}</p>
                <p className="text-zinc-400 text-sm mt-1 flex items-start gap-2">
                  <Target className="w-4 h-4 mt-0.5 text-zinc-300" />
                  {t('pricing.proPlanAudience')}
                </p>
              </div>
              {isProCurrent && <Badge variant="premium">{t('subscription.currentPlan')}</Badge>}
            </div>

            <div className="mb-6">
              <span className="text-4xl font-bold text-white">{proPrice.amount}</span>
              {proPrice.interval && <span className="text-zinc-400">{proPrice.interval}</span>}
            </div>

            <div className="mb-3 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-400" />
              <p className="text-xl font-bold text-white">{t('pricing.includedShort')}</p>
            </div>
            <ul className="space-y-2 mb-8">
              {proPlanItems.map(renderPlanItem)}
            </ul>

            <div className="mt-auto pt-6">
              {error && (
                <div className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                className="w-full"
                variant="primary"
                size="lg"
                disabled={hasActiveProducerSubscription || isPlanLoading || !isProCheckoutAvailable}
                onClick={() => void startCheckout('pro')}
              >
                {hasActiveProducerSubscription ? t('subscription.currentPlan') : t('pricing.becomeProducer')}
              </Button>
            </div>
          </Card>

          <Card className="relative h-full flex flex-col border border-red-700/60 bg-zinc-900 p-6">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">{t('pricing.elitePlanTitle')}</h3>
                <p className="text-zinc-200 font-semibold">
                  {t('pricing.elitePlanSubtitle')}
                </p>
                <p className="text-zinc-400 text-sm mt-2 flex items-start gap-2">
                  <Target className="w-4 h-4 mt-0.5 text-zinc-300" />
                  {t('pricing.eliteComingSoon')}
                </p>
              </div>
              {isEliteCurrent && <Badge variant="danger">{t('subscription.currentPlan')}</Badge>}
            </div>

            <div className="mt-auto pt-6">
              <Button
                className="w-full"
                variant="outline"
                size="lg"
                disabled={isEliteCurrent || isEliteSubmitting}
                onClick={handleEliteNotifyClick}
              >
                {isEliteCurrent ? t('subscription.currentPlan') : t('pricing.notifyLaunch')}
              </Button>
            </div>
          </Card>
        </div>

        <div className="mt-16 text-center">
          <p className="text-zinc-400 mb-4">{t('pricing.questions')}</p>
          <Link to="/contact">
            <Button variant="ghost">{t('pricing.contactUs')}</Button>
          </Link>
        </div>
      </div>

      <Modal
        isOpen={isEliteModalOpen}
        onClose={closeEliteModal}
        title={t('pricing.eliteWaitlistTitle')}
        description={t('pricing.eliteWaitlistDescription')}
        size="sm"
      >
        <form onSubmit={handleEliteModalSubmit} className="space-y-4">
          <Input
            type="email"
            label={t('common.email')}
            value={eliteEmail}
            onChange={(event) => setEliteEmail(event.target.value)}
            placeholder={t('auth.emailPlaceholder')}
            autoComplete="email"
            required
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={closeEliteModal}
              disabled={isEliteSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" isLoading={isEliteSubmitting}>
              {t('pricing.notifyMe')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
