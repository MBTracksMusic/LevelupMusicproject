import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface CheckoutBody {
  tier?: string;
  success_url?: string;
  cancel_url?: string;
}

type CheckoutTier = "producteur" | "elite";
const CHECKOUT_TIERS = new Set<CheckoutTier>(["producteur", "elite"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

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

const isTruthy = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey, x-supabase-auth",
};

Deno.serve(async (req: Request) => {
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
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("ENV_ERROR", {
        function: "producer-checkout",
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
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

    const authHeader =
      req.headers.get("x-supabase-auth") ||
      req.headers.get("Authorization") ||
      "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );

    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized: missing bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: authError?.message || "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const body: CheckoutBody = await req.json();
    const parsedTier = body.tier === undefined ? "producteur" : normalizeTier(body.tier);
    const requestedTier = parsedTier;
    const successUrl = body.success_url || `${req.headers.get("origin")}/pricing?status=success`;
    const cancelUrl = body.cancel_url || `${req.headers.get("origin")}/pricing?status=cancel`;

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

    if (!tierPlan) {
      return new Response(JSON.stringify({ error: "plan_unavailable" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tierPlan.is_active !== true) {
      return new Response(JSON.stringify({ error: "plan_unavailable" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dbPriceId = typeof tierPlan.stripe_price_id === "string" && tierPlan.stripe_price_id.trim().length > 0
      ? tierPlan.stripe_price_id.trim()
      : null;
    let priceId = dbPriceId;

    if (!priceId && isTruthy(Deno.env.get("PRODUCER_CHECKOUT_ALLOW_ENV_FALLBACK"))) {
      const fallbackPriceId = requestedTier === "elite"
        ? Deno.env.get("STRIPE_PRODUCER_ELITE_PRICE_ID")
        : Deno.env.get("STRIPE_PRODUCER_PRICE_ID");
      if (typeof fallbackPriceId === "string" && fallbackPriceId.trim().length > 0) {
        priceId = fallbackPriceId.trim();
        console.warn("EMERGENCY_ENV_FALLBACK", {
          function: "producer-checkout",
          requestedTier,
          reason: "missing_db_price_id",
        });
      }
    }

    if (!priceId) {
      console.error("CONFIG_ERROR", {
        function: "producer-checkout",
        reason: "missing_price_id",
        requestedTier,
      });
      return new Response(JSON.stringify({ error: "Stripe price ID not configured for tier" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      new URL(successUrl);
      new URL(cancelUrl);
    } catch {
      console.error("CONFIG_ERROR", {
        function: "producer-checkout",
        reason: "invalid_redirect_urls",
        successUrl,
        cancelUrl,
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
