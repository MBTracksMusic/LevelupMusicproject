import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface CheckoutBody {
  price_id?: string;
  success_url?: string;
  cancel_url?: string;
}

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

    const body: CheckoutBody = await req.json();
    const priceId = body.price_id || Deno.env.get("STRIPE_PRODUCER_PRICE_ID");
    const successUrl = body.success_url || `${req.headers.get("origin")}/pricing?status=success`;
    const cancelUrl = body.cancel_url || `${req.headers.get("origin")}/pricing?status=cancel`;

    if (!priceId) {
      console.error("CONFIG_ERROR", {
        function: "producer-checkout",
        reason: "missing_price_id",
      });
      return new Response(JSON.stringify({ error: "Missing Stripe price id" }), {
        status: 400,
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

    // Fetch user profile to reuse existing customer_id if present
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .maybeSingle();

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
      "subscription_data[metadata][user_id]": user.id,
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
