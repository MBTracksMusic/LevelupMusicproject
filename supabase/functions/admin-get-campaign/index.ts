import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireAdminUser } from "../_shared/auth.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type CampaignProducerRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  founding_trial_start: string | null;
};

type CampaignRow = {
  type: string;
  label: string;
  max_slots: number | null;
  is_active: boolean;
  trial_duration: string | null;
};

type CampaignProducerResponse = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  founding_trial_start: string | null;
  founding_trial_end: string | null;
  founding_trial_active: boolean;
};

type IntervalParts = {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const EMPTY_INTERVAL: IntervalParts = {
  years: 0,
  months: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

const parseInterval = (value: string | null): IntervalParts => {
  if (!value) return EMPTY_INTERVAL;

  const result: IntervalParts = { ...EMPTY_INTERVAL };
  const normalized = value.trim().toLowerCase();
  const tokenRe = /(-?\d+(?:\.\d+)?)\s*(years?|year|yrs?|yr|y|mons?|months?|mon|days?|day|hours?|hour|hrs?|hr|h|minutes?|minute|mins?|min|m(?!on)|seconds?|second|secs?|sec|s)\b/g;

  for (const match of normalized.matchAll(tokenRe)) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) continue;

    if (unit.startsWith("y")) result.years += amount;
    else if (unit.startsWith("mon")) result.months += amount;
    else if (unit.startsWith("day")) result.days += amount;
    else if (unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")) result.hours += amount;
    else if (unit === "m" || unit.startsWith("min")) result.minutes += amount;
    else if (unit === "s" || unit.startsWith("sec")) result.seconds += amount;
  }

  const timeMatch = normalized.match(/(-?\d{1,2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    const sign = timeMatch[1].startsWith("-") ? -1 : 1;
    const hours = Math.abs(Number(timeMatch[1]));
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3]);

    if (Number.isFinite(hours)) result.hours += sign * hours;
    if (Number.isFinite(minutes)) result.minutes += sign * minutes;
    if (Number.isFinite(seconds)) result.seconds += sign * seconds;
  }

  return result;
};

const addInterval = (isoDate: string | null, interval: string | null): string | null => {
  if (!isoDate) return null;

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  const parsed = parseInterval(interval);
  const next = new Date(date);

  if (parsed.years !== 0) next.setUTCFullYear(next.getUTCFullYear() + parsed.years);
  if (parsed.months !== 0) next.setUTCMonth(next.getUTCMonth() + parsed.months);
  if (parsed.days !== 0) next.setUTCDate(next.getUTCDate() + parsed.days);
  if (parsed.hours !== 0) next.setUTCHours(next.getUTCHours() + parsed.hours);
  if (parsed.minutes !== 0) next.setUTCMinutes(next.getUTCMinutes() + parsed.minutes);
  if (parsed.seconds !== 0) next.setUTCSeconds(next.getUTCSeconds() + parsed.seconds);

  return next.toISOString();
};

const isTrialActive = (trialEnd: string | null) => {
  if (!trialEnd) return false;
  const trialEndDate = new Date(trialEnd);
  if (Number.isNaN(trialEndDate.getTime())) return false;
  return Date.now() < trialEndDate.getTime();
};

serveWithErrorHandling("admin-get-campaign", async (req: Request): Promise<Response> => {
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  try {
    const authContext = await requireAdminUser(req, corsHeaders);
    if ("error" in authContext) {
      return authContext.error;
    }

    const { supabaseAdmin } = authContext;

    const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || Array.isArray(payload)) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const campaignType = asNonEmptyString(payload.campaign_type);
    if (!campaignType) {
      return new Response(JSON.stringify({ error: "Invalid or missing campaign_type" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Fetch campaign config (slots info)
    const { data: campaignData, error: campaignError } = await supabaseAdmin
      .from("producer_campaigns")
      .select("type, label, max_slots, is_active, trial_duration")
      .eq("type", campaignType)
      .maybeSingle();
    const campaignRow = campaignData as CampaignRow | null;

    if (campaignError) {
      console.error("[admin-get-campaign] failed to load campaign", {
        campaignType,
        message: campaignError.message,
      });
      return new Response(JSON.stringify({ error: "Unable to load campaign config" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!campaignRow) {
      return new Response(JSON.stringify({ error: "campaign_not_found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const { data: producersData, error: producersError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, username, full_name, email, founding_trial_start")
      .eq("producer_campaign_type", campaignType)
      .order("founding_trial_start", { ascending: true });
    const producers = (producersData ?? null) as CampaignProducerRow[] | null;

    if (producersError) {
      console.error("[admin-get-campaign]", {
        campaignType,
        message: producersError.message,
        code: producersError.code,
      });
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const normalizedProducers: CampaignProducerResponse[] = Array.isArray(producers)
      ? producers.map((producer) => {
          const foundingTrialEnd = addInterval(
            producer.founding_trial_start,
            campaignRow.trial_duration,
          );

          return {
            user_id: producer.id,
            username: producer.username,
            full_name: producer.full_name,
            email: producer.email,
            founding_trial_start: producer.founding_trial_start,
            founding_trial_end: foundingTrialEnd,
            founding_trial_active: isTrialActive(foundingTrialEnd),
          };
        })
      : [];

    const slots_used = normalizedProducers.length;

    return new Response(
      JSON.stringify({
        campaign: {
          type: campaignRow.type,
          label: campaignRow.label,
          max_slots: campaignRow.max_slots ?? null,
          is_active: campaignRow.is_active,
          trial_duration: campaignRow.trial_duration ?? null,
          slots_used,
          slots_remaining: campaignRow.max_slots != null
            ? Math.max(0, campaignRow.max_slots - slots_used)
            : null,
        },
        producers: normalizedProducers,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    console.error("[admin-get-campaign]", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
