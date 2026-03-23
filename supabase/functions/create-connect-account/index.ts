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

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("id, email, stripe_account_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Safety: Don't create a second account
    if (profile.stripe_account_id) {
      return new Response(
        JSON.stringify({
          error: "Account already exists",
          account_id: profile.stripe_account_id,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create Stripe Express account
    const account = await stripe.accounts.create({
      type: "standard",
      email: profile.email || user.email || "",
      country: "FR", // Adjust based on your business
    });

    // Store account ID in database
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ stripe_account_id: account.id, updated_at: new Date() })
      .eq("id", user.id);

    if (updateError) {
      console.error("[create-connect-account] Failed to store account ID", {
        userId: user.id,
        accountId: account.id,
        error: updateError.message,
      });
      return new Response(
        JSON.stringify({ error: "Failed to store account" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[create-connect-account] Account created successfully", {
      userId: user.id,
      accountId: account.id,
    });

    return new Response(
      JSON.stringify({
        account_id: account.id,
        email: account.email,
        type: account.type,
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[create-connect-account] Error", { message });
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
