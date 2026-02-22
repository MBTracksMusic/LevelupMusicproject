import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-supabase-auth",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type StripePriceResponse = {
  id?: string;
  unit_amount?: number | null;
  currency?: string;
  active?: boolean;
  livemode?: boolean;
  recurring?: { interval?: string | null } | null;
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const configuredPriceId =
      Deno.env.get("STRIPE_PRICE_PRODUCER") ||
      Deno.env.get("STRIPE_PRODUCER_PRICE_ID");

    if (!stripeSecret) {
      console.error("ENV_ERROR", {
        function: "get-producer-price",
        reason: "missing_STRIPE_SECRET_KEY",
      });
      return jsonResponse({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }

    if (!configuredPriceId) {
      console.error("ENV_ERROR", {
        function: "get-producer-price",
        reason: "missing_STRIPE_PRICE_PRODUCER",
      });
      return jsonResponse({ error: "Missing STRIPE_PRICE_PRODUCER (or STRIPE_PRODUCER_PRICE_ID)" }, 500);
    }

    const stripePriceResp = await fetch(
      `https://api.stripe.com/v1/prices/${encodeURIComponent(configuredPriceId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const stripePrice = await stripePriceResp.json() as StripePriceResponse;

    if (!stripePriceResp.ok || stripePrice.error) {
      console.error("STRIPE_ERROR", {
        function: "get-producer-price",
        stage: "prices.retrieve",
        status: stripePriceResp.status,
        priceId: configuredPriceId,
        message: stripePrice.error?.message,
        type: stripePrice.error?.type,
        code: stripePrice.error?.code,
        param: stripePrice.error?.param,
      });
      return jsonResponse({
        error: stripePrice.error?.message || "Failed to retrieve Stripe price",
      }, 500);
    }

    if (typeof stripePrice.unit_amount !== "number" || !stripePrice.currency) {
      console.error("CONFIG_ERROR", {
        function: "get-producer-price",
        reason: "invalid_stripe_price_payload",
        priceId: configuredPriceId,
      });
      return jsonResponse({ error: "Invalid Stripe price payload" }, 500);
    }

    return jsonResponse({
      unit_amount: stripePrice.unit_amount,
      currency: stripePrice.currency,
      interval: stripePrice.recurring?.interval ?? null,
    }, 200);
  } catch (error) {
    console.error("UNEXPECTED_ERROR", {
      function: "get-producer-price",
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "Failed to retrieve producer price" }, 500);
  }
});
