import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Cleanup user account data before deletion
 * Called via Postgres trigger on auth.users DELETE
 * Clears Stripe Connect data to prevent orphaned records
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { user_id } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "Missing user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    // Clear Stripe Connect data from user_profiles
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        stripe_account_id: null,
        stripe_account_charges_enabled: false,
        stripe_account_details_submitted: false,
        stripe_account_created_at: null,
      })
      .eq("id", user_id);

    if (updateError) {
      console.error("[cleanup-user-account] Failed to clear Stripe data:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to cleanup Stripe data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[cleanup-user-account] Cleaned up user account", { user_id });

    return new Response(
      JSON.stringify({ success: true, cleaned_user_id: user_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[cleanup-user-account] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
