import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import type {
  AdminBusinessMetrics,
  AdminPilotageDeltas,
  AdminPilotageMetrics,
} from './types';

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('fr-FR');

function formatCents(value: number) {
  return euroFormatter.format(value / 100);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)} %`;
}

interface DeltaBadgeProps {
  delta: number | null;
}

function DeltaBadge({ delta }: DeltaBadgeProps) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium border bg-zinc-900 text-zinc-400 border-zinc-700">
        <Minus className="w-3 h-3" />
        N/A
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
        <p className="text-xs text-zinc-500 mt-3">vs 30 jours precedents</p>
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
  const netSubscriptionsGrowth = numberFormatter.format(Math.abs(metrics.net_subscriptions_growth_30d));
  const netSubscriptionsGrowthLabel = metrics.net_subscriptions_growth_30d > 0
    ? `+${netSubscriptionsGrowth}`
    : metrics.net_subscriptions_growth_30d < 0
      ? `-${netSubscriptionsGrowth}`
      : '0';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Utilisateurs total"
          value={numberFormatter.format(metrics.total_users)}
          delta={deltas.users_growth_30d_pct}
        />
        <KpiCard
          label="Producteurs actifs"
          value={numberFormatter.format(metrics.active_producers)}
        />
        <KpiCard
          label="Beats publies"
          value={numberFormatter.format(metrics.published_beats)}
          delta={deltas.beats_growth_30d_pct}
        />
        <KpiCard
          label="Battles actives"
          value={numberFormatter.format(metrics.active_battles)}
        />
        <KpiCard
          label="Revenu mensuel beats"
          value={formatCents(metrics.monthly_revenue_beats_cents)}
          delta={deltas.revenue_growth_30d_pct}
        />
        <KpiCard
          label="MRR abonnements estime"
          value={formatCents(metrics.subscription_mrr_estimate_cents)}
        />
        <KpiCard
          label="Nouveaux abonnements"
          value={numberFormatter.format(metrics.new_subscriptions_30d)}
          badge="30j"
        />
        <KpiCard
          label="Desabonnements"
          value={numberFormatter.format(metrics.churned_subscriptions_30d)}
          badge="30j"
        />
        <KpiCard
          label="Croissance nette abonnements"
          value={netSubscriptionsGrowthLabel}
          badge="30j"
        />
        <KpiCard
          label="Taux inscriptions confirmees"
          value={formatPercent(metrics.confirmed_signup_rate_pct)}
        />
        <KpiCard
          label="Croissance utilisateurs 30 jours"
          value={
            metrics.user_growth_30d_pct === null
              ? 'N/A'
              : formatPercent(metrics.user_growth_30d_pct)
          }
        />
      </div>

      <Card className="p-4 sm:p-5 border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-[0.08em]">Business metrics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          <KpiCard
            label="Taux publication producteurs"
            value={formatPercent(businessMetrics.producer_publication_rate_pct)}
          />
          <KpiCard
            label="Taux conversion beats"
            value={formatPercent(businessMetrics.beats_conversion_rate_pct)}
          />
          <KpiCard
            label="ARPU"
            value={formatCents(businessMetrics.arpu_cents)}
          />
          <KpiCard
            label="Ratio producteurs actifs"
            value={formatPercent(businessMetrics.active_producer_ratio_pct)}
          />
        </div>
      </Card>
    </div>
  );
}
