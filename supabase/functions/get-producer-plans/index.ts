import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-supabase-auth",
};

type ProducerTier = "user" | "producteur" | "elite";

const tierOrder: Record<ProducerTier, number> = {
  user: 1,
  producteur: 2,
  elite: 3,
};

const isProducerTier = (value: unknown): value is ProducerTier =>
  value === "user" || value === "producteur" || value === "elite";

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function fetchStripePrice(
  stripeSecret: string,
  priceId: string,
) {
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const payload = await response.json() as {
      unit_amount?: number | null;
      currency?: string;
      active?: boolean;
      recurring?: { interval?: string | null } | null;
      error?: { message?: string };
    };

    if (!response.ok || payload.error) {
      console.error("STRIPE_PRICE_LOOKUP_ERROR", {
        function: "get-producer-plans",
        priceId,
        status: response.status,
        message: payload.error?.message,
      });
      return null;
    }

    return {
      amount_cents: typeof payload.unit_amount === "number" ? payload.unit_amount : null,
      currency: typeof payload.currency === "string" ? payload.currency : null,
      interval: payload.recurring?.interval ?? null,
      stripe_price_active: payload.active === true,
    };
  } catch (error) {
    console.error("STRIPE_PRICE_LOOKUP_UNEXPECTED_ERROR", {
      function: "get-producer-plans",
      priceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !anonKey) {
      return new Response(JSON.stringify({ error: "Supabase env not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, anonKey);

    const { data, error } = await supabase
      .from("producer_plans")
      .select("tier, max_beats_published, max_battles_created_per_month, commission_rate, stripe_price_id, amount_cents, is_active")
      .eq("is_active", true);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plans = ((data as Array<{
      tier?: unknown;
      max_beats_published?: unknown;
      max_battles_created_per_month?: unknown;
      commission_rate?: unknown;
      stripe_price_id?: unknown;
      amount_cents?: unknown;
      is_active?: unknown;
    }> | null) || [])
      .map((row) => ({
        tier: isProducerTier(row.tier) ? row.tier : null,
        max_beats_published: typeof row.max_beats_published === "number" ? row.max_beats_published : null,
        max_battles_created_per_month: typeof row.max_battles_created_per_month === "number"
          ? row.max_battles_created_per_month
          : null,
        commission_rate: typeof row.commission_rate === "number" ? row.commission_rate : Number(row.commission_rate ?? 0),
        stripe_price_id: asNonEmptyString(row.stripe_price_id),
        amount_cents: typeof row.amount_cents === "number" && Number.isFinite(row.amount_cents)
          ? row.amount_cents
          : null,
        is_active: row.is_active === true,
      }))
      .filter((row): row is {
        tier: ProducerTier;
        max_beats_published: number | null;
        max_battles_created_per_month: number | null;
        commission_rate: number;
        stripe_price_id: string | null;
        amount_cents: number | null;
        is_active: boolean;
      } => Boolean(row.tier))
      .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

    const plansWithPricing = await Promise.all(
      plans.map(async (plan) => {
        const basePlan = {
          ...plan,
          amount_cents: plan.amount_cents,
          currency: null as string | null,
          interval: plan.tier === "user" ? null : "month",
          stripe_price_active: null as boolean | null,
        };

        if (!stripeSecret || !plan.stripe_price_id) return basePlan;

        const stripePrice = await fetchStripePrice(stripeSecret, plan.stripe_price_id);
        return {
          ...basePlan,
          amount_cents: plan.amount_cents ?? stripePrice?.amount_cents ?? null,
          currency: stripePrice?.currency ?? basePlan.currency,
          interval: stripePrice?.interval ?? basePlan.interval,
          stripe_price_active: stripePrice?.stripe_price_active ?? null,
        };
      }),
    );

    return new Response(JSON.stringify({ plans: plansWithPricing }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("UNEXPECTED_ERROR", {
      function: "get-producer-plans",
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: "Failed to load producer plans" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
