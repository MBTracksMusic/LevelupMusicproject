import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthUser } from "../_shared/auth.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const CREATE_CHECKOUT_RATE_LIMIT_RPC = "create_checkout_user";

interface CheckoutRequest {
  beatId?: string;
  productId?: string;
  licenseId?: string;
  license_id?: string;
  licenseType?: string;
  successUrl?: string;
  cancelUrl?: string;
  success_url?: string;
  cancel_url?: string;
  price_id?: string;
  priceId?: string;
  subscription_kind?: string;
}

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  early_access_until: string | null;
  cover_image_url: string | null;
  producer_id: string;
  is_exclusive: boolean;
  is_sold: boolean;
  is_published: boolean;
  deleted_at: string | null;
  product_type: string;
  status: string;
}

interface LicenseRow {
  id: string;
  name: string;
  price: number;
  exclusive_allowed: boolean;
}

interface ProductLicenseRow {
  id: string;
  product_id: string;
  license_id: string;
  license_type: string;
  price: number;
  stripe_price_id: string | null;
  is_active: boolean;
  license: LicenseRow | null;
}

const isProduction = () => {
  const runtimeEnv = (
    Deno.env.get("ENV") ??
    Deno.env.get("NODE_ENV") ??
    Deno.env.get("SENTRY_ENVIRONMENT") ??
    Deno.env.get("ENVIRONMENT") ??
    ""
  ).trim().toLowerCase();
  return runtimeEnv === "production" || runtimeEnv === "prod";
};

const DEFAULT_ALLOWED_REDIRECT_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const normalizeOrigin = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return null;
  }
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getConfiguredUserSubscriptionPriceIds = () => {
  const ids = new Set<string>();

  for (const raw of [
    asNonEmptyString(Deno.env.get("STRIPE_USER_SUBSCRIPTION_PRICE_ID")),
    asNonEmptyString(Deno.env.get("STRIPE_USER_MONTHLY_PRICE_ID")),
  ]) {
    if (raw) ids.add(raw);
  }

  for (const csv of [
    asNonEmptyString(Deno.env.get("STRIPE_USER_SUBSCRIPTION_PRICE_IDS")),
    asNonEmptyString(Deno.env.get("STRIPE_USER_MONTHLY_PRICE_IDS")),
  ]) {
    if (!csv) continue;
    for (const token of csv.split(",")) {
      const value = asNonEmptyString(token);
      if (value) ids.add(value);
    }
  }

  return ids;
};

const USER_SUBSCRIPTION_PRICE_IDS = getConfiguredUserSubscriptionPriceIds();

const TRUSTED_VERCEL_PREVIEW_ORIGIN_REGEX = /^https:\/\/[a-z0-9-]+-mbtracksmusics-projects\.vercel\.app$/i;

const isTrustedVercelPreviewOrigin = (origin: string) => TRUSTED_VERCEL_PREVIEW_ORIGIN_REGEX.test(origin);

const resolveAllowedRedirectOrigins = () => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_REDIRECT_ORIGINS);

  const csvAllowlist = asNonEmptyString(Deno.env.get("CHECKOUT_REDIRECT_ALLOWLIST"));
  if (csvAllowlist) {
    for (const token of csvAllowlist.split(",")) {
      const origin = normalizeOrigin(token.trim());
      if (origin) allowed.add(origin);
    }
  }

  for (const envValue of [
    Deno.env.get("APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("VITE_APP_URL"),
  ]) {
    const normalized = envValue ? normalizeOrigin(envValue) : null;
    if (normalized) allowed.add(normalized);
  }

  if (!isProduction()) {
    allowed.add("http://localhost:5173");
    allowed.add("http://127.0.0.1:5173");
    allowed.add("http://dev.beatelion.local:5173");
  }

  return allowed;
};

