import { supabase } from './supabase/client';
import type { Database } from './supabase/database.types';

type PurchaseRow = Pick<
  Database['public']['Tables']['purchases']['Row'],
  'amount' | 'created_at' | 'product_id' | 'status'
>;

type ProductRow = Pick<Database['public']['Tables']['products']['Row'], 'id' | 'title'>;

export interface TopProductAnalytics {
  productId: string;
  productName: string;
  revenue: number;
  salesCount: number;
}

interface AnalyticsSnapshot {
  totalRevenue: number;
  totalPurchases: number;
  averageOrderValue: number;
  revenueToday: number;
  topProducts: TopProductAnalytics[];
}

let analyticsSnapshotPromise: Promise<AnalyticsSnapshot> | null = null;

function centsToEuros(amountCents: number) {
  return Number((amountCents / 100).toFixed(2));
}

function getTodayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

async function fetchAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const { data: purchases, error: purchasesError } = await supabase
    .from('purchases')
    .select('amount, created_at, product_id, status')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (purchasesError) {
    throw purchasesError;
  }

  const completedPurchases = (purchases ?? []) as PurchaseRow[];
  const totalPurchases = completedPurchases.length;
  const totalRevenueCents = completedPurchases.reduce((sum, purchase) => sum + purchase.amount, 0);
  const todayStart = getTodayStart();
  const revenueTodayCents = completedPurchases.reduce((sum, purchase) => {
    const createdAt = new Date(purchase.created_at).getTime();
    return createdAt >= todayStart ? sum + purchase.amount : sum;
  }, 0);

  const uniqueProductIds = [...new Set(completedPurchases.map((purchase) => purchase.product_id))];
  let productTitleMap = new Map<string, string>();

  if (uniqueProductIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, title')
      .in('id', uniqueProductIds);

    if (productsError) {
      throw productsError;
    }

    productTitleMap = new Map(
      ((products ?? []) as ProductRow[]).map((product) => [product.id, product.title]),
    );
  }

  const productAggregates = new Map<string, TopProductAnalytics>();

  completedPurchases.forEach((purchase) => {
    const existing = productAggregates.get(purchase.product_id);
    const revenue = centsToEuros(purchase.amount);

    if (existing) {
      existing.revenue = Number((existing.revenue + revenue).toFixed(2));
      existing.salesCount += 1;
      return;
    }

    productAggregates.set(purchase.product_id, {
      productId: purchase.product_id,
      productName: productTitleMap.get(purchase.product_id) ?? 'Produit inconnu',
      revenue,
      salesCount: 1,
    });
  });

  const topProducts = [...productAggregates.values()]
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.salesCount - a.salesCount;
    })
    .slice(0, 5);

  return {
    totalRevenue: centsToEuros(totalRevenueCents),
    totalPurchases,
    averageOrderValue: totalPurchases > 0 ? Number((totalRevenueCents / totalPurchases / 100).toFixed(2)) : 0,
    revenueToday: centsToEuros(revenueTodayCents),
    topProducts,
  };
}

async function getAnalyticsSnapshot() {
  if (!analyticsSnapshotPromise) {
    analyticsSnapshotPromise = fetchAnalyticsSnapshot().catch((error) => {
      analyticsSnapshotPromise = null;
      throw error;
    });
  }

  return analyticsSnapshotPromise;
}

export async function getTotalRevenue() {
  const snapshot = await getAnalyticsSnapshot();
  return snapshot.totalRevenue;
}

export async function getTotalPurchases() {
  const snapshot = await getAnalyticsSnapshot();
  return snapshot.totalPurchases;
}

export async function getAverageOrderValue() {
  const snapshot = await getAnalyticsSnapshot();
  return snapshot.averageOrderValue;
}

export async function getRevenueToday() {
  const snapshot = await getAnalyticsSnapshot();
  return snapshot.revenueToday;
}

export async function getTopProducts() {
  const snapshot = await getAnalyticsSnapshot();
  return snapshot.topProducts;
}
