import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StripeConnectRequest {
  action: "create_account_link" | "get_status";
}

interface StripeConnectResponse {
  url?: string;
  stripe_account_id?: string;
  charges_enabled?: boolean;
  details_submitted?: boolean;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    // Get user from auth header
    const token = authHeader.replace("Bearer ", "");
    const { data, error: authError } = await supabaseAdmin.auth.getClaims(token);

    if (authError || !data?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = data.claims.sub;
    const body: StripeConnectRequest = await req.json();
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!stripeSecretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY environment variable");
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("stripe_account_id, is_producer_active")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile.is_producer_active) {
      return new Response(
        JSON.stringify({ error: "User is not a producer" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle different actions
    if (body.action === "create_account_link") {
      return await handleCreateAccountLink(
        userId,
        profile,
        supabaseAdmin,
        stripeSecretKey,
        corsHeaders
      );
    } else if (body.action === "get_status") {
      return await handleGetStatus(profile, corsHeaders);
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[stripe-connect-onboarding] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleCreateAccountLink(
  userId: string,
  profile: any,
  supabaseAdmin: any,
  stripeSecretKey: string,
  corsHeaders: any
): Promise<Response> {
  let stripeAccountId = profile.stripe_account_id;

  // If no account exists, create one
  if (!stripeAccountId) {
    const accountResponse = await fetch("https://api.stripe.com/v1/accounts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "type=express&capabilities[card_payments][requested]=true&capabilities[transfers][requested]=true",
    });

    const account = await accountResponse.json();

    if (account.error) {
      return new Response(
        JSON.stringify({ error: account.error.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    stripeAccountId = account.id;

    // Save account ID to database
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        stripe_account_id: stripeAccountId,
        stripe_account_created_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[stripe-connect-onboarding] Failed to save account ID:", updateError);

      // Check for unique constraint violation (error code 23505)
      if (updateError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "Stripe account already linked to another user" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to save account ID" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Create account link
  const linkResponse = await fetch(
    `https://api.stripe.com/v1/account_links`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        account: stripeAccountId,
        type: "account_onboarding",
        refresh_url: `${getBaseUrl()}/producer/stripe-connect?status=refresh`,
        return_url: `${getBaseUrl()}/producer/stripe-connect?status=success`,
      }).toString(),
    }
  );

  const link = await linkResponse.json();

  if (link.error) {
    return new Response(
      JSON.stringify({ error: link.error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("[stripe-connect-onboarding] Account link created", {
    userId,
    stripeAccountId,
  });

  return new Response(
    JSON.stringify({ url: link.url }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleGetStatus(
  profile: any,
  corsHeaders: any
): Promise<Response> {
  const response: StripeConnectResponse = {
    stripe_account_id: profile.stripe_account_id,
    charges_enabled: profile.stripe_account_charges_enabled || false,
    details_submitted: profile.stripe_account_details_submitted || false,
  };

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function getBaseUrl(): string {
  const env = Deno.env.get("ENVIRONMENT") || "development";
  if (env === "production") {
    return "https://beatelion.com";
  } else if (env === "staging") {
    return "https://staging.beatelion.com";
  } else {
    return "http://localhost:3000";
  }
}