const ALLOWED_REDIRECT_ORIGINS = resolveAllowedRedirectOrigins();

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const resolveAllowedCorsOrigins = () => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);

  const csvAllowlist = asNonEmptyString(Deno.env.get("CORS_ALLOWED_ORIGINS"));
  if (csvAllowlist) {
    for (const token of csvAllowlist.split(",")) {
      const origin = normalizeOrigin(token.trim());
      if (origin) allowed.add(origin);
    }
  }

  for (const origin of ALLOWED_REDIRECT_ORIGINS) {
    allowed.add(origin);
  }

  for (const envValue of [
    Deno.env.get("APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("VITE_APP_URL"),
  ]) {
    const normalized = envValue ? normalizeOrigin(envValue) : null;
    if (normalized) allowed.add(normalized);
  }

  return allowed;
};

const ALLOWED_CORS_ORIGINS = resolveAllowedCorsOrigins();
const DEFAULT_CORS_ORIGIN = DEFAULT_ALLOWED_CORS_ORIGINS[0];

const resolveRequestOrigin = (req: Request) => {
  const rawOrigin = req.headers.get("origin");
  if (!rawOrigin) return null;
  const normalized = normalizeOrigin(rawOrigin);
  if (!normalized) return null;
  if (ALLOWED_CORS_ORIGINS.has(normalized)) return normalized;
  if (isTrustedVercelPreviewOrigin(normalized)) return normalized;
  return null;
};

const buildCorsHeaders = (origin: string | null) => ({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": origin ?? DEFAULT_CORS_ORIGIN,
  "Vary": "Origin",
});

if (isProduction() && ALLOWED_REDIRECT_ORIGINS.size === 0) {
  throw new Error("Missing checkout redirect allowlist configuration");
}

const validateRedirectUrl = (rawValue: unknown): string | null => {
  const value = asNonEmptyString(rawValue);
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    return null;
  }

  if (!ALLOWED_REDIRECT_ORIGINS.has(parsed.origin) && !isTrustedVercelPreviewOrigin(parsed.origin)) {
    return null;
  }

  return parsed.toString();
};

const isValidCheckoutAmount = (value: unknown): value is number => (
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  Number.isSafeInteger(value) &&
  value > 0
);

const normalizeLicenseLookup = (value: string | null) => value?.trim().toLowerCase() ?? "";

async function fetchProductLicenses(
  supabaseAdmin: ReturnType<typeof createClient>,
  productId: string,
): Promise<ProductLicenseRow[]> {
  const { data, error } = await supabaseAdmin
    .from("product_licenses")
    .select("id, product_id, license_id, license_type, price, stripe_price_id, is_active, license:licenses(id, name, price, exclusive_allowed)")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("price", { ascending: true });

  if (error) {
    console.error("[create-checkout] Product license lookup failed, falling back to product.price", {
      productId,
      message: error.message,
    });
    return [];
  }

  return ((data ?? []) as ProductLicenseRow[]).filter((row) => row.license !== null);
}

