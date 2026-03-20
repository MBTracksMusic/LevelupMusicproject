import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

interface CheckoutBody {
  tier?: string;
  success_url?: string;
  cancel_url?: string;
}

type CheckoutTier = "producteur" | "elite";
const CHECKOUT_TIERS = new Set<CheckoutTier>(["producteur", "elite"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const KNOWN_PLACEHOLDER_PRICE_IDS = new Set([
  "price_xxxxxxxx",
  "price_yyyyyyyy",
  "price_producer_monthly",
  "price_elite_monthly",
  "price_xxx",
  "price_replace_me",
]);

const isKnownPlaceholderPriceId = (value: string) => {
  return KNOWN_PLACEHOLDER_PRICE_IDS.has(value.trim().toLowerCase());
};

const isProduction = () => {
  const runtimeEnv = (Deno.env.get("ENV") ?? Deno.env.get("NODE_ENV") ?? "").trim().toLowerCase();
  return runtimeEnv === "production" || runtimeEnv === "prod";
};

const isFutureTimestamp = (value: string | null | undefined) => {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.now();
};

const normalizeTier = (value: unknown): CheckoutTier | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "pro") return "producteur";
  if (CHECKOUT_TIERS.has(normalized as CheckoutTier)) {
    return normalized as CheckoutTier;
  }
  return null;
};

const TRUSTED_VERCEL_PREVIEW_ORIGIN_REGEX = /^https:\/\/[a-z0-9-]+-mbtracksmusics-projects\.vercel\.app$/i;

const isTrustedVercelPreviewOrigin = (origin: string) => TRUSTED_VERCEL_PREVIEW_ORIGIN_REGEX.test(origin);

const DEFAULT_ALLOWED_REDIRECT_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const resolveAllowedRedirectOrigins = () => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_REDIRECT_ORIGINS);
  const csvAllowlist = Deno.env.get("CHECKOUT_REDIRECT_ALLOWLIST");

  if (typeof csvAllowlist === "string" && csvAllowlist.trim().length > 0) {
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

  if (!isProduction()) {
    allowed.add("http://localhost:5173");
    allowed.add("http://127.0.0.1:5173");
    allowed.add("http://dev.beatelion.local:5173");
  }

  return allowed;
};

const ALLOWED_REDIRECT_ORIGINS = resolveAllowedRedirectOrigins();

const validateRedirectUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return null;
    }
    if (!ALLOWED_REDIRECT_ORIGINS.has(parsed.origin) && !isTrustedVercelPreviewOrigin(parsed.origin)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const resolveDefaultRedirectOrigin = (req: Request): string => {
  for (const candidate of [
    req.headers.get("origin"),
    Deno.env.get("APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("VITE_APP_URL"),
  ]) {
    if (typeof candidate !== "string") continue;
    const normalized = normalizeOrigin(candidate.trim());
    if (normalized && (ALLOWED_REDIRECT_ORIGINS.has(normalized) || isTrustedVercelPreviewOrigin(normalized))) {
      return normalized;
    }
  }

  return DEFAULT_ALLOWED_REDIRECT_ORIGINS[0];
};

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

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

const buildCorsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? DEFAULT_ALLOWED_CORS_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Vary": "Origin",
});

const resolveRequestCorsOrigin = (req: Request): string | null => {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  const n = normalizeOrigin(raw);
  if (!n) return null;
  if (ALLOWED_CORS_ORIGINS.has(n)) return n;
  if (isTrustedVercelPreviewOrigin(n)) return n;
  return null;
};

