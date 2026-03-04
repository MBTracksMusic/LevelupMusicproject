import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { useTranslation } from '../../../lib/i18n';
import { formatNumber, formatPrice } from '../../../lib/utils/format';
import type {
  AdminBusinessMetrics,
  AdminPilotageDeltas,
  AdminPilotageMetrics,
} from './types';

function formatCents(value: number) {
  return formatPrice(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)} %`;
}

interface DeltaBadgeProps {
  delta: number | null;
}

function DeltaBadge({ delta }: DeltaBadgeProps) {
  const { t } = useTranslation();

  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-zinc-900 text-zinc-400 border-zinc-700">
        <Minus className="w-3 h-3" />
        {t('common.notAvailable')}
      </span>
    );
  }

  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
        <ArrowUpRight className="w-3 h-3" />
        {formatPercent(delta)}
      </span>
    );
  }

  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-red-500/10 text-red-300 border-red-500/30">
        <ArrowDownRight className="w-3 h-3" />
        {formatPercent(delta)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-zinc-900 text-zinc-400 border-zinc-700">
      <Minus className="w-3 h-3" />
      {formatPercent(delta)}
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number | null;
  badge?: string;
}

function KpiCard({ label, value, delta, badge }: KpiCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="p-4 sm:p-5 border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">{label}</p>
            {badge && (
              <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                {badge}
              </span>
            )}
          </div>
          <p className="text-2xl font-bold text-white mt-2">{value}</p>
        </div>
        {typeof delta !== 'undefined' && <DeltaBadge delta={delta} />}
      </div>
      {typeof delta !== 'undefined' && (
        <p className="text-xs text-zinc-500 mt-3">{t('admin.pilotage.vsPrevious30d')}</p>
      )}
    </Card>
  );
}

interface AdminPilotageKpiGridProps {
  metrics: AdminPilotageMetrics;
  deltas: AdminPilotageDeltas;
  businessMetrics: AdminBusinessMetrics;
}

export function AdminPilotageKpiGrid({
  metrics,
  deltas,
  businessMetrics,
}: AdminPilotageKpiGridProps) {
  const { t } = useTranslation();
  const netSubscriptionsGrowth = formatNumber(Math.abs(metrics.net_subscriptions_growth_30d));
  const netSubscriptionsGrowthLabel = metrics.net_subscriptions_growth_30d > 0
    ? `+${netSubscriptionsGrowth}`
    : metrics.net_subscriptions_growth_30d < 0
      ? `-${netSubscriptionsGrowth}`
      : '0';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label={t('admin.pilotage.totalUsers')}
          value={formatNumber(metrics.total_users)}
          delta={deltas.users_growth_30d_pct}
        />
        <KpiCard
          label={t('admin.pilotage.activeProducers')}
          value={formatNumber(metrics.active_producers)}
        />
        <KpiCard
          label={t('admin.pilotage.publishedBeats')}
          value={formatNumber(metrics.published_beats)}
          delta={deltas.beats_growth_30d_pct}
        />
        <KpiCard
          label={t('admin.pilotage.activeBattles')}
          value={formatNumber(metrics.active_battles)}
        />
        <KpiCard
          label={t('admin.pilotage.monthlyBeatRevenue')}
          value={formatCents(metrics.monthly_revenue_beats_cents)}
          delta={deltas.revenue_growth_30d_pct}
        />
        <KpiCard
          label={t('admin.pilotage.subscriptionMrr')}
          value={formatCents(metrics.subscription_mrr_estimate_cents)}
        />
        <KpiCard
          label={t('admin.pilotage.newSubscriptions')}
          value={formatNumber(metrics.new_subscriptions_30d)}
          badge="30j"
        />
        <KpiCard
          label={t('admin.pilotage.churnedSubscriptions')}
          value={formatNumber(metrics.churned_subscriptions_30d)}
          badge={t('admin.pilotage.last30DaysShort')}
        />
        <KpiCard
          label={t('admin.pilotage.netSubscriptionGrowth')}
          value={netSubscriptionsGrowthLabel}
          badge={t('admin.pilotage.last30DaysShort')}
        />
        <KpiCard
          label={t('admin.pilotage.confirmedSignupRate')}
          value={formatPercent(metrics.confirmed_signup_rate_pct)}
        />
        <KpiCard
          label={t('admin.pilotage.userGrowth30d')}
          value={
            metrics.user_growth_30d_pct === null
              ? t('common.notAvailable')
              : formatPercent(metrics.user_growth_30d_pct)
          }
        />
      </div>

      <Card className="p-4 sm:p-5 border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-[0.08em]">{t('admin.pilotage.businessMetrics')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          <KpiCard
            label={t('admin.pilotage.producerPublicationRate')}
            value={formatPercent(businessMetrics.producer_publication_rate_pct)}
          />
          <KpiCard
            label={t('admin.pilotage.beatsConversionRate')}
            value={formatPercent(businessMetrics.beats_conversion_rate_pct)}
          />
          <KpiCard
            label={t('admin.pilotage.arpu')}
            value={formatCents(businessMetrics.arpu_cents)}
          />
          <KpiCard
            label={t('admin.pilotage.activeProducerRatio')}
            value={formatPercent(businessMetrics.active_producer_ratio_pct)}
          />
        </div>
      </Card>
    </div>
  );
}
