import { supabase } from './supabase/client';
import type { Database } from './supabase/database.types';

type AnalyticsAlertRow = Database['public']['Tables']['analytics_alerts']['Row'];
type AnalyticsAlertInsert = Database['public']['Tables']['analytics_alerts']['Insert'];

export interface EvaluatedAnalyticsAlert {
  type: 'warning' | 'critical';
  message: string;
  metric: 'conversion' | 'revenue' | 'purchases';
  value: number;
}

export interface AnalyticsAlertRecord extends AnalyticsAlertRow {}

interface EvaluateAnalyticsAlertsInput {
  conversionRate: number;
  revenueGrowth: number;
  purchases: number;
}

const ALERT_DEDUP_WINDOW_MINUTES = 60;
const ACTIVE_ALERT_LIMIT = 8;

function getDedupThresholdIso() {
  const threshold = new Date();
  threshold.setMinutes(threshold.getMinutes() - ALERT_DEDUP_WINDOW_MINUTES);
  return threshold.toISOString();
}

export function evaluateAnalyticsAlerts(data: EvaluateAnalyticsAlertsInput): EvaluatedAnalyticsAlert[] {
  const alerts: EvaluatedAnalyticsAlert[] = [];

  if (data.conversionRate < 0.02) {
    alerts.push({
      type: 'warning',
      message: 'Conversion faible sur le funnel global.',
      metric: 'conversion',
      value: Number((data.conversionRate * 100).toFixed(2)),
    });
  }

  if (data.revenueGrowth < -30) {
    alerts.push({
      type: 'critical',
      message: 'Baisse de revenu supérieure à 30% sur la période.',
      metric: 'revenue',
      value: Number(data.revenueGrowth.toFixed(2)),
    });
  }

  if (data.purchases === 0) {
    alerts.push({
      type: 'critical',
      message: 'Aucun achat confirmé sur la période sélectionnée.',
      metric: 'purchases',
      value: 0,
    });
  }

  return alerts;
}

export async function saveAlerts(alerts: EvaluatedAnalyticsAlert[]) {
  if (alerts.length === 0) {
    return [];
  }

  const thresholdIso = getDedupThresholdIso();
  const metrics = [...new Set(alerts.map((alert) => alert.metric))];
  const types = [...new Set(alerts.map((alert) => alert.type))];

  const { data: existingAlerts, error: existingAlertsError } = await supabase
    .from('analytics_alerts')
    .select('metric, type, created_at')
    .eq('resolved', false)
    .gte('created_at', thresholdIso)
    .in('metric', metrics)
    .in('type', types);

  if (existingAlertsError) {
    throw existingAlertsError;
  }

  const dedupKeys = new Set(
    (existingAlerts ?? []).map((alert) => `${alert.metric}:${alert.type}`),
  );

  const alertsToInsert: AnalyticsAlertInsert[] = alerts
    .filter((alert) => !dedupKeys.has(`${alert.metric}:${alert.type}`))
    .map((alert) => ({
      type: alert.type,
      message: alert.message,
      metric: alert.metric,
      value: alert.value,
      resolved: false,
    }));

  if (alertsToInsert.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('analytics_alerts')
    .insert(alertsToInsert)
    .select('*');

  if (error) {
    throw error;
  }

  return (data ?? []) as AnalyticsAlertRecord[];
}

export async function getActiveAlerts(limit = ACTIVE_ALERT_LIMIT) {
  const { data, error } = await supabase
    .from('analytics_alerts')
    .select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as AnalyticsAlertRecord[];
}

export async function resolveAnalyticsAlert(id: string) {
  const { error } = await supabase
    .from('analytics_alerts')
    .update({ resolved: true })
    .eq('id', id)
    .eq('resolved', false);

  if (error) {
    throw error;
  }
}
