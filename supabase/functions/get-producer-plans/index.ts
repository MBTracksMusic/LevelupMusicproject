import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const DEFAULT_CORS_ORIGIN = DEFAULT_ALLOWED_CORS_ORIGINS[0];
const SUCCESS_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const resolveAllowedCorsOrigins = () => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);

  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const normalized = normalizeOrigin(token.trim());
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  for (const envValue of [
    Deno.env.get("APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("VITE_APP_URL"),
  ]) {
    if (typeof envValue !== "string") continue;
    const normalized = normalizeOrigin(envValue.trim());
    if (normalized) {
      allowed.add(normalized);
    }
  }

  return allowed;
};

const ALLOWED_CORS_ORIGINS = resolveAllowedCorsOrigins();

const resolveRequestOrigin = (req: Request) => {
  const rawOrigin = req.headers.get("origin");
  if (!rawOrigin) return null;
  const normalized = normalizeOrigin(rawOrigin);
  if (!normalized) return null;
  return ALLOWED_CORS_ORIGINS.has(normalized) ? normalized : null;
};

const buildCorsHeaders = (origin: string | null) => ({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": origin ?? DEFAULT_CORS_ORIGIN,
  "Vary": "Origin",
});

type ProducerTier = "user" | "producteur" | "elite";

const tierOrder: Record<ProducerTier, number> = {
  user: 1,
  producteur: 2,
  elite: 3,
};

const isProducerTier = (value: unknown): value is ProducerTier =>
  value === "user" || value === "producteur" || value === "elite";

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const STRIPE_PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_STORE_MAX_ENTRIES = 5_000;

type StripePricePayload = {
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  stripe_price_active: boolean;
};

let plansResponseCache: { payload: { plans: Array<Record<string, unknown>> }; expiresAt: number } | null = null;
const stripePriceCache = new Map<string, { value: StripePricePayload | null; expiresAt: number }>();
const requestRateLimitStore = new Map<string, { count: number; windowStartedAt: number; lastSeenAt: number }>();

const getRequesterIp = (req: Request) => {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  const candidate = cfIp || realIp || forwardedFor?.split(",")[0];
  const normalized = asNonEmptyString(candidate);
  return normalized ?? "unknown";
};

