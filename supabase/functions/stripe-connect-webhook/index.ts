import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Verify Stripe webhook signature using HMAC-SHA256
 * Stripe header format: t=timestamp,v1=signature
 */
async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    // Parse signature header: "t=timestamp,v1=signature"
    const parts = signature.split(",");
    let timestamp: string | null = null;
    let providedSignature: string | null = null;

    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === "t") timestamp = value;
      if (key === "v1") providedSignature = value;
    }

    if (!timestamp || !providedSignature) {
      console.warn("[stripe-connect-webhook] Invalid signature format");
      return false;
    }

    // Check timestamp is not too old (5 minutes tolerance)
    const currentTime = Math.floor(Date.now() / 1000);
    const signedTime = parseInt(timestamp, 10);
    if (Math.abs(currentTime - signedTime) > 300) {
      console.warn("[stripe-connect-webhook] Signature timestamp too old", {
        age: Math.abs(currentTime - signedTime),
      });
      return false;
    }

    // Create signed content: timestamp.body
    const signedContent = `${timestamp}.${body}`;

    // Compute HMAC-SHA256
    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const computed = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      encoder.encode(signedContent),
    );

    // Convert computed signature to hex string
    const computedHex = Array.from(new Uint8Array(computed))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Timing-safe comparison using XOR accumulation (no short-circuit)
    const computedBuf = new TextEncoder().encode(computedHex);
    const providedBuf = new TextEncoder().encode(providedSignature);

    // Check length first (explicit, safe)
    if (computedBuf.length !== providedBuf.length) {
      console.error("[stripe-connect-webhook] Signature verification failed");
      return false;
    }

    // Compare all bytes with XOR accumulation (constant-time)
    let mismatch = 0;
    for (let i = 0; i < computedBuf.length; i++) {
      mismatch |= computedBuf[i] ^ providedBuf[i];
    }

    const match = mismatch === 0;
    if (!match) {
      console.error("[stripe-connect-webhook] Signature verification failed");
    }
    return match;
  } catch (error) {
    console.error("[stripe-connect-webhook] Signature verification error:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.text();
    const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT");

    if (!stripeWebhookSecret) {
      console.error("[stripe-connect-webhook] Missing webhook secret");
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify Stripe signature
    const isValid = await verifyStripeSignature(body, signature, stripeWebhookSecret);
    if (!isValid) {
      console.error("[stripe-connect-webhook] Invalid webhook signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse event after signature verification
    const event = JSON.parse(body);

    console.log("[stripe-connect-webhook] Received event:", {
      type: event.type,
      account: event.account,
    });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    // Handle account.updated events
    if (event.type === "account.updated") {
      const stripeAccountId = event.data.object.id;
      const chargesEnabled = event.data.object.charges_enabled || false;
      const detailsSubmitted = event.data.object.details_submitted || false;

      // Find user with this Stripe account ID and update status
      const { data: profile, error: findError } = await supabaseAdmin
        .from("user_profiles")
        .select("id")
        .eq("stripe_account_id", stripeAccountId)
        .single();

      if (findError) {
        console.warn("[stripe-connect-webhook] Profile not found for account:", stripeAccountId);
        return new Response(
          JSON.stringify({ received: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update charges enabled status
      const { error: updateError } = await supabaseAdmin
        .from("user_profiles")
        .update({
          stripe_account_charges_enabled: chargesEnabled,
          stripe_account_details_submitted: detailsSubmitted,
        })
        .eq("id", profile.id);

      if (updateError) {
        console.error("[stripe-connect-webhook] Failed to update profile:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update profile" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[stripe-connect-webhook] Updated profile charges status", {
        userId: profile.id,
        chargesEnabled,
        detailsSubmitted,
      });
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[stripe-connect-webhook] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
