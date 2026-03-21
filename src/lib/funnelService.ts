import { supabase } from './supabase/client';

export interface FunnelData {
  views: number;
  checkouts: number;
  purchases: number;
}

let funnelDataPromise: Promise<FunnelData> | null = null;

async function fetchFunnelData(): Promise<FunnelData> {
  const { count: purchases, error } = await supabase
    .from('purchases')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed');

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

export async function getFunnelData() {
  if (!funnelDataPromise) {
    funnelDataPromise = fetchFunnelData().catch((error) => {
      funnelDataPromise = null;
      throw error;
    });
  }

  return funnelDataPromise;
}
