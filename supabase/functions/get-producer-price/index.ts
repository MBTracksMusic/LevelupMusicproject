import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import { resolveCorsHeaders } from "../_shared/cors.ts";

function jsonResponse(payload: unknown, corsHeaders: Record<string, string>, status = 200) {
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

serveWithErrorHandling("get-producer-price", async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = resolveCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, corsHeaders, 405);
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
      return jsonResponse({ error: "Missing STRIPE_SECRET_KEY" }, corsHeaders, 500);
    }

    if (!configuredPriceId) {
      console.error("ENV_ERROR", {
        function: "get-producer-price",
        reason: "missing_STRIPE_PRICE_PRODUCER",
      });
      return jsonResponse({ error: "Missing STRIPE_PRICE_PRODUCER (or STRIPE_PRODUCER_PRICE_ID)" }, corsHeaders, 500);
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
      }, corsHeaders, 500);
    }

    if (typeof stripePrice.unit_amount !== "number" || !stripePrice.currency) {
      console.error("CONFIG_ERROR", {
        function: "get-producer-price",
        reason: "invalid_stripe_price_payload",
        priceId: configuredPriceId,
      });
      return jsonResponse({ error: "Invalid Stripe price payload" }, corsHeaders, 500);
    }

    return jsonResponse({
      unit_amount: stripePrice.unit_amount,
      currency: stripePrice.currency,
      interval: stripePrice.recurring?.interval ?? null,
    }, corsHeaders, 200);
  } catch (error) {
    console.error("UNEXPECTED_ERROR", {
      function: "get-producer-price",
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "Failed to retrieve producer price" }, corsHeaders, 500);
  }
});
