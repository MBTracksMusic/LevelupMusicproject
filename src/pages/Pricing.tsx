import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BadgeCheck,
  Check,
  Flame,
  Globe2,
  Music2,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation } from '../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { invokeProtectedEdgeFunction } from '../lib/supabase/edgeAuth';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import toast from 'react-hot-toast';
import { trackSubscriptionStart } from '../lib/analytics';
import type { Database } from '../lib/supabase/types';
import { formatDate, formatPrice } from '../lib/utils/format';
import { useUserSubscriptionStatus } from '../lib/subscriptions/useUserSubscriptionStatus';

type ProducerTier = 'starter' | 'pro' | 'elite';
type CheckoutTier = 'pro' | 'elite';
const eliteWaitlistSource = 'elite_interest' as unknown as keyof Database['public']['Tables'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
interface PlanItem {
  icon: LucideIcon;
  text: string;
  helperText?: string;
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
    commission_rate: 0.3,
    stripe_price_id: null,
    is_active: true,
    amount_cents: 0,
    currency: 'EUR',
    interval: null,
    stripe_price_active: null,
  },
  pro: {
    tier: 'pro',
    max_beats_published: null,
    max_battles_created_per_month: 5,
    commission_rate: 0.3,
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
    commission_rate: 0.3,
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
  const { user, session, profile } = useAuth();
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
  const [isUserCheckoutLoading, setIsUserCheckoutLoading] = useState(false);
  const [isUserSubscriptionSyncPending, setIsUserSubscriptionSyncPending] = useState(false);
  const {
    subscription: userSubscription,
    isActive: hasActiveUserSubscription,
    isLoading: isUserSubscriptionLoading,
    refetch: refetchUserSubscription,
  } = useUserSubscriptionStatus(user?.id);
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
        const { data: { session } } = await supabase.auth.getSession();
        console.log('get-producer-plans token:', session?.access_token ? 'YES' : 'NO');

        const { data, error: fetchError } = await supabase.functions.invoke('get-producer-plans', {
          headers: session?.access_token ? {
            Authorization: `Bearer ${session.access_token}`,
          } : {},
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const producerStatus = params.get('status');
    const userStatus = params.get('user_subscription');

    if (producerStatus !== 'success' && userStatus !== 'success') {
      return;
    }

    void (async () => {
      if (!user?.id) {
        return;
      }

      if (producerStatus === 'success') {
        const { data, error: subscriptionError } = await supabase
          .from('producer_subscriptions')
          .select('stripe_subscription_id, subscription_status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (subscriptionError) {
          console.error('Error loading producer subscription for analytics:', subscriptionError);
        } else if (data && ['active', 'trialing'].includes((data as { subscription_status?: string }).subscription_status ?? '')) {
          const plan = window.sessionStorage.getItem('ga_pending_producer_plan') || 'producer';
          const rawValue = Number(window.sessionStorage.getItem('ga_pending_producer_value') || '0');
          trackSubscriptionStart({
            plan,
            value: Number.isFinite(rawValue) ? rawValue : 0,
            subscriptionId: (data as { stripe_subscription_id: string | null }).stripe_subscription_id,
          });
        }
      }

      if (userStatus === 'success') {
        const isActive = ['active', 'trialing'].includes(userSubscription?.subscription_status ?? '');

        if (userSubscription?.id && isActive) {
          const rawValue = Number(window.sessionStorage.getItem('ga_pending_user_subscription_value') || '9.99');
          trackSubscriptionStart({
            plan: userSubscription.plan_code || 'user_premium',
            value: Number.isFinite(rawValue) ? rawValue : 9.99,
            subscriptionId: userSubscription.id,
          });
        }
      }

      window.sessionStorage.removeItem('ga_pending_producer_plan');
      window.sessionStorage.removeItem('ga_pending_producer_value');
      window.sessionStorage.removeItem('ga_pending_user_subscription_value');
    })();
  }, [user?.id, userSubscription?.id, userSubscription?.plan_code, userSubscription?.subscription_status]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userStatus = params.get('user_subscription');

    if (userStatus !== 'success' || !user?.id || hasActiveUserSubscription) {
      setIsUserSubscriptionSyncPending(false);
      return;
    }

    let isCancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;

    setIsUserSubscriptionSyncPending(true);

    const pollSubscriptionStatus = async () => {
      const nextSubscription = await refetchUserSubscription();

      if (isCancelled) {
        return;
      }

      const isActive = ['active', 'trialing'].includes(nextSubscription?.subscription_status ?? '');
      if (isActive) {
        setIsUserSubscriptionSyncPending(false);
        return;
      }

      attempts += 1;
      if (attempts >= 5) {
        setIsUserSubscriptionSyncPending(false);
        return;
      }

      timeoutId = window.setTimeout(() => {
        void pollSubscriptionStatus();
      }, 2000);
    };

    timeoutId = window.setTimeout(() => {
      void pollSubscriptionStatus();
    }, 2000);

    return () => {
      isCancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [user?.id, hasActiveUserSubscription, refetchUserSubscription]);

  const startCheckout = async (tier: CheckoutTier) => {
    if (!user) {
      navigate('/register', { state: { from: { pathname: '/pricing' } } });
      return;
    }
    if (hasActiveUserSubscription) {
      setError(t('pricing.userSubscriptionBlocksProducerPlan'));
      return;
    }
    if (!session?.access_token) {
      setError(t('pricing.sessionExpired'));
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
      const isAuthCheckoutError = (normalizedRawError: string) =>
        normalizedRawError.includes('invalid jwt') ||
        normalizedRawError.includes('unauthorized') ||
        normalizedRawError.includes('missing sub claim') ||
        normalizedRawError.includes('missing sub');

      let data: { url?: string } | null = null;
      try {
        data = await invokeProtectedEdgeFunction<{ url?: string }>('producer-checkout', {
          body: checkoutPayload,
        });
      } catch (invokeError) {
        const rawError = invokeError instanceof Error ? invokeError.message : t('pricing.checkoutUnavailable');
        const normalizedRawError = rawError.toLowerCase();

        if (isAuthCheckoutError(normalizedRawError)) {
          handleSessionExpired();
          return;
        }

        if (
          normalizedRawError.includes('already_subscribed') ||
          normalizedRawError.includes('already subscribed')
        ) {
          throw new Error(t('pricing.alreadySubscribed'));
        }
        if (
          normalizedRawError.includes('subscription_conflict_user_active') ||
          normalizedRawError.includes('already_subscribed_other_plan')
        ) {
          throw new Error(t('pricing.userSubscriptionBlocksProducerPlan'));
        }
        if (normalizedRawError.includes('plan_unavailable')) {
          throw new Error(t('pricing.planUnavailable'));
        }
        if (
          normalizedRawError.includes('stripe_price_not_configured') ||
          normalizedRawError.includes('stripe price id not configured') ||
          normalizedRawError.includes('missing_price_id')
        ) {
          throw new Error(t('pricing.checkoutUnavailable'));
        }
        if (normalizedRawError.includes('invalid_tier')) {
          throw new Error(t('pricing.invalidOffer'));
        }
        throw invokeError;
      }

      const url = data?.url;
      if (url) {
        window.sessionStorage.setItem('ga_pending_producer_plan', tier);
        window.sessionStorage.setItem('ga_pending_producer_value', String((targetPlan.amount_cents ?? 0) / 100));
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

  const startUserSubscriptionCheckout = async () => {
    if (!user) {
      navigate('/register', { state: { from: { pathname: '/pricing' } } });
      return;
    }

    if (hasActiveProducerSubscription) {
      setError(t('pricing.producerSubscriptionBlocksUserPlan'));
      return;
    }

    if (hasActiveUserSubscription || isUserCheckoutLoading) {
      return;
    }

    if (!session?.access_token) {
      setError(t('pricing.sessionExpired'));
      return;
    }

    setError(null);
    setIsUserCheckoutLoading(true);

    try {
      const data = await invokeProtectedEdgeFunction<{ url?: string }>('create-checkout', {
        body: {
          subscription_kind: 'user',
          successUrl: `${window.location.origin}/pricing?user_subscription=success`,
          cancelUrl: `${window.location.origin}/pricing?user_subscription=cancel`,
        },
      });

      if (!data?.url) {
        throw new Error(t('pricing.userCheckoutUnavailable'));
      }

      window.sessionStorage.setItem('ga_pending_user_subscription_value', '9.99');
      window.location.href = data.url;
    } catch (checkoutError) {
      console.error('User subscription checkout failed', checkoutError);
      const rawMessage = checkoutError instanceof Error ? checkoutError.message.toLowerCase() : '';

      if (
        rawMessage.includes('already_subscribed_user') ||
        rawMessage.includes('already subscribed')
      ) {
        setError(t('pricing.userSubscriptionActive'));
      } else if (rawMessage.includes('subscription_conflict_producer_active')) {
        setError(t('pricing.producerSubscriptionBlocksUserPlan'));
      } else if (
        rawMessage.includes('missing_user_subscription_price_id') ||
        rawMessage.includes('invalid_user_subscription_price')
      ) {
        setError(t('pricing.userCheckoutUnavailable'));
      } else if (
        rawMessage.includes('invalid jwt') ||
        rawMessage.includes('unauthorized') ||
        rawMessage.includes('missing sub claim')
      ) {
        setError(t('pricing.sessionExpired'));
      } else {
        setError(t('pricing.userCheckoutUnavailable'));
      }
    } finally {
      setIsUserCheckoutLoading(false);
    }
  };

  const hasActiveProducerSubscription = Boolean(user && profile?.is_producer_active === true);
  const isBlockedByUserSubscription = hasActiveUserSubscription && !hasActiveProducerSubscription;
  const isBlockedByProducerSubscription = hasActiveProducerSubscription && !hasActiveUserSubscription;
  const isUserCurrent = Boolean(user) && !hasActiveProducerSubscription && !hasActiveUserSubscription;
  const isProCurrent = hasActiveProducerSubscription && currentTier === 'pro';
  const isEliteCurrent = hasActiveProducerSubscription && currentTier === 'elite';
  const proBattlesLimit = typeof proPlan.max_battles_created_per_month === 'number'
    ? proPlan.max_battles_created_per_month
    : 5;
  const starterPlanItems: PlanItem[] = [
    { icon: Music2, text: t('pricing.userItemBuyBeats') },
    { icon: Users, text: t('pricing.userItemVoteComment') },
    { icon: Flame, text: t('pricing.userItemBattleVote') },
    { icon: Globe2, text: t('pricing.userItemPersonalProfile') },
  ];
  const userPremiumPlanItems: PlanItem[] = [
    { icon: Music2, text: t('pricing.userPremiumItemCreditsPerMonth') },
    { icon: BadgeCheck, text: t('pricing.userPremiumItemPremiumBeats') },
    { icon: Check, text: t('pricing.userPremiumItemInstantPurchase') },
    {
      icon: Users,
      text: t('pricing.userPremiumItemCreditsCap'),
      helperText: t('pricing.userPremiumItemCreditsCapHelper'),
    },
    { icon: Flame, text: t('pricing.userPremiumItemPriorityAccess') },
  ];
  const proPlanItems: PlanItem[] = [
    { icon: Music2, text: t('pricing.proItemUnlimitedUploads') },
    { icon: Users, text: t('pricing.proItemBattlesPerMonth', { count: proBattlesLimit }) },
    { icon: Flame, text: t('pricing.proItemUnlimitedBattles') },
    { icon: Globe2, text: t('pricing.proItemPublicRanking') },
    { icon: BadgeCheck, text: t('pricing.proItemVerifiedBadge') },
    { icon: BarChart3, text: t('pricing.proItemAdvancedStats') },
    { icon: Target, text: t('pricing.proItemTopBeatsBoost') },
    { icon: TrendingUp, text: t('pricing.proItemRevenueShare') },
  ];
  const proPrice = formatPlanPrice(
    proPlan,
    t('pricing.free'),
    t('pricing.priceUnavailable'),
    t('subscription.perMonth'),
  );
  const isProCheckoutAvailable =
    proPlan.is_active;
  const userPremiumPrice = formatPrice(999, 'EUR');
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
        <div>
          <span className="text-zinc-200/95 text-sm">{item.text}</span>
          {item.helperText ? (
            <p className="mt-1 text-xs text-zinc-400">{item.helperText}</p>
          ) : null}
        </div>
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

        <div className="grid items-stretch gap-6 md:grid-cols-3">
          <Card className="flex h-full flex-col justify-between border border-emerald-700/60 bg-zinc-900 p-6 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:shadow-black/20">
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

            <div className="pt-6">
              {user ? (
                <Button
                  className="mt-auto w-full"
                  variant="secondary"
                  size="lg"
                  onClick={() => navigate('/dashboard')}
                >
                  {isUserCurrent ? t('subscription.currentPlan') : t('nav.dashboard')}
                </Button>
              ) : (
                <Link to="/register">
                  <Button
                    className="mt-auto w-full"
                    variant="secondary"
                    size="lg"
                  >
                    {isUserCurrent ? t('subscription.currentPlan') : t('pricing.startFree')}
                  </Button>
                </Link>
              )}
            </div>
          </Card>

          <Card className="flex h-full flex-col justify-between border border-sky-500/60 bg-zinc-900 p-6 shadow-md shadow-sky-900/20 transition-all duration-300 hover:-translate-y-2 hover:scale-[1.02] hover:shadow-xl hover:shadow-sky-950/30">
            <div className="mb-3 flex justify-center">
              <span className="rounded-full bg-gradient-to-r from-pink-500 to-orange-500 px-3 py-1 text-xs font-semibold text-white shadow-md">
                {t('pricing.userPremiumPopular')}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">{t('pricing.userPremiumTitle')}</h3>
                <p className="text-zinc-200 font-semibold">{t('pricing.userPremiumSubtitle')}</p>
                <p className="text-zinc-400 text-sm mt-1 flex items-start gap-2">
                  <Target className="w-4 h-4 mt-0.5 text-zinc-300" />
                  {t('pricing.userPremiumAudience')}
                </p>
              </div>
              {hasActiveUserSubscription && <Badge variant="success">{t('pricing.userSubscriptionActiveBadge')}</Badge>}
            </div>

            <div className="mb-6">
              <span className="text-4xl font-bold text-white">{userPremiumPrice}</span>
              <span className="text-zinc-400"> {t('subscription.perMonth')}</span>
            </div>

            <div className="mb-6 rounded-xl border border-sky-400/20 bg-sky-500/10 p-4">
              <p className="text-sm font-semibold text-white">
                {t('pricing.userPremiumValueLine')}
              </p>
              <p className="mt-1 text-xs text-sky-100/80">
                {t('pricing.userPremiumValueHint')}
              </p>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-400" />
              <p className="text-xl font-bold text-white">{t('pricing.includedShort')}</p>
            </div>
            <ul className="space-y-2 mb-6">
              {userPremiumPlanItems.map(renderPlanItem)}
            </ul>

            {hasActiveUserSubscription && (
              <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                <p className="font-medium">{t('pricing.userSubscriptionActive')}</p>
                <p className="mt-1 text-emerald-100/80">
                  {t('pricing.userSubscriptionRenewal', {
                    date: userSubscription?.current_period_end
                      ? formatDate(userSubscription.current_period_end)
                      : t('common.notAvailable'),
                  })}
                </p>
              </div>
            )}

            {isUserSubscriptionSyncPending && !hasActiveUserSubscription && (
              <div className="mb-6 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                <p className="font-medium">{t('checkout.success')}</p>
                <p className="mt-1 text-sky-100/80">{t('checkout.processing')}</p>
              </div>
            )}

            {isBlockedByProducerSubscription && (
              <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p className="font-medium">{t('pricing.producerSubscriptionBlocksUserPlan')}</p>
              </div>
            )}

            <div className="pt-6">
              {error && (
                <div className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                className="mt-auto w-full"
                variant="primary"
                size="lg"
                isLoading={isUserCheckoutLoading}
                disabled={hasActiveUserSubscription || isBlockedByProducerSubscription || isUserSubscriptionLoading || isUserCheckoutLoading}
                onClick={() => void startUserSubscriptionCheckout()}
              >
                {hasActiveUserSubscription ? t('pricing.userSubscriptionActiveBadge') : t('pricing.subscribeUser')}
              </Button>
            </div>
          </Card>

          <Card className="flex h-full flex-col justify-between border border-rose-500 bg-zinc-900 p-6 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:shadow-black/20">
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
            <p className="text-sm text-zinc-400 mb-8">
              {t('pricing.proVisibilityHint')}
            </p>

            {isBlockedByUserSubscription && (
              <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p className="font-medium">{t('pricing.userSubscriptionBlocksProducerPlan')}</p>
              </div>
            )}

            <div className="pt-6">
              {error && (
                <div className="mb-4 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                className="mt-auto w-full"
                variant="primary"
                size="lg"
                disabled={hasActiveProducerSubscription || isBlockedByUserSubscription || isPlanLoading || !isProCheckoutAvailable}
                onClick={() => void startCheckout('pro')}
              >
                {hasActiveProducerSubscription ? t('subscription.currentPlan') : t('pricing.becomeProducer')}
              </Button>
            </div>
          </Card>

          <Card className="flex h-full flex-col justify-between border border-red-700/60 bg-zinc-900 p-6">
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

            <div className="pt-6">
              <Button
                className="mt-auto w-full"
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
