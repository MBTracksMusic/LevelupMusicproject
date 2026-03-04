import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { useTranslation } from '../../../lib/i18n';
import { supabase } from '../../../lib/supabase/client';
import { AdminPilotageAlerts } from './AdminPilotageAlerts';
import { AdminPilotageCharts } from './AdminPilotageCharts';
import { AdminPilotageKpiGrid } from './AdminPilotageKpiGrid';
import {
  parseBusinessMetrics,
  parseMetricsTimeseries,
  parsePilotageDeltas,
  parsePilotageMetrics,
  type AdminBusinessMetrics,
  type AdminMetricsTimeseries,
  type AdminPilotageDeltas,
  type AdminPilotageMetrics,
} from './types';

const EMPTY_METRICS: AdminPilotageMetrics = {
  total_users: 0,
  active_producers: 0,
  published_beats: 0,
  active_battles: 0,
  monthly_revenue_beats_cents: 0,
  subscription_mrr_estimate_cents: 0,
  confirmed_signup_rate_pct: 0,
  user_growth_30d_pct: null,
  new_subscriptions_30d: 0,
  churned_subscriptions_30d: 0,
  net_subscriptions_growth_30d: 0,
};

const EMPTY_DELTAS: AdminPilotageDeltas = {
  users_growth_30d_pct: null,
  revenue_growth_30d_pct: null,
  beats_growth_30d_pct: null,
};

const EMPTY_BUSINESS: AdminBusinessMetrics = {
  producer_publication_rate_pct: 0,
  beats_conversion_rate_pct: 0,
  arpu_cents: 0,
  active_producer_ratio_pct: 0,
};

const EMPTY_TIMESERIES: AdminMetricsTimeseries = {
  users_30d: [],
  revenue_30d: [],
  beats_30d: [],
};

interface SectionErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  sectionName: string;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

class SectionErrorBoundary extends Component<SectionErrorBoundaryProps, SectionErrorBoundaryState> {
  state: SectionErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Pilotage section render error:', {
      section: this.props.sectionName,
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 11 }).map((_, index) => (
          <Card key={`pilotage-loading-kpi-${index}`} className="p-4 sm:p-5 border-zinc-800 animate-pulse">
            <div className="h-3 w-28 rounded bg-zinc-800" />
            <div className="h-8 w-24 rounded bg-zinc-800 mt-3" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={`pilotage-loading-chart-${index}`} className="p-4 sm:p-5 border-zinc-800 animate-pulse">
            <div className="h-3 w-32 rounded bg-zinc-800" />
            <div className="h-64 rounded bg-zinc-800 mt-4" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AdminPilotagePage() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<AdminPilotageMetrics>(EMPTY_METRICS);
  const [deltas, setDeltas] = useState<AdminPilotageDeltas>(EMPTY_DELTAS);
  const [businessMetrics, setBusinessMetrics] = useState<AdminBusinessMetrics>(EMPTY_BUSINESS);
  const [timeseries, setTimeseries] = useState<AdminMetricsTimeseries>(EMPTY_TIMESERIES);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [metricsRes, timeseriesRes, extraRes] = await Promise.all([
        supabase.rpc('get_admin_pilotage_metrics'),
        supabase.rpc('get_admin_metrics_timeseries'),
        Promise.all([
          supabase.rpc('get_admin_pilotage_deltas'),
          supabase.rpc('get_admin_business_metrics'),
        ]),
      ]);

      const [deltasRes, businessRes] = extraRes;

      const firstError =
        metricsRes.error ||
        timeseriesRes.error ||
        deltasRes.error ||
        businessRes.error;

      if (firstError) {
        console.error('Error loading pilotage dashboard:', {
          metricsError: metricsRes.error,
          timeseriesError: timeseriesRes.error,
          deltasError: deltasRes.error,
          businessError: businessRes.error,
        });
        setError(t('admin.pilotage.loadError'));
        return;
      }

      setMetrics(parsePilotageMetrics(metricsRes.data));
      setTimeseries(parseMetricsTimeseries(timeseriesRes.data));
      setDeltas(parsePilotageDeltas(deltasRes.data));
      setBusinessMetrics(parseBusinessMetrics(businessRes.data));
    } catch (err) {
      console.error('Unexpected pilotage loading failure:', err);
      setError(t('admin.pilotage.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const beatsPublished30d = useMemo(
    () => timeseries.beats_30d.reduce((acc, point) => acc + point.value, 0),
    [timeseries.beats_30d],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">{t('admin.pilotage.title')}</h2>
        <p className="text-zinc-400 text-sm mt-1">{t('admin.pilotage.subtitle')}</p>
      </Card>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <Card className="p-6 border-red-800 bg-red-900/20">
          <p className="text-red-300">{error}</p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => void loadDashboard()}>
              {t('admin.pilotage.retry')}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <SectionErrorBoundary
            sectionName="kpi-alerts"
            fallback={(
              <Card className="p-6 border-red-800 bg-red-900/20">
                <p className="text-red-300">
                  {t('admin.pilotage.kpiError')}
                </p>
                <div className="mt-4">
                  <Button variant="outline" onClick={() => void loadDashboard()}>
                    {t('admin.pilotage.retry')}
                  </Button>
                </div>
              </Card>
            )}
          >
            <AdminPilotageAlerts deltas={deltas} beatsPublished30d={beatsPublished30d} />
            <AdminPilotageKpiGrid
              metrics={metrics}
              deltas={deltas}
              businessMetrics={businessMetrics}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary
            sectionName="charts"
            fallback={(
              <Card className="p-6 border-amber-800 bg-amber-900/20">
                <p className="text-amber-300">
                  {t('admin.pilotage.chartsError')}
                </p>
              </Card>
            )}
          >
            <AdminPilotageCharts timeseries={timeseries} />
          </SectionErrorBoundary>
        </>
      )}
    </div>
  );
}