serveWithErrorHandling("producer-checkout", async (req: Request) => {
  const corsHeaders = buildCorsHeaders(resolveRequestCorsOrigin(req));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
      console.error("ENV_ERROR", {
        function: "producer-checkout",
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
        hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      });
      return new Response(JSON.stringify({
        error: "Supabase not configured (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing)",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!stripeSecret) {
      console.error("ENV_ERROR", {
        function: "producer-checkout",
        hasStripeSecretKey: false,
      });
      return new Response(JSON.stringify({ error: "Stripe not configured (STRIPE_SECRET_KEY missing)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authorizationHeader = req.headers.get("Authorization");

    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );

    if (!authorizationHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized: missing bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      console.error("AUTH_ERROR", {
        function: "producer-checkout",
        hasAuthorizationHeader: Boolean(authorizationHeader),
        message: authError?.message ?? null,
      });
      return new Response(JSON.stringify({ error: authError?.message || "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("JWT_USER", user?.id);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("stripe_customer_id, email, is_deleted, deleted_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("DB_ERROR", {
        function: "producer-checkout",
        stage: "load_profile",
        userId: user.id,
        message: profileError.message,
      });
      return new Response(JSON.stringify({ error: "Unable to verify account status" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile || profile.is_deleted === true || profile.deleted_at !== null) {
      return new Response(JSON.stringify({ error: "Account deleted" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Guardrail: avoid creating a new checkout session if the user already has an active producer subscription.
    const { data: existingProducerSubscription, error: existingProducerSubscriptionError } = await supabaseAdmin
      .from("producer_subscriptions")
      .select("subscription_status, current_period_end, is_producer_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingProducerSubscriptionError) {
      console.error("DB_ERROR", {
        function: "producer-checkout",
        stage: "check_existing_subscription",
        message: existingProducerSubscriptionError.message,
      });
      return new Response(JSON.stringify({ error: "Unable to verify current subscription status" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const alreadySubscribed = Boolean(
      existingProducerSubscription && (
        existingProducerSubscription.is_producer_active === true ||
        (
          typeof existingProducerSubscription.subscription_status === "string" &&
          ACTIVE_SUBSCRIPTION_STATUSES.has(existingProducerSubscription.subscription_status) &&
          isFutureTimestamp(existingProducerSubscription.current_period_end)
        )
      ),
    );

    if (alreadySubscribed) {
      return new Response(JSON.stringify({ error: "already_subscribed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingUserSubscription, error: existingUserSubscriptionError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("subscription_status, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingUserSubscriptionError) {
      console.error("DB_ERROR", {
        function: "producer-checkout",
        stage: "check_conflicting_user_subscription",
        message: existingUserSubscriptionError.message,
      });
      return new Response(JSON.stringify({ error: "Unable to verify current subscription exclusivity" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasActiveUserSubscription = Boolean(
      existingUserSubscription &&
      typeof existingUserSubscription.subscription_status === "string" &&
      ACTIVE_SUBSCRIPTION_STATUSES.has(existingUserSubscription.subscription_status) &&
      (
        typeof existingUserSubscription.current_period_end !== "string" ||
        Date.parse(existingUserSubscription.current_period_end) > Date.now()
      )
    );

    if (hasActiveUserSubscription) {
      return new Response(JSON.stringify({ error: "subscription_conflict_user_active" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: CheckoutBody = await req.json();
    const parsedTier = body.tier === undefined ? "producteur" : normalizeTier(body.tier);
    const requestedTier = parsedTier;
    console.log("CHECKOUT_TIER", requestedTier);
    const defaultRedirectOrigin = resolveDefaultRedirectOrigin(req);
    const successUrlInput = body.success_url || `${defaultRedirectOrigin}/pricing?status=success`;
    const cancelUrlInput = body.cancel_url || `${defaultRedirectOrigin}/pricing?status=cancel`;
    const successUrl = validateRedirectUrl(successUrlInput);
    const cancelUrl = validateRedirectUrl(cancelUrlInput);

    if (!requestedTier) {
      return new Response(JSON.stringify({ error: "invalid_tier" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tierPlan, error: tierPlanError } = await supabaseAdmin
      .from("producer_plans")
      .select("stripe_price_id, is_active")
      .eq("tier", requestedTier)
      .maybeSingle();

    if (tierPlanError) {
      console.error("DB_ERROR", {
        function: "producer-checkout",
        stage: "resolve_tier_plan",
        requestedTier,
        message: tierPlanError.message,
      });
      return new Response(JSON.stringify({ error: "Unable to resolve producer tier plan" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tierPlan && tierPlan.is_active !== true) {
      return new Response(JSON.stringify({ error: "plan_unavailable" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envFallbackPriceId =
      requestedTier === "elite"
        ? Deno.env.get("STRIPE_PRODUCER_ELITE_PRICE_ID")
        : (Deno.env.get("STRIPE_PRODUCER_PRICE_ID") ||
          Deno.env.get("STRIPE_PRICE_PRODUCER"));
    const normalizedEnvFallbackPriceId =
      typeof envFallbackPriceId === "string" && envFallbackPriceId.trim().length > 0
        ? envFallbackPriceId.trim()
        : null;
    const rawDbPriceId = typeof tierPlan?.stripe_price_id === "string" && tierPlan.stripe_price_id.trim().length > 0
      ? tierPlan.stripe_price_id.trim()
      : null;
    const dbPriceId = rawDbPriceId && !isKnownPlaceholderPriceId(rawDbPriceId)
      ? rawDbPriceId
      : null;
    const priceId = dbPriceId || normalizedEnvFallbackPriceId;

    if (rawDbPriceId && !dbPriceId) {
      console.warn("DB_PLACEHOLDER_PRICE_IGNORED", {
        function: "producer-checkout",
        requestedTier,
      });
    }

    if (!dbPriceId && normalizedEnvFallbackPriceId) {
      console.warn("EMERGENCY_ENV_FALLBACK", {
        function: "producer-checkout",
        requestedTier,
        reason: !tierPlan ? "missing_tier_plan_row" : "missing_db_price_id",
      });
    }

    if (!priceId) {
      console.error("CONFIG_ERROR", {
        function: "producer-checkout",
        reason: "stripe_price_not_configured",
        requestedTier,
      });
      return new Response(JSON.stringify({
        error: "stripe_price_not_configured",
        message: "Missing Stripe price ID for tier",
        tier: requestedTier,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("STRIPE_PRICE_USED", priceId);

    if (!successUrl || !cancelUrl) {
      console.error("CONFIG_ERROR", {
        function: "producer-checkout",
        reason: "invalid_redirect_urls",
        successUrl: successUrlInput,
        cancelUrl: cancelUrlInput,
      });
      return new Response(JSON.stringify({ error: "Invalid success_url or cancel_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let customerId = profile?.stripe_customer_id || null;

    if (!customerId) {
      const createCustomerResp = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: user.email ?? "",
          "metadata[user_id]": user.id,
        }),
      });

      const customer = await createCustomerResp.json();
      if (customer.error) {
        console.error("STRIPE_ERROR", {
          function: "producer-checkout",
          stage: "create_customer",
          message: customer.error?.message,
          type: customer.error?.type,
          code: customer.error?.code,
        });
        return new Response(JSON.stringify({ error: customer.error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      customerId = customer.id;

      await supabaseAdmin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Create subscription checkout session
    const sessionParams = new URLSearchParams({
      mode: "subscription",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "metadata[user_id]": user.id,
      "metadata[requested_tier]": requestedTier,
      "subscription_data[metadata][user_id]": user.id,
      "subscription_data[metadata][requested_tier]": requestedTier,
    });

    const sessionResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: sessionParams.toString(),
    });

    const session = await sessionResp.json();
    if (!sessionResp.ok || session.error) {
      console.error("STRIPE_ERROR", {
        function: "producer-checkout",
        stage: "create_checkout_session",
        status: sessionResp.status,
        message: session.error?.message,
        type: session.error?.type,
        code: session.error?.code,
        param: session.error?.param,
        priceId,
      });
      const message = session.error?.message || session.error || "Stripe checkout failed";
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("UNEXPECTED_ERROR", {
      function: "producer-checkout",
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ error: "Failed to create checkout session" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
