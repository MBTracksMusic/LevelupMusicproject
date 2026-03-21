import { supabase } from './supabase/client';
import type { AnalyticsDateRange } from './analyticsService';

export interface FunnelData {
  views: number;
  checkouts: number;
  purchases: number;
}

const funnelDataPromises = new Map<AnalyticsDateRange, Promise<FunnelData>>();

function getPeriodStart(dateRange: AnalyticsDateRange) {
  if (dateRange === 'all') {
    return null;
  }

  const date = new Date();
  date.setDate(date.getDate() - (dateRange === '7d' ? 7 : 30));
  return date.toISOString();
}

async function fetchFunnelData(dateRange: AnalyticsDateRange): Promise<FunnelData> {
  let query = supabase
    .from('purchases')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed');

  const periodStart = getPeriodStart(dateRange);

  if (periodStart) {
    query = query.gte('created_at', periodStart);
  }

  const { count: purchases, error } = await query;

  if (error) {
    throw error;
  }

  const safePurchases = purchases ?? 0;

  // Placeholder structure until GA4 reporting is connected server-side for admin analytics.
  const checkouts = safePurchases > 0 ? safePurchases * 2 : 0;
  const views = checkouts > 0 ? checkouts * 3 : 0;

  return {
    views,
    checkouts,
    purchases: safePurchases,
  };
}

export async function getFunnelData(dateRange: AnalyticsDateRange) {
  const existingPromise = funnelDataPromises.get(dateRange);

  if (existingPromise) {
    return existingPromise;
  }

  const funnelPromise = fetchFunnelData(dateRange).catch((error) => {
    funnelDataPromises.delete(dateRange);
    throw error;
  });

  funnelDataPromises.set(dateRange, funnelPromise);
  return funnelPromise;
}
