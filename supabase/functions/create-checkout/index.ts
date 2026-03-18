import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const CREATE_CHECKOUT_RATE_LIMIT_RPC = "create_checkout_user";

interface CheckoutRequest {
  beatId: string;
  productId?: string;
  licenseType?: string;
  successUrl: string;
  cancelUrl: string;
}

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  cover_image_url: string | null;
  producer_id: string;
  is_exclusive: boolean;
  is_sold: boolean;
  is_published: boolean;
  deleted_at: string | null;
  product_type: string;
}

interface LicenseRow {
  id: string;
  name: string;
  price: number;
  exclusive_allowed: boolean;
}

const isProduction = () => {
  const runtimeEnv = (Deno.env.get("ENV") ?? Deno.env.get("NODE_ENV") ?? "").trim().toLowerCase();
  return runtimeEnv === "production" || runtimeEnv === "prod";
};

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

const TRUSTED_VERCEL_PREVIEW_ORIGIN_REGEX = /^https:\/\/[a-z0-9-]+-mbtracksmusics-projects\.vercel\.app$/i;

const isTrustedVercelPreviewOrigin = (origin: string) => TRUSTED_VERCEL_PREVIEW_ORIGIN_REGEX.test(origin);

const resolveAllowedRedirectOrigins = () => {
  const allowed = new Set<string>();

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("[create-checkout] Missing Supabase env vars");
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const authHeader =
      req.headers.get("authorization") ||
      req.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = userData.user;

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
      licenseType: rawLicenseType,
      successUrl,
      cancelUrl,
    } = body;

    const resolvedBeatId = asNonEmptyString(beatId) || asNonEmptyString(productId);
    const licenseType = asNonEmptyString(rawLicenseType) || "standard";

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
      .select("id, title, slug, price, cover_image_url, producer_id, is_exclusive, is_sold, is_published, deleted_at, product_type")
      .eq("id", resolvedBeatId)
      .maybeSingle();

    if (productError || !product) {
      console.warn("[create-checkout] Product lookup failed", {
        beatId: resolvedBeatId,
        licenseType,
        message: productError?.message ?? "product_not_found",
      });
      return new Response(JSON.stringify({ error: "Beat introuvable ou indisponible." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productRow = product as ProductRow;

    if (!productRow.is_published || productRow.deleted_at !== null) {
      return new Response(JSON.stringify({ error: "Beat introuvable ou indisponible." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isValidCheckoutAmount(productRow.price)) {
      console.error("[create-checkout] Invalid product price configuration", {
        beatId: productRow.id,
        licenseType,
        price_db: productRow.price,
      });
      return new Response(JSON.stringify({ error: "Prix du beat invalide." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (productRow.price < 2999) {
      return new Response(JSON.stringify({
        error: "Prix minimum 29,99€"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (productRow.is_exclusive && productRow.price < 5000) {
      return new Response(JSON.stringify({
        error: "Prix minimum 50€ pour une exclusive"
      }), {
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

    // Resolve license server-side so Stripe metadata cannot be forged by the client.
    const selectedLicense = await resolveCheckoutLicense(
      supabaseAdmin as ReturnType<typeof createClient>,
      {
        licenseId: null,
        licenseType,
        isExclusiveProduct: Boolean(productRow.is_exclusive),
      },
    );

    if (!selectedLicense) {
      return new Response(JSON.stringify({ error: "Licence introuvable pour ce beat." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (productRow.is_exclusive && !selectedLicense.exclusive_allowed) {
      return new Response(JSON.stringify({
        error: "Selected license is not valid for this exclusive product",
      }), {
        status: 400,
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
      .select("is_deleted, deleted_at")
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
          licenseType,
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
    lineItems.append("line_items[0][price_data][product_data][description]", `Licence: ${selectedLicense.name}`);
    if (productRow.cover_image_url) {
      lineItems.append("line_items[0][price_data][product_data][images][0]", productRow.cover_image_url);
    }
    lineItems.append("line_items[0][quantity]", "1");

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
      "metadata[license_id]": selectedLicense.id,
      "metadata[license_name]": selectedLicense.name,
      "metadata[license_type]": licenseType,
      // Immutable checkout snapshot: used by webhook/RPC to avoid product price drift.
      "metadata[db_price_snapshot]": checkoutAmount.toString(),
      // Backward compatibility for in-flight sessions created before snapshot key rollout.
      "metadata[db_price]": checkoutAmount.toString(),
      "metadata[price_source]": "products.price",
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
        licenseType,
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
      licenseType,
      price_db: checkoutAmount,
      unit_amount: checkoutAmount,
      sessionId: session.id,
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
