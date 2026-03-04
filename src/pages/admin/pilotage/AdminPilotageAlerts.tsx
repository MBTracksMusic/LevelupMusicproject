import { AlertTriangle, Flame } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { useTranslation } from '../../../lib/i18n';
import type { AdminPilotageDeltas } from './types';

interface AdminPilotageAlertsProps {
  deltas: AdminPilotageDeltas;
  beatsPublished30d: number;
}

type AlertLevel = 'critical' | 'warning';

interface DashboardAlert {
  key: string;
  level: AlertLevel;
  title: string;
  description: string;
}

function AlertCard({ alert }: { alert: DashboardAlert }) {
  const isCritical = alert.level === 'critical';
  return (
    <Card
      className={
        isCritical
          ? 'p-4 border-red-700 bg-red-900/20'
          : 'p-4 border-amber-700 bg-amber-900/20'
      }
    >
      <div className="flex items-start gap-3">
        {isCritical ? (
          <Flame className="w-5 h-5 text-red-300 mt-0.5" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5" />
        )}
        <div>
          <p className={isCritical ? 'text-red-200 font-semibold' : 'text-amber-200 font-semibold'}>
            {alert.title}
          </p>
          <p className={isCritical ? 'text-red-300 text-sm mt-1' : 'text-amber-300 text-sm mt-1'}>
            {alert.description}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function AdminPilotageAlerts({ deltas, beatsPublished30d }: AdminPilotageAlertsProps) {
  const { t } = useTranslation();
  const alerts: DashboardAlert[] = [];

  if (deltas.users_growth_30d_pct !== null && deltas.users_growth_30d_pct < -20) {
    alerts.push({
      key: 'users-growth-critical',
      level: 'critical',
      title: t('admin.pilotage.usersGrowthCriticalTitle'),
      description: t('admin.pilotage.usersGrowthCriticalDescription', {
        value: deltas.users_growth_30d_pct.toFixed(2),
      }),
    });
  }

  if (deltas.revenue_growth_30d_pct !== null && deltas.revenue_growth_30d_pct < -15) {
    alerts.push({
      key: 'revenue-growth-critical',
      level: 'critical',
      title: t('admin.pilotage.revenueGrowthCriticalTitle'),
      description: t('admin.pilotage.revenueGrowthCriticalDescription', {
        value: deltas.revenue_growth_30d_pct.toFixed(2),
      }),
    });
  }

  if (beatsPublished30d === 0) {
    alerts.push({
      key: 'beats-30d-warning',
      level: 'warning',
      title: t('admin.pilotage.noBeats30dTitle'),
      description: t('admin.pilotage.noBeats30dDescription'),
    });
  }

  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{t('admin.pilotage.alertsLabel')}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {alerts.map((alert) => (
          <AlertCard key={alert.key} alert={alert} />
        ))}
      </div>
    </div>
  );
}
