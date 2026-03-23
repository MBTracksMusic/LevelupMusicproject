import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "");

const getAppUrl = (): string => {
  const appUrl = Deno.env.get("APP_URL");
  if (!appUrl) {
    throw new Error("APP_URL environment variable not set");
  }
  return appUrl;
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Extract authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.slice(7);

    // Initialize Supabase client with user token
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch user profile with account ID
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("id, stripe_account_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate account ID exists
    if (!profile.stripe_account_id) {
      return new Response(
        JSON.stringify({ error: "No Stripe account found. Create one first." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const appUrl = getAppUrl();

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: profile.stripe_account_id,
      type: "account_onboarding",
      return_url: `${appUrl}/producer/onboarding/complete`,
      refresh_url: `${appUrl}/producer/onboarding/refresh`,
    });

    console.log("[create-connect-onboarding-link] Link created", {
      userId: user.id,
      accountId: profile.stripe_account_id,
      expiresAt: new Date(accountLink.expires_at * 1000).toISOString(),
    });

    return new Response(
      JSON.stringify({
        url: accountLink.url,
        expires_at: accountLink.expires_at,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[create-connect-onboarding-link] Error", { message });
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
