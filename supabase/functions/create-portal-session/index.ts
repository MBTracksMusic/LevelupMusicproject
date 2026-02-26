import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface PortalRequestBody {
  returnUrl?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey, x-supabase-auth",
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
};

const getDefaultReturnUrl = (req: Request): string | null => {
  const appUrl = asNonEmptyString(Deno.env.get("APP_URL"));
  const siteUrl = asNonEmptyString(Deno.env.get("SITE_URL"));
  const origin = asNonEmptyString(req.headers.get("origin"));

  return normalizeUrl(appUrl) || normalizeUrl(siteUrl) || normalizeUrl(origin);
};

const truncateUserId = (userId: string) => {
  if (userId.length <= 8) return userId;
  return `${userId.slice(0, 8)}...`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecret) {
      console.error("ENV_ERROR", {
        function: "create-portal-session",
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
        hasStripeSecretKey: Boolean(stripeSecret),
      });
      return jsonResponse({ error: "Server not configured" }, 500);
    }

    const authHeader =
      req.headers.get("x-supabase-auth") ||
      req.headers.get("Authorization") ||
      "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!jwt) {
      return jsonResponse({ error: "Unauthorized" }, 401);
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

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(jwt);

    if (!user || authError) {
      return jsonResponse({ error: authError?.message || "Unauthorized" }, 401);
    }

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
    const returnUrl = requestedReturnUrl ? normalizeUrl(requestedReturnUrl) : fallbackReturnUrl;

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
