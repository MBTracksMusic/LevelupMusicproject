import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "");

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

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    // Verify token and get user claims
    const { data, error: authError } = await supabaseAdmin.auth.getClaims(token);
    if (authError || !data?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = data.claims.sub;

    // Fetch user profile with account ID
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, stripe_account_id")
      .eq("id", userId)
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
        JSON.stringify({ error: "No Stripe account found" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Retrieve account from Stripe
    const account = await stripe.accounts.retrieve(profile.stripe_account_id);

    // Update database with current status
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        stripe_account_charges_enabled: account.charges_enabled || false,
        updated_at: new Date(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[sync-connect-account] Failed to update account status", {
        userId,
        accountId: profile.stripe_account_id,
        error: updateError.message,
      });
      return new Response(
        JSON.stringify({ error: "Failed to sync account status" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[sync-connect-account] Account synced successfully", {
      userId,
      accountId: profile.stripe_account_id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });

    return new Response(
      JSON.stringify({
        account_id: account.id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        requirements: {
          current_deadline: account.requirements?.current_deadline,
          currently_due:
            account.requirements?.currently_due?.length || 0,
          past_due: account.requirements?.past_due?.length || 0,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-connect-account] Error", { message });
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