async function resolveCheckoutLicense(
  supabaseAdmin: ReturnType<typeof createClient>,
  params: {
    licenseId: string | null;
    licenseType: string | null;
    isExclusiveProduct: boolean;
  },
): Promise<LicenseRow | null> {
  const { licenseId, licenseType, isExclusiveProduct } = params;

  if (licenseId) {
    const { data, error } = await supabaseAdmin
      .from("licenses")
      .select("id, name, price, exclusive_allowed")
      .eq("id", licenseId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load license by id: ${error.message}`);
    }

    if (data) return data as LicenseRow;
  }

  if (licenseType) {
    const { data, error } = await supabaseAdmin
      .from("licenses")
      .select("id, name, price, exclusive_allowed")
      .ilike("name", licenseType)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load license by name: ${error.message}`);
    }

    if (data) return data as LicenseRow;
  }

  if (isExclusiveProduct) {
    const { data, error } = await supabaseAdmin
      .from("licenses")
      .select("id, name, price, exclusive_allowed")
      .eq("exclusive_allowed", true)
      .order("price", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load fallback exclusive license: ${error.message}`);
    }

    if (data) return data as LicenseRow;
  } else {
    const { data, error } = await supabaseAdmin
      .from("licenses")
      .select("id, name, price, exclusive_allowed")
      .ilike("name", "standard")
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load fallback standard license: ${error.message}`);
    }

    if (data) return data as LicenseRow;
  }

  const { data, error } = await supabaseAdmin
    .from("licenses")
    .select("id, name, price, exclusive_allowed")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load fallback license: ${error.message}`);
  }

  return (data as LicenseRow | null) ?? null;
}

serveWithErrorHandling("create-checkout", async (req: Request) => {
  console.log("[create-checkout] request diagnostics", {
    origin: req.headers.get("origin"),
    hasAuthorizationHeader: !!req.headers.get("authorization"),
  });

  const requestOriginHeader = req.headers.get("origin");
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);

  if (requestOriginHeader && !requestOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
    const authResult = await requireAuthUser(req, corsHeaders);
    if ("error" in authResult) return authResult.error;
    const { user, supabaseAdmin } = authResult;

    const { data: rateLimitAllowed, error: rateLimitError } = await supabaseAdmin.rpc(
      "check_rpc_rate_limit",
      {
        p_user_id: user.id,
        p_rpc_name: CREATE_CHECKOUT_RATE_LIMIT_RPC,
      },
    );

    if (rateLimitError) {
      console.error("[create-checkout] Rate limit check failed", {
        userId: user.id,
        rpc: CREATE_CHECKOUT_RATE_LIMIT_RPC,
        rateLimitError,
      });
      return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (rateLimitAllowed !== true) {
      return new Response(JSON.stringify({
        error: "Too many requests",
        code: "rate_limit_exceeded",
      }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      });
    }

    const body: CheckoutRequest = await req.json();
    const {
      beatId,
      productId,
      successUrl: rawSuccessUrl,
      cancelUrl: rawCancelUrl,
    } = body;

    const successUrl = asNonEmptyString(rawSuccessUrl) || asNonEmptyString(body.success_url);
    const cancelUrl = asNonEmptyString(rawCancelUrl) || asNonEmptyString(body.cancel_url);
    const requestedPriceId = asNonEmptyString(body.price_id) || asNonEmptyString(body.priceId);
    const subscriptionKind = asNonEmptyString(body.subscription_kind);
    const resolvedBeatId = asNonEmptyString(beatId) || asNonEmptyString(productId);

    if (subscriptionKind === "user") {
      if (!successUrl || !cancelUrl) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const validatedSuccessUrl = validateRedirectUrl(successUrl);
      const validatedCancelUrl = validateRedirectUrl(cancelUrl);

      if (!validatedSuccessUrl || !validatedCancelUrl) {
        return new Response(JSON.stringify({ error: "invalid_redirect_url" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (USER_SUBSCRIPTION_PRICE_IDS.size === 0) {
        return new Response(JSON.stringify({ error: "missing_user_subscription_price_id" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const resolvedUserPriceId = requestedPriceId ?? USER_SUBSCRIPTION_PRICE_IDS.values().next().value ?? null;

      if (!resolvedUserPriceId) {
        return new Response(JSON.stringify({ error: "missing_user_subscription_price_id" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (requestedPriceId && !USER_SUBSCRIPTION_PRICE_IDS.has(requestedPriceId)) {
        return new Response(JSON.stringify({ error: "invalid_user_subscription_price" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingUserSubscription, error: existingUserSubscriptionError } = await supabaseAdmin
        .from("user_subscriptions")
        .select("subscription_status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingUserSubscriptionError) {
        console.error("[create-checkout] Failed to load user subscription", {
          userId: user.id,
          message: existingUserSubscriptionError.message,
        });
        return new Response(JSON.stringify({ error: "Failed to validate subscription eligibility" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (
        existingUserSubscription &&
        ["active", "trialing"].includes(existingUserSubscription.subscription_status)
      ) {
        return new Response(JSON.stringify({
          error: "already_subscribed_user",
          code: "already_subscribed_user",
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingProducerSubscription, error: existingProducerSubscriptionError } = await supabaseAdmin
        .from("producer_subscriptions")
        .select("subscription_status, current_period_end, is_producer_active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingProducerSubscriptionError) {
        console.error("[create-checkout] Failed to load producer subscription while checking user plan eligibility", {
          userId: user.id,
          message: existingProducerSubscriptionError.message,
        });
        return new Response(JSON.stringify({ error: "Failed to validate subscription exclusivity" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hasActiveProducerSubscription = Boolean(
        existingProducerSubscription && (
          existingProducerSubscription.is_producer_active === true ||
          (
            typeof existingProducerSubscription.subscription_status === "string" &&
            ["active", "trialing"].includes(existingProducerSubscription.subscription_status) &&
            typeof existingProducerSubscription.current_period_end === "string" &&
            Date.parse(existingProducerSubscription.current_period_end) > Date.now()
          )
        ),
      );

      if (hasActiveProducerSubscription) {
        return new Response(JSON.stringify({
          error: "subscription_conflict_producer_active",
          code: "subscription_conflict_producer_active",
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile, error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .select("stripe_customer_id, is_deleted, deleted_at")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error("[create-checkout] Failed to load buyer profile for user subscription", {
          userId: user.id,
          message: profileError.message,
        });
        return new Response(JSON.stringify({ error: "Failed to validate account status" }), {
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

      const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeSecretKey) {
        return new Response(JSON.stringify({ error: "Stripe not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let customerId = profile.stripe_customer_id;

      if (!customerId) {
        const customerResponse = await fetch("https://api.stripe.com/v1/customers", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            email: user.email || "",
            "metadata[user_id]": user.id,
          }),
        });

        const customer = await customerResponse.json();
        if (!customerResponse.ok || !customer?.id) {
          console.error("[create-checkout] Failed to create Stripe customer for user subscription", {
            userId: user.id,
            status: customerResponse.status,
            error: customer?.error?.message ?? "unknown_customer_creation_error",
          });
          return new Response(JSON.stringify({ error: "Impossible de preparer le paiement." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        customerId = customer.id;

        await supabaseAdmin
          .from("user_profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }

      const sessionParams = new URLSearchParams({
        mode: "subscription",
        success_url: validatedSuccessUrl,
        cancel_url: validatedCancelUrl,
        "line_items[0][price]": resolvedUserPriceId,
        "line_items[0][quantity]": "1",
        "client_reference_id": user.id,
        "metadata[user_id]": user.id,
        "metadata[subscription_kind]": "user",
        "subscription_data[metadata][user_id]": user.id,
        "subscription_data[metadata][subscription_kind]": "user",
        "subscription_data[metadata][plan_code]": "user_monthly",
      });

      if (customerId) {
        sessionParams.append("customer", customerId);
      } else {
        sessionParams.append("customer_creation", "always");
      }

      const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: sessionParams,
      });

      const sessionPayload = await sessionResponse.json();

      if (sessionPayload.error || !sessionPayload?.url) {
        console.error("[create-checkout] User subscription checkout session creation failed", {
          userId: user.id,
          status: sessionResponse.status,
          error: sessionPayload?.error?.message ?? "unknown_checkout_error",
        });
        return new Response(JSON.stringify({
          error: sessionPayload?.error?.message ?? "Failed to create checkout session",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ url: sessionPayload.url, sessionId: sessionPayload.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!resolvedBeatId || !successUrl || !cancelUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validatedSuccessUrl = validateRedirectUrl(successUrl);
    const validatedCancelUrl = validateRedirectUrl(cancelUrl);

    if (!validatedSuccessUrl || !validatedCancelUrl) {
      return new Response(JSON.stringify({ error: "invalid_redirect_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, title, slug, price, early_access_until, cover_image_url, producer_id, is_exclusive, is_sold, is_published, deleted_at, product_type, status")
      .eq("id", resolvedBeatId)
      .maybeSingle();

    if (productError || !product) {
      console.warn("[create-checkout] Product lookup failed", {
        beatId: resolvedBeatId,
        message: productError?.message ?? "product_not_found",
      });
      return new Response(JSON.stringify({ error: "Beat introuvable ou indisponible." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productRow = product as ProductRow;

    if (productRow.producer_id === user.id) {
      console.warn("SECURITY: self_purchase_attempt", {
        user_id: user.id,
        product_id: productRow.id,
      });

      return new Response(JSON.stringify({
        error: "Forbidden: self purchase",
        code: "self_purchase_forbidden",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!productRow.is_published || productRow.deleted_at !== null) {
      return new Response(JSON.stringify({ error: "Beat introuvable ou indisponible." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (productRow.status !== "active") {
      return new Response(JSON.stringify({ error: "Beat introuvable ou indisponible." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (productRow.is_exclusive && productRow.is_sold) {
      return new Response(JSON.stringify({ error: "This exclusive has already been sold" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Block re-purchase: reject checkout if user already owns this product.
    // This is a server-side guard; the DB partial unique index is the hard enforcement.
    const { data: existingPurchase, error: purchaseCheckError } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("product_id", resolvedBeatId)
      .eq("status", "completed")
      .maybeSingle();

    if (purchaseCheckError) {
      console.error("[create-checkout] Failed to check existing purchase", {
        userId: user.id,
        beatId: resolvedBeatId,
        message: purchaseCheckError.message,
      });
      return new Response(JSON.stringify({ error: "Failed to validate purchase eligibility" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingPurchase) {
      console.warn("[create-checkout] User already owns this product", {
        userId: user.id,
        beatId: resolvedBeatId,
        existingPurchaseId: existingPurchase.id,
      });
      return new Response(JSON.stringify({
        error: "Vous avez déjà acheté ce produit.",
        code: "already_purchased",
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Block concurrent checkout attempts: rate-limit per (user, product) pair.
    // Purchases are only created after Stripe webhook, so no pending row exists before payment.
    // The rate limit RPC uses a product-scoped key to prevent multiple active sessions.
    const productRateLimitKey = `create_checkout_user_product_${resolvedBeatId}`;
    const { data: productRateLimitAllowed, error: productRateLimitError } = await supabaseAdmin.rpc(
      "check_rpc_rate_limit",
      {
        p_user_id: user.id,
        p_rpc_name: productRateLimitKey,
      },
    );

    if (productRateLimitError) {
      console.error("[create-checkout] Product-level rate limit check failed", {
        userId: user.id,
        beatId: resolvedBeatId,
        rpc: productRateLimitKey,
        productRateLimitError,
      });
      return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (productRateLimitAllowed !== true) {
      console.warn("[create-checkout] Concurrent checkout attempt blocked", {
        userId: user.id,
        beatId: resolvedBeatId,
      });
      return new Response(JSON.stringify({
        error: "Un paiement est déjà en cours pour ce produit.",
        code: "checkout_in_progress",
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("role, stripe_customer_id, is_deleted, deleted_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[create-checkout] Failed to load buyer profile", {
        userId: user.id,
        message: profileError.message,
      });
      return new Response(JSON.stringify({ error: "Failed to validate account status" }), {
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

    const { data: producerProfile, error: producerProfileError } = await supabaseAdmin
      .from("user_profiles")
      .select("is_deleted, deleted_at, stripe_account_id, stripe_account_charges_enabled")
      .eq("id", productRow.producer_id)
      .maybeSingle();

    if (producerProfileError) {
      console.error("[create-checkout] Failed to load producer profile", {
        producerId: productRow.producer_id,
        message: producerProfileError.message,
      });
      return new Response(JSON.stringify({ error: "Failed to validate product availability" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!producerProfile || producerProfile.is_deleted === true || producerProfile.deleted_at !== null) {
      return new Response(JSON.stringify({ error: "Account deleted" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stripe Connect: Check if producer has completed onboarding (optional feature)
    const hasStripeConnect =
      producerProfile?.stripe_account_id &&
      producerProfile?.stripe_account_charges_enabled;

    if (!hasStripeConnect) {
      console.warn("[create-checkout] Connect not ready → fallback to simple Stripe", {
        producerId: productRow.producer_id,
        hasAccountId: !!producerProfile?.stripe_account_id,
        chargesEnabled: producerProfile?.stripe_account_charges_enabled,
      });
    }

    if (
      productRow.product_type === "beat" &&
      typeof productRow.early_access_until === "string" &&
      new Date(productRow.early_access_until).getTime() > Date.now() &&
      profile?.role !== "admin"
    ) {
      const { data: userSubscription, error: userSubscriptionError } = await supabaseAdmin
        .from("user_subscriptions")
        .select("subscription_status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();

      if (userSubscriptionError) {
        console.error("[create-checkout] Failed to load buyer subscription for early access", {
          userId: user.id,
          beatId: resolvedBeatId,
          message: userSubscriptionError.message,
        });
        return new Response(JSON.stringify({ error: "Failed to validate product availability" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hasPremiumAccess =
        userSubscription !== null &&
        ["active", "trialing"].includes(userSubscription.subscription_status) &&
        (
          userSubscription.current_period_end === null ||
          new Date(userSubscription.current_period_end).getTime() > Date.now()
        );

      if (!hasPremiumAccess) {
        return new Response(JSON.stringify({
          error: "Disponible bientôt",
          code: "early_access_premium_only",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (productRow.is_exclusive) {
      let canPurchaseExclusive = false;
      const { data: isConfirmedData, error: isConfirmedError } = await supabaseAdmin.rpc(
        "is_confirmed_user",
        { p_user_id: user.id },
      );

      if (isConfirmedError) {
        // Backward compatibility fallback when helper function is unavailable.
        canPurchaseExclusive = Boolean(
          profile?.role && ["confirmed_user", "producer", "admin"].includes(profile.role),
        );
      } else {
        canPurchaseExclusive = isConfirmedData === true;
      }

      if (!canPurchaseExclusive) {
        return new Response(JSON.stringify({
          error: "You must be a confirmed user to purchase exclusives"
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: lockCreated, error: lockError } = await supabaseAdmin.rpc(
        "create_exclusive_lock",
        {
          p_product_id: resolvedBeatId,
          p_user_id: user.id,
          p_checkout_session_id: `pending_${Date.now()}`,
        }
      );

      if (lockError || !lockCreated) {
        return new Response(JSON.stringify({
          error: "This exclusive is currently being purchased by another user"
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(JSON.stringify({ error: "Stripe not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customerResponse = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: user.email || "",
          "metadata[user_id]": user.id,
        }),
      });

      const customer = await customerResponse.json();
      if (!customerResponse.ok || !customer?.id) {
        console.error("[create-checkout] Failed to create Stripe customer", {
          beatId: resolvedBeatId,
          status: customerResponse.status,
          error: customer?.error?.message ?? "unknown_customer_creation_error",
        });
        return new Response(JSON.stringify({ error: "Impossible de preparer le paiement." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      customerId = customer.id;

      await supabaseAdmin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const lineItems = new URLSearchParams();
    const checkoutAmount = productRow.price;
    const resolvedLicenseType = productRow.is_exclusive ? "exclusive" : "standard";
    const resolvedLicenseName = productRow.is_exclusive ? "Exclusive" : "Standard";

    if (!checkoutAmount || checkoutAmount <= 0) {
      console.error("[create-checkout] Invalid product price", {
        beatId: productRow.id,
        price: checkoutAmount,
      });

      return new Response(JSON.stringify({
        error: "Invalid product price",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    lineItems.append("line_items[0][price_data][currency]", "eur");
    lineItems.append("line_items[0][price_data][unit_amount]", checkoutAmount.toString());
    lineItems.append("line_items[0][price_data][product_data][name]", productRow.title);
    lineItems.append(
      "line_items[0][price_data][product_data][description]",
      productRow.is_exclusive ? "Exclusive purchase" : "Beat purchase",
    );
    if (productRow.cover_image_url) {
      lineItems.append("line_items[0][price_data][product_data][images][0]", productRow.cover_image_url);
    }
    lineItems.append("line_items[0][quantity]", "1");

    // Stripe Connect: Calculate fee split (70% to producer, 30% platform commission)
    // application_fee_amount is retained by platform; transfer_data.destination receives (checkoutAmount - applicationFeeAmount)
    const PLATFORM_COMMISSION_RATE = 0.3;
    const PRODUCER_PAYOUT_RATE = 0.7;
    const applicationFeeAmount = Math.round(checkoutAmount * PLATFORM_COMMISSION_RATE); // Platform commission = 30%, Producer receives 70%
    const producerPayoutAmount = Math.round(checkoutAmount * PRODUCER_PAYOUT_RATE); // Producer always receives 70%, whether via Connect or fallback

    const sessionParamsData: Record<string, string> = {
      mode: "payment",
      success_url: validatedSuccessUrl,
      cancel_url: validatedCancelUrl,
      "metadata[user_id]": user.id,
      "metadata[buyer_id]": user.id,
      "metadata[beat_id]": resolvedBeatId,
      "metadata[product_id]": resolvedBeatId,
      "metadata[producer_id]": productRow.producer_id,
      "metadata[product_title]": productRow.title,
      "metadata[product_slug]": productRow.slug,
      "metadata[product_type]": productRow.product_type,
      "metadata[is_exclusive]": productRow.is_exclusive.toString(),
      "metadata[license_name]": resolvedLicenseName,
      "metadata[license_type]": resolvedLicenseType,
      // Immutable checkout snapshot: used by webhook/RPC to avoid product price drift.
      "metadata[db_price_snapshot]": checkoutAmount.toString(),
      // Backward compatibility for in-flight sessions created before snapshot key rollout.
      "metadata[db_price]": checkoutAmount.toString(),
      "metadata[price_source]": "products.price",
      // Stripe Connect: Track whether this is a Connect payment or fallback (for webhook processing)
      "metadata[stripe_connect_mode]": hasStripeConnect ? "connect" : "fallback",
      "metadata[producer_payout_amount]": producerPayoutAmount.toString(),
      // Stripe Connect: destination account + application fee (only if available)
      ...(hasStripeConnect
        ? {
            "payment_intent_data[transfer_data][destination]": producerProfile.stripe_account_id!,
            "payment_intent_data[application_fee_amount]": applicationFeeAmount.toString(),
          }
        : {}),
    };

    if (customerId) {
      sessionParamsData.customer = customerId;
    } else {
      sessionParamsData.customer_creation = "always";
    }

    const sessionParams = new URLSearchParams(sessionParamsData);

    const sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${sessionParams.toString()}&${lineItems.toString()}`,
    });

    const session = await sessionResponse.json();

    if (session.error) {
      console.error("[create-checkout] Stripe checkout session creation failed", {
        beatId: resolvedBeatId,
        licenseType: resolvedLicenseType,
        price_db: checkoutAmount,
        unit_amount: checkoutAmount,
        message: session.error.message,
      });
      return new Response(JSON.stringify({ error: session.error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[create-checkout] Stripe checkout session created", {
      beatId: resolvedBeatId,
      licenseType: resolvedLicenseType,
      price_db: checkoutAmount,
      unit_amount: checkoutAmount,
      sessionId: session.id,
      ...(hasStripeConnect
        ? {
            stripeConnectTransfer: {
              destination: producerProfile.stripe_account_id,
              applicationFeeAmount,
              producerAmount: checkoutAmount - applicationFeeAmount,
            },
          }
        : {
            checkoutMode: "simple_stripe",
          }),
    });

    if (productRow.is_exclusive) {
      const { data: boundLocks, error: lockBindError } = await supabaseAdmin
        .from("exclusive_locks")
        .update({ stripe_checkout_session_id: session.id })
        .eq("product_id", resolvedBeatId)
        .eq("user_id", user.id)
        .select("id");

      if (lockBindError) {
        console.error("[create-checkout] Failed to bind lock to checkout session", {
          beatId: resolvedBeatId,
          userId: user.id,
          sessionId: session.id,
          message: lockBindError.message,
        });

        return new Response(JSON.stringify({
          error: "Exclusive lock binding failed",
          code: "exclusive_lock_bind_failed",
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!boundLocks || boundLocks.length !== 1) {
        console.error("[create-checkout] Missing lock row while binding checkout session", {
          beatId: resolvedBeatId,
          userId: user.id,
          sessionId: session.id,
          updatedRows: boundLocks?.length ?? 0,
        });

        return new Response(JSON.stringify({
          error: "Exclusive lock is no longer valid",
          code: "exclusive_lock_missing",
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Checkout error:", err);
    return new Response(JSON.stringify({ error: "Failed to create checkout session" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
