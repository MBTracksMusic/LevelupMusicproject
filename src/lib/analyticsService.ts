import { supabase } from './supabase/client';
import type { Database } from './supabase/database.types';

export type AnalyticsDateRange = '7d' | '30d' | 'all';

type PurchaseRow = Pick<
  Database['public']['Tables']['purchases']['Row'],
  'amount' | 'created_at' | 'product_id' | 'status'
>;

type ProductRow = Pick<Database['public']['Tables']['products']['Row'], 'id' | 'title'>;
type PlayEventRow = Pick<
  Database['public']['Tables']['play_events']['Row'],
  'product_id' | 'played_at'
>;
type ProductCatalogRow = Pick<
  Database['public']['Views']['public_catalog_products']['Row'],
  'id' | 'title' | 'slug' | 'price'
>;

export interface MetricWithGrowth {
  value: number;
  growth: number;
}

export interface TopProductAnalytics {
  productId: string;
  productName: string;
  revenue: number;
  salesCount: number;
}

export interface AnalyticsAlert {
  type: 'warning';
  message: string;
}

interface AnalyticsSnapshot {
  totalRevenue: MetricWithGrowth;
  totalPurchases: MetricWithGrowth;
  averageOrderValue: MetricWithGrowth;
  revenueToday: number;
  topProducts: TopProductAnalytics[];
}

export interface ProductPerformanceRow {
  productId: string;
  productName: string;
  slug: string;
  price: number;
  views: number;
  purchases: number;
  conversionRate: number;
  lowConversion: boolean;
}

const analyticsSnapshotPromises = new Map<AnalyticsDateRange, Promise<AnalyticsSnapshot>>();

function centsToEuros(amountCents: number) {
  return Number((amountCents / 100).toFixed(2));
}

function roundMetric(value: number) {
  return Number(value.toFixed(2));
}

function getRangeDays(dateRange: AnalyticsDateRange) {
  if (dateRange === '7d') {
    return 7;
  }

  if (dateRange === '30d') {
    return 30;
  }

  return null;
}

