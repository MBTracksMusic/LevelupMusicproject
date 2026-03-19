import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

interface PortalRequestBody {
  returnUrl?: string;
}

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
];

const buildCorsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? DEFAULT_ALLOWED_CORS_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Vary": "Origin",
});

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const DEFAULT_ALLOWED_REDIRECT_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
];

const normalizeOrigin = (value: string): string | null => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const resolveAllowedRedirectOrigins = () => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_REDIRECT_ORIGINS);

  for (const csvAllowlist of [
    Deno.env.get("PORTAL_REDIRECT_ALLOWLIST"),
    Deno.env.get("CHECKOUT_REDIRECT_ALLOWLIST"),
  ]) {
    if (typeof csvAllowlist !== "string" || csvAllowlist.trim().length === 0) continue;

    for (const token of csvAllowlist.split(",")) {
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

const ALLOWED_REDIRECT_ORIGINS = resolveAllowedRedirectOrigins();

const ALLOWED_CORS_ORIGINS = (() => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);
  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const n = normalizeOrigin(token.trim());
      if (n) allowed.add(n);
    }
  }
  for (const o of ALLOWED_REDIRECT_ORIGINS) allowed.add(o);
  return allowed;
})();

const resolveRequestCorsOrigin = (req: Request): string | null => {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  const n = normalizeOrigin(raw);
  return n && ALLOWED_CORS_ORIGINS.has(n) ? n : null;
};

const validateRedirectUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return null;
    }
    if (!ALLOWED_REDIRECT_ORIGINS.has(parsed.origin)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const getDefaultReturnUrl = (req: Request): string | null => {
  for (const candidate of [
    asNonEmptyString(Deno.env.get("APP_URL")),
    asNonEmptyString(Deno.env.get("SITE_URL")),
    asNonEmptyString(req.headers.get("origin")),
    DEFAULT_ALLOWED_REDIRECT_ORIGINS[0],
  ]) {
    const validated = validateRedirectUrl(candidate);
    if (validated) {
      return validated;
    }
  }

  return null;
};

const truncateUserId = (userId: string) => {
  if (userId.length <= 8) return userId;
  return `${userId.slice(0, 8)}...`;
};

serveWithErrorHandling("create-portal-session", async (req: Request) => {
  const corsHeaders = buildCorsHeaders(resolveRequestCorsOrigin(req));
  const jsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey || !stripeSecret) {
      console.error("ENV_ERROR", {
        function: "create-portal-session",
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
        hasSupabaseAnonKey: Boolean(supabaseAnonKey),
        hasStripeSecretKey: Boolean(stripeSecret),
      });
      return jsonResponse({ error: "Server not configured" }, 500);
    }

    const authorizationHeader = req.headers.get("Authorization");
    if (!authorizationHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUser = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: authorizationHeader,
          },
        },
      },
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (!user || authError) {
      console.error("AUTH_ERROR", {
        function: "create-portal-session",
        hasAuthorizationHeader: Boolean(authorizationHeader),
        message: authError?.message ?? null,
      });
      return jsonResponse({ error: authError?.message || "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    let body: PortalRequestBody = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const fallbackReturnUrl = getDefaultReturnUrl(req);
    if (!fallbackReturnUrl) {
      console.error("CONFIG_ERROR", {
        function: "create-portal-session",
        reason: "missing_return_url_fallback",
      });
      return jsonResponse({ error: "missing_return_url_config" }, 500);
    }

    const requestedReturnUrl = asNonEmptyString(body.returnUrl);
    const returnUrl = requestedReturnUrl ? validateRedirectUrl(requestedReturnUrl) : fallbackReturnUrl;

    if (!returnUrl) {
      return jsonResponse({ error: "invalid_return_url" }, 400);
    }

    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from("producer_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subscriptionError) {
      console.error("DB_ERROR", {
        function: "create-portal-session",
        stage: "load_subscription",
        userId: truncateUserId(user.id),
        message: subscriptionError.message,
      });
      return jsonResponse({ error: "Unable to resolve subscription" }, 500);
    }

    const stripeCustomerId = asNonEmptyString(subscription?.stripe_customer_id);
    if (!stripeCustomerId) {
      return jsonResponse({ error: "no_stripe_customer" }, 400);
    }

    const sessionParams = new URLSearchParams({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    const portalSessionResponse = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: sessionParams.toString(),
    });

    const portalSession = await portalSessionResponse.json() as {
      url?: unknown;
      error?: {
        message?: string;
        type?: string;
        code?: string;
        param?: string;
      } | string;
    };

    const stripeError = portalSession.error;
    const stripeErrorMessage = typeof stripeError === "string"
      ? stripeError
      : stripeError?.message;

    if (!portalSessionResponse.ok || stripeError) {
      console.error("STRIPE_ERROR", {
        function: "create-portal-session",
        stage: "create_billing_portal_session",
        userId: truncateUserId(user.id),
        status: portalSessionResponse.status,
        message: stripeErrorMessage,
        type: typeof stripeError === "object" ? stripeError?.type : undefined,
        code: typeof stripeError === "object" ? stripeError?.code : undefined,
      });
      return jsonResponse({ error: stripeErrorMessage || "Failed to create portal session" }, 400);
    }

    const portalUrl = asNonEmptyString(portalSession.url);
    if (!portalUrl) {
      console.error("STRIPE_ERROR", {
        function: "create-portal-session",
        stage: "parse_billing_portal_session",
        userId: truncateUserId(user.id),
        reason: "missing_url",
      });
      return jsonResponse({ error: "invalid_stripe_portal_response" }, 500);
    }

    return jsonResponse({ url: portalUrl }, 200);
  } catch (error) {
    console.error("UNEXPECTED_ERROR", {
      function: "create-portal-session",
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "Failed to create portal session" }, 500);
  }
});
