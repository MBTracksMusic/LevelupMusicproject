export type AdminPilotageMetrics = {
  total_users: number;
  active_producers: number;
  published_beats: number;
  active_battles: number;
  monthly_revenue_beats_cents: number;
  subscription_mrr_estimate_cents: number;
  confirmed_signup_rate_pct: number;
  user_growth_30d_pct: number | null;
  new_subscriptions_30d: number;
  churned_subscriptions_30d: number;
  net_subscriptions_growth_30d: number;
};

export type AdminPilotageDeltas = {
  users_growth_30d_pct: number | null;
  revenue_growth_30d_pct: number | null;
  beats_growth_30d_pct: number | null;
};

export type AdminBusinessMetrics = {
  producer_publication_rate_pct: number;
  beats_conversion_rate_pct: number;
  arpu_cents: number;
  active_producer_ratio_pct: number;
};

export type MetricsTimeseriesPoint = {
  date: string;
  value: number;
};

export type AdminMetricsTimeseries = {
  users_30d: MetricsTimeseriesPoint[];
  revenue_30d: MetricsTimeseriesPoint[];
  beats_30d: MetricsTimeseriesPoint[];
};

const DEFAULT_METRICS: AdminPilotageMetrics = {
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

const DEFAULT_DELTAS: AdminPilotageDeltas = {
  users_growth_30d_pct: null,
  revenue_growth_30d_pct: null,
  beats_growth_30d_pct: null,
};

const DEFAULT_BUSINESS: AdminBusinessMetrics = {
  producer_publication_rate_pct: 0,
  beats_conversion_rate_pct: 0,
  arpu_cents: 0,
  active_producer_ratio_pct: 0,
};

const DEFAULT_TIMESERIES: AdminMetricsTimeseries = {
  users_30d: [],
  revenue_30d: [],
  beats_30d: [],
};

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseTimeseriesArray(value: unknown): MetricsTimeseriesPoint[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const date = typeof row.date === 'string' ? row.date : null;
      if (!date) return null;
      return { date, value: asNumber(row.value, 0) };
    })
    .filter((item): item is MetricsTimeseriesPoint => item !== null);
}

export function parsePilotageMetrics(data: unknown): AdminPilotageMetrics {
  const source = asObject(data);
  return {
    total_users: asNumber(source.total_users, DEFAULT_METRICS.total_users),
    active_producers: asNumber(source.active_producers, DEFAULT_METRICS.active_producers),
    published_beats: asNumber(source.published_beats, DEFAULT_METRICS.published_beats),
    active_battles: asNumber(source.active_battles, DEFAULT_METRICS.active_battles),
    monthly_revenue_beats_cents: asNumber(
      source.monthly_revenue_beats_cents,
      DEFAULT_METRICS.monthly_revenue_beats_cents,
    ),
    subscription_mrr_estimate_cents: asNumber(
      source.subscription_mrr_estimate_cents,
      DEFAULT_METRICS.subscription_mrr_estimate_cents,
    ),
    confirmed_signup_rate_pct: asNumber(
      source.confirmed_signup_rate_pct,
      DEFAULT_METRICS.confirmed_signup_rate_pct,
    ),
    user_growth_30d_pct: asNullableNumber(source.user_growth_30d_pct),
    new_subscriptions_30d: asNumber(
      source.new_subscriptions_30d,
      DEFAULT_METRICS.new_subscriptions_30d,
    ),
    churned_subscriptions_30d: asNumber(
      source.churned_subscriptions_30d,
      DEFAULT_METRICS.churned_subscriptions_30d,
    ),
    net_subscriptions_growth_30d: asNumber(
      source.net_subscriptions_growth_30d,
      DEFAULT_METRICS.net_subscriptions_growth_30d,
    ),
  };
}

export function parsePilotageDeltas(data: unknown): AdminPilotageDeltas {
  const source = asObject(data);
  return {
    users_growth_30d_pct: asNullableNumber(source.users_growth_30d_pct),
    revenue_growth_30d_pct: asNullableNumber(source.revenue_growth_30d_pct),
    beats_growth_30d_pct: asNullableNumber(source.beats_growth_30d_pct),
  };
}

export function parseBusinessMetrics(data: unknown): AdminBusinessMetrics {
  const source = asObject(data);
  return {
    producer_publication_rate_pct: asNumber(
      source.producer_publication_rate_pct,
      DEFAULT_BUSINESS.producer_publication_rate_pct,
    ),
    beats_conversion_rate_pct: asNumber(
      source.beats_conversion_rate_pct,
      DEFAULT_BUSINESS.beats_conversion_rate_pct,
    ),
    arpu_cents: asNumber(source.arpu_cents, DEFAULT_BUSINESS.arpu_cents),
    active_producer_ratio_pct: asNumber(
      source.active_producer_ratio_pct,
      DEFAULT_BUSINESS.active_producer_ratio_pct,
    ),
  };
}

export function parseMetricsTimeseries(data: unknown): AdminMetricsTimeseries {
  const source = asObject(data);
  return {
    users_30d: parseTimeseriesArray(source.users_30d ?? DEFAULT_TIMESERIES.users_30d),
    revenue_30d: parseTimeseriesArray(source.revenue_30d ?? DEFAULT_TIMESERIES.revenue_30d),
    beats_30d: parseTimeseriesArray(source.beats_30d ?? DEFAULT_TIMESERIES.beats_30d),
  };
}
