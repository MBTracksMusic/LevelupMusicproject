import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-supabase-auth",
};

interface CheckoutRequest {
  productId: string;
  licenseId?: string;
  licenseType?: string;
  successUrl: string;
  cancelUrl: string;
}

interface LicenseRow {
  id: string;
  name: string;
  price: number;
  exclusive_allowed: boolean;
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getProjectRefFromSupabaseUrl = (supabaseUrl: string | null | undefined) => {
  if (!supabaseUrl) return null;
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
};

const getSupabaseHost = (supabaseUrl: string | null | undefined) => {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
};

const decodeJwtPayload = (jwt: string | undefined) => {
  if (!jwt) return null;
  const payload = jwt.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};

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
    const authorizationHeader = req.headers.get("Authorization");
    const relayAuthHeader = req.headers.get("x-supabase-auth");
    const rawJwtHeader = relayAuthHeader || authorizationHeader;
    const jwt = rawJwtHeader?.replace(/^Bearer\s+/i, "").trim();
    const runtimeSupabaseUrl = Deno.env.get("SUPABASE_URL");
    const jwtPayload = decodeJwtPayload(jwt);

    console.log("create-checkout jwt debug", {
      supabaseUrlHost: getSupabaseHost(runtimeSupabaseUrl),
      supabaseProjectRef: getProjectRefFromSupabaseUrl(runtimeSupabaseUrl),
      serviceRoleKeyDefined: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
      jwtReceivedType: typeof jwt,
      jwtSampleStart: jwt?.slice(0, 20) ?? null,
      jwtRef: typeof jwtPayload?.ref === "string" ? jwtPayload.ref : null,
      jwtRole: typeof jwtPayload?.role === "string" ? jwtPayload.role : null,
      jwtAud: typeof jwtPayload?.aud === "string" ? jwtPayload.aud : null,
      jwtExp: typeof jwtPayload?.exp === "number" ? jwtPayload.exp : null,
    });

    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
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
      console.error("JWT verification failed", authError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: CheckoutRequest = await req.json();
    const {
      productId,
      licenseId: rawLicenseId,
      licenseType: rawLicenseType,
      successUrl,
      cancelUrl,
    } = body;

    const licenseType = asNonEmptyString(rawLicenseType) || "standard";
    const licenseId = asNonEmptyString(rawLicenseId);

    if (!productId || !successUrl || !cancelUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("*, producer:user_profiles!products_producer_id_fkey(id, username, stripe_customer_id)")
      .eq("id", productId)
      .eq("is_published", true)
      .maybeSingle();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (product.is_exclusive && product.is_sold) {
      return new Response(JSON.stringify({ error: "This exclusive has already been sold" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve license server-side so Stripe metadata cannot be forged by the client.
    const selectedLicense = await resolveCheckoutLicense(
      supabaseAdmin as ReturnType<typeof createClient>,
      {
        licenseId,
        licenseType,
        isExclusiveProduct: Boolean(product.is_exclusive),
      },
    );

    if (!selectedLicense) {
      return new Response(JSON.stringify({ error: "No license configuration available" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (product.is_exclusive && !selectedLicense.exclusive_allowed) {
      return new Response(JSON.stringify({
        error: "Selected license is not valid for this exclusive product",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("role, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (product.is_exclusive) {
      const canPurchaseExclusive = profile?.role &&
        ["confirmed_user", "producer", "admin"].includes(profile.role);

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
          p_product_id: productId,
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
      customerId = customer.id;

      await supabaseAdmin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const lineItems = new URLSearchParams();
    const checkoutAmount = selectedLicense.price;

    if (!Number.isInteger(checkoutAmount) || checkoutAmount < 0) {
      return new Response(JSON.stringify({ error: "Invalid license price configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    lineItems.append("line_items[0][price_data][currency]", "eur");
    lineItems.append("line_items[0][price_data][unit_amount]", checkoutAmount.toString());
    lineItems.append("line_items[0][price_data][product_data][name]", product.title);
    if (product.description) {
      lineItems.append("line_items[0][price_data][product_data][description]", product.description);
    }
    if (product.cover_image_url) {
      lineItems.append("line_items[0][price_data][product_data][images][0]", product.cover_image_url);
    }
    lineItems.append("line_items[0][quantity]", "1");

    const sessionParams = new URLSearchParams({
      mode: "payment",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[user_id]": user.id,
      "metadata[product_id]": productId,
      "metadata[is_exclusive]": product.is_exclusive.toString(),
      "metadata[license_id]": selectedLicense.id,
      "metadata[license_name]": selectedLicense.name,
      // Keep legacy metadata key for backward compatibility in any downstream consumer.
      "metadata[license_type]": selectedLicense.name,
    });

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
      return new Response(JSON.stringify({ error: session.error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (product.is_exclusive) {
      await supabaseAdmin
        .from("exclusive_locks")
        .update({ stripe_checkout_session_id: session.id })
        .eq("product_id", productId)
        .eq("user_id", user.id);
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