const cleanupRateLimitStore = (now: number) => {
  for (const [key, entry] of requestRateLimitStore.entries()) {
    if (now - entry.lastSeenAt > RATE_LIMIT_WINDOW_MS * 2) {
      requestRateLimitStore.delete(key);
    }
  }

  if (requestRateLimitStore.size <= RATE_LIMIT_STORE_MAX_ENTRIES) return;

  const sorted = [...requestRateLimitStore.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  const toDelete = sorted.slice(0, sorted.length - RATE_LIMIT_STORE_MAX_ENTRIES);
  for (const [key] of toDelete) {
    requestRateLimitStore.delete(key);
  }
};

const consumeRateLimit = (key: string, maxRequests: number) => {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const entry = requestRateLimitStore.get(key);
  if (!entry) {
    requestRateLimitStore.set(key, { count: 1, windowStartedAt: now, lastSeenAt: now });
    return true;
  }

  if (now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    requestRateLimitStore.set(key, { count: 1, windowStartedAt: now, lastSeenAt: now });
    return true;
  }

  if (entry.count >= maxRequests) {
    entry.lastSeenAt = now;
    requestRateLimitStore.set(key, entry);
    return false;
  }

  entry.count += 1;
  entry.lastSeenAt = now;
  requestRateLimitStore.set(key, entry);
  return true;
};

async function fetchStripePrice(
  stripeSecret: string,
  priceId: string,
) {
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const payload = await response.json() as {
      unit_amount?: number | null;
      currency?: string;
      active?: boolean;
      recurring?: { interval?: string | null } | null;
      error?: { message?: string };
    };

    if (!response.ok || payload.error) {
      console.error("STRIPE_PRICE_LOOKUP_ERROR", {
        function: "get-producer-plans",
        priceId,
        status: response.status,
        message: payload.error?.message,
      });
      return null;
    }

    return {
      amount_cents: typeof payload.unit_amount === "number" ? payload.unit_amount : null,
      currency: typeof payload.currency === "string" ? payload.currency : null,
      interval: payload.recurring?.interval ?? null,
      stripe_price_active: payload.active === true,
    };
  } catch (error) {
    console.error("STRIPE_PRICE_LOOKUP_UNEXPECTED_ERROR", {
      function: "get-producer-plans",
      priceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const fetchStripePriceCached = async (stripeSecret: string, priceId: string) => {
  const now = Date.now();
  const cached = stripePriceCache.get(priceId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await fetchStripePrice(stripeSecret, priceId);
  stripePriceCache.set(priceId, { value, expiresAt: now + STRIPE_PRICE_CACHE_TTL_MS });
  return value;
};

serveWithErrorHandling("get-producer-plans", async (req: Request) => {
  const requestOriginHeader = req.headers.get("origin");
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (requestOriginHeader && !requestOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: jsonHeaders,
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const requesterIp = getRequesterIp(req);
  const allowed = consumeRateLimit(`ip:${requesterIp}`, RATE_LIMIT_MAX_REQUESTS);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: jsonHeaders,
    });
  }

  const now = Date.now();
  if (plansResponseCache && plansResponseCache.expiresAt > now) {
    return new Response(JSON.stringify(plansResponseCache.payload), {
      status: 200,
      headers: {
        ...jsonHeaders,
        "Cache-Control": SUCCESS_CACHE_CONTROL,
        "X-Cache": "HIT",
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !anonKey) {
      return new Response(JSON.stringify({ error: "Supabase env not configured" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const supabase = createClient(supabaseUrl, anonKey);

    const { data, error } = await supabase
      .from("producer_plans")
      .select("tier, max_beats_published, max_battles_created_per_month, battle_limit, commission_rate, stripe_price_id, amount_cents, is_active")
      .eq("is_active", true);

    if (error) {
      if (plansResponseCache) {
        return new Response(JSON.stringify(plansResponseCache.payload), {
          status: 200,
          headers: {
            ...jsonHeaders,
            "Cache-Control": SUCCESS_CACHE_CONTROL,
            "X-Cache": "STALE",
          },
        });
      }

      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const plans = ((data as Array<{
      tier?: unknown;
      max_beats_published?: unknown;
      max_battles_created_per_month?: unknown;
      battle_limit?: unknown;
      commission_rate?: unknown;
      stripe_price_id?: unknown;
      amount_cents?: unknown;
      is_active?: unknown;
    }> | null) || [])
      .map((row) => ({
        battleLimit: typeof row.battle_limit === "number"
          ? row.battle_limit
          : 0,
        tier: isProducerTier(row.tier) ? row.tier : null,
        max_beats_published: typeof row.max_beats_published === "number" ? row.max_beats_published : null,
        max_battles_created_per_month: null as number | null,
        commission_rate: typeof row.commission_rate === "number" ? row.commission_rate : Number(row.commission_rate ?? 0),
        stripe_price_id: asNonEmptyString(row.stripe_price_id),
        amount_cents: typeof row.amount_cents === "number" && Number.isFinite(row.amount_cents)
          ? row.amount_cents
          : null,
        is_active: row.is_active === true,
      }))
      .map(({ battleLimit, ...row }) => ({
        ...row,
        max_battles_created_per_month: battleLimit === -1
          ? null
          : Math.max(battleLimit, 0),
      }))
      .filter((row): row is {
        tier: ProducerTier;
        max_beats_published: number | null;
        max_battles_created_per_month: number | null;
        commission_rate: number;
        stripe_price_id: string | null;
        amount_cents: number | null;
        is_active: boolean;
      } => Boolean(row.tier))
      .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

    const plansWithPricing = await Promise.all(
      plans.map(async (plan) => {
        const basePlan = {
          ...plan,
          amount_cents: plan.amount_cents,
          currency: "eur" as string | null,
          interval: plan.tier === "user" ? null : "month",
          stripe_price_active: null as boolean | null,
        };

        const needsStripeLookup = Boolean(
          stripeSecret &&
          plan.stripe_price_id &&
          basePlan.amount_cents === null,
        );

        if (!needsStripeLookup || !stripeSecret || !plan.stripe_price_id) return basePlan;

        const stripePrice = await fetchStripePriceCached(stripeSecret, plan.stripe_price_id);
        return {
          ...basePlan,
          amount_cents: stripePrice?.amount_cents ?? null,
          currency: stripePrice?.currency ?? basePlan.currency,
          interval: stripePrice?.interval ?? basePlan.interval,
          stripe_price_active: stripePrice?.stripe_price_active ?? null,
        };
      }),
    );

    const payload = { plans: plansWithPricing };
    plansResponseCache = {
      payload,
      expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        ...jsonHeaders,
        "Cache-Control": SUCCESS_CACHE_CONTROL,
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("UNEXPECTED_ERROR", {
      function: "get-producer-plans",
      error: error instanceof Error ? error.message : String(error),
    });

    if (plansResponseCache) {
      return new Response(JSON.stringify(plansResponseCache.payload), {
        status: 200,
        headers: {
          ...jsonHeaders,
          "Cache-Control": SUCCESS_CACHE_CONTROL,
          "X-Cache": "STALE",
        },
      });
    }

    return new Response(JSON.stringify({ error: "Failed to load producer plans" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