function getPeriodStart(dateRange: AnalyticsDateRange) {
  const days = getRangeDays(dateRange);

  if (!days) {
    return null;
  }

  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function getPreviousPeriodStart(dateRange: AnalyticsDateRange) {
  const days = getRangeDays(dateRange);

  if (!days) {
    return null;
  }

  const date = new Date();
  date.setDate(date.getDate() - days * 2);
  return date.toISOString();
}

function getGrowth(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return roundMetric(((current - previous) / previous) * 100);
}

function createMetric(value: number, previousValue: number): MetricWithGrowth {
  return {
    value: roundMetric(value),
    growth: getGrowth(value, previousValue),
  };
}

async function fetchPurchasesForRange(dateRange: AnalyticsDateRange): Promise<PurchaseRow[]> {
  let query = supabase
    .from('purchases')
    .select('amount, created_at, product_id, status')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5000);

  const previousPeriodStart = getPreviousPeriodStart(dateRange);

  if (previousPeriodStart) {
    query = query.gte('created_at', previousPeriodStart);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as PurchaseRow[];
}

function splitPurchasesByPeriod(purchases: PurchaseRow[], dateRange: AnalyticsDateRange) {
  if (dateRange === 'all') {
    return {
      currentPurchases: purchases,
      previousPurchases: [] as PurchaseRow[],
    };
  }

  const periodStart = getPeriodStart(dateRange);

  if (!periodStart) {
    return {
      currentPurchases: purchases,
      previousPurchases: [] as PurchaseRow[],
    };
  }

  const periodStartMs = new Date(periodStart).getTime();

  return purchases.reduce(
    (accumulator, purchase) => {
      const createdAtMs = new Date(purchase.created_at).getTime();

      if (createdAtMs >= periodStartMs) {
        accumulator.currentPurchases.push(purchase);
      } else {
        accumulator.previousPurchases.push(purchase);
      }

      return accumulator;
    },
    {
      currentPurchases: [] as PurchaseRow[],
      previousPurchases: [] as PurchaseRow[],
    },
  );
}

async function fetchProductTitleMap(productIds: string[]) {
  if (productIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from('products')
    .select('id, title')
    .in('id', productIds);

  if (error) {
    throw error;
  }

  return new Map(((data ?? []) as ProductRow[]).map((product) => [product.id, product.title]));
}

async function fetchAnalyticsSnapshot(dateRange: AnalyticsDateRange): Promise<AnalyticsSnapshot> {
  const purchases = await fetchPurchasesForRange(dateRange);
  const { currentPurchases, previousPurchases } = splitPurchasesByPeriod(purchases, dateRange);

  const currentRevenueCents = currentPurchases.reduce((sum, purchase) => sum + purchase.amount, 0);
  const previousRevenueCents = previousPurchases.reduce((sum, purchase) => sum + purchase.amount, 0);

  const currentPurchasesCount = currentPurchases.length;
  const previousPurchasesCount = previousPurchases.length;

  const currentAverageOrderValue =
    currentPurchasesCount > 0 ? currentRevenueCents / currentPurchasesCount / 100 : 0;
  const previousAverageOrderValue =
    previousPurchasesCount > 0 ? previousRevenueCents / previousPurchasesCount / 100 : 0;

  const uniqueProductIds = [...new Set(currentPurchases.map((purchase) => purchase.product_id))];
  const productTitleMap = await fetchProductTitleMap(uniqueProductIds);
  const productAggregates = new Map<string, TopProductAnalytics>();

  currentPurchases.forEach((purchase) => {
    const existing = productAggregates.get(purchase.product_id);
    const revenue = centsToEuros(purchase.amount);

    if (existing) {
      existing.revenue = roundMetric(existing.revenue + revenue);
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
      if (b.revenue !== a.revenue) {
        return b.revenue - a.revenue;
      }

      return b.salesCount - a.salesCount;
    })
    .slice(0, 5);

  const todayStart = new Date();
  const todayStartMs = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    todayStart.getDate(),
  ).getTime();

  const revenueToday = currentPurchases.reduce((sum, purchase) => {
    const createdAtMs = new Date(purchase.created_at).getTime();
    return createdAtMs >= todayStartMs ? sum + purchase.amount : sum;
  }, 0);

  return {
    totalRevenue: createMetric(centsToEuros(currentRevenueCents), centsToEuros(previousRevenueCents)),
    totalPurchases: createMetric(currentPurchasesCount, previousPurchasesCount),
    averageOrderValue: createMetric(currentAverageOrderValue, previousAverageOrderValue),
    revenueToday: centsToEuros(revenueToday),
    topProducts,
  };
}

async function getAnalyticsSnapshot(dateRange: AnalyticsDateRange) {
  const existingPromise = analyticsSnapshotPromises.get(dateRange);

  if (existingPromise) {
    return existingPromise;
  }

  const snapshotPromise = fetchAnalyticsSnapshot(dateRange).catch((error) => {
    analyticsSnapshotPromises.delete(dateRange);
    throw error;
  });

  analyticsSnapshotPromises.set(dateRange, snapshotPromise);
  return snapshotPromise;
}

export function checkAnalyticsAlerts(data: {
  revenueGrowth: number;
  viewToPurchaseRate: number;
}): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = [];

  if (data.viewToPurchaseRate < 0.02) {
    alerts.push({
      type: 'warning',
      message: 'Conversion faible sur le funnel global.',
    });
  }

  if (data.revenueGrowth < -30) {
    alerts.push({
      type: 'warning',
      message: 'Baisse de revenu supérieure à 30% sur la période.',
    });
  }

  return alerts;
}

export async function getTotalRevenue(dateRange: AnalyticsDateRange) {
  const snapshot = await getAnalyticsSnapshot(dateRange);
  return snapshot.totalRevenue;
}

export async function getTotalPurchases(dateRange: AnalyticsDateRange) {
  const snapshot = await getAnalyticsSnapshot(dateRange);
  return snapshot.totalPurchases;
}

export async function getAverageOrderValue(dateRange: AnalyticsDateRange) {
  const snapshot = await getAnalyticsSnapshot(dateRange);
  return snapshot.averageOrderValue;
}

export async function getRevenueToday(dateRange: AnalyticsDateRange) {
  const snapshot = await getAnalyticsSnapshot(dateRange);
  return snapshot.revenueToday;
}

export async function getTopProducts(dateRange: AnalyticsDateRange) {
  const snapshot = await getAnalyticsSnapshot(dateRange);
  return snapshot.topProducts;
}

export async function getProductPerformance(dateRange: AnalyticsDateRange) {
  const periodStart = getPeriodStart(dateRange);

  let playEventsQuery = supabase
    .from('play_events')
    .select('product_id, played_at')
    .order('played_at', { ascending: false })
    .limit(20000);

  let purchasesQuery = supabase
    .from('purchases')
    .select('product_id, created_at, status')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (periodStart) {
    playEventsQuery = playEventsQuery.gte('played_at', periodStart);
    purchasesQuery = purchasesQuery.gte('created_at', periodStart);
  }

  const [
    { data: playEvents, error: playEventsError },
    { data: purchases, error: purchasesError },
    { data: catalogProducts, error: catalogProductsError },
  ] = await Promise.all([
    playEventsQuery,
    purchasesQuery,
    supabase
      .from('public_catalog_products')
      .select('id, title, slug, price')
      .is('deleted_at', null)
      .eq('is_published', true),
  ]);

  if (playEventsError) {
    throw playEventsError;
  }

  if (purchasesError) {
    throw purchasesError;
  }

  if (catalogProductsError) {
    throw catalogProductsError;
  }

  const viewsByProduct = new Map<string, number>();
  const purchasesByProduct = new Map<string, number>();

  ((playEvents ?? []) as PlayEventRow[]).forEach((event) => {
    viewsByProduct.set(event.product_id, (viewsByProduct.get(event.product_id) ?? 0) + 1);
  });

  ((purchases ?? []) as Array<Pick<PurchaseRow, 'product_id'>>).forEach((purchase) => {
    purchasesByProduct.set(purchase.product_id, (purchasesByProduct.get(purchase.product_id) ?? 0) + 1);
  });

  return ((catalogProducts ?? []) as ProductCatalogRow[])
    .filter((product) => typeof product.id === 'string' && product.id.length > 0)
    .map((product) => {
      const views = viewsByProduct.get(product.id as string) ?? 0;
      const purchaseCount = purchasesByProduct.get(product.id as string) ?? 0;
      const conversionRate =
        views > 0
          ? Math.min(1, purchaseCount / views)
          : 0;

      return {
        productId: product.id as string,
        productName: product.title ?? 'Produit inconnu',
        slug: product.slug ?? '',
        price: product.price ?? 0,
        views,
        purchases: purchaseCount,
        conversionRate: roundMetric(conversionRate),
        lowConversion: views > 100 && purchaseCount === 0,
      } satisfies ProductPerformanceRow;
    })
    .sort((a, b) => {
      if (b.conversionRate !== a.conversionRate) {
        return b.conversionRate - a.conversionRate;
      }

      return b.views - a.views;
    });
}
