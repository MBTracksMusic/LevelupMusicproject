import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const jsonHeaders = {
  "Content-Type": "application/json",
};

class WebhookError extends Error {
  status: number;
  markProcessed: boolean;

  constructor(message: string, status = 400, markProcessed = true) {
    super(message);
    this.name = "WebhookError";
    this.status = status;
    this.markProcessed = markProcessed;
  }
}

const extractPurchaseId = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (value && typeof value === "object" && "id" in value) {
    const candidate = (value as { id?: unknown }).id;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const DEFAULT_EVENT_PROCESSING_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

const getEventProcessingLockTimeoutMs = () => {
  const raw = asNonEmptyString(Deno.env.get("STRIPE_EVENT_PROCESSING_LOCK_TIMEOUT_MS"));
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EVENT_PROCESSING_LOCK_TIMEOUT_MS;
};

async function resolveLicenseIdForCheckout(
  supabase: ReturnType<typeof createClient>,
  params: {
    metadataLicenseId: string | null;
    metadataLicenseName: string | null;
    legacyLicenseType: string | null;
    isExclusive: boolean;
  },
): Promise<string | null> {
  const { metadataLicenseId, metadataLicenseName, legacyLicenseType, isExclusive } = params;

  if (metadataLicenseId) {
    const { data, error } = await supabase
      .from("licenses")
      .select("id")
      .eq("id", metadataLicenseId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve license id from metadata: ${error.message}`);
    }

    if (data?.id) return data.id as string;
  }

  const nameCandidates = [metadataLicenseName, legacyLicenseType]
    .map((value) => asNonEmptyString(value))
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  for (const nameCandidate of nameCandidates) {
    const { data, error } = await supabase
      .from("licenses")
      .select("id")
      .ilike("name", nameCandidate)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve license name "${nameCandidate}": ${error.message}`);
    }

    if (data?.id) return data.id as string;
  }

  if (isExclusive) {
    const { data, error } = await supabase
      .from("licenses")
      .select("id")
      .eq("exclusive_allowed", true)
      .order("price", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve fallback exclusive license: ${error.message}`);
    }

    if (data?.id) return data.id as string;
  } else {
    const { data, error } = await supabase
      .from("licenses")
      .select("id")
      .ilike("name", "standard")
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve fallback standard license: ${error.message}`);
    }

    if (data?.id) return data.id as string;
  }

  return null;
}

function isMissingCompleteLicensePurchaseFunctionError(
  error: { message?: string; details?: string; hint?: string; code?: string },
) {
  const composed = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return (
    composed.includes("complete_license_purchase") &&
    (
      composed.includes("does not exist") ||
      composed.includes("could not find the function") ||
      error.code === "42883" ||
      error.code === "PGRST202"
    )
  );
}

async function completePurchaseWithLegacyRpc(
  supabase: ReturnType<typeof createClient>,
  params: {
    isExclusive: boolean;
    sessionId: string;
    productId: string;
    userId: string;
    paymentIntentId: string;
    amountTotal: number;
    licenseType: string;
  },
) {
  const {
    isExclusive,
    sessionId,
    productId,
    userId,
    paymentIntentId,
    amountTotal,
    licenseType,
  } = params;

  if (isExclusive) {
    const { data, error } = await supabase.rpc("complete_exclusive_purchase", {
      p_product_id: productId,
      p_user_id: userId,
      p_checkout_session_id: sessionId,
      p_payment_intent_id: paymentIntentId,
      p_amount: amountTotal,
    });

    if (error) {
      throw new Error(`complete_exclusive_purchase failed: ${error.message}`);
    }

    const purchaseId = extractPurchaseId(data);
    if (!purchaseId) {
      throw new Error(`Missing purchase id after complete_exclusive_purchase (session ${sessionId})`);
    }

    console.log("[stripe-webhook] Exclusive purchase completed via legacy RPC", { sessionId, purchaseId });
    return purchaseId;
  }

  const { data, error } = await supabase.rpc("complete_standard_purchase", {
    p_product_id: productId,
    p_user_id: userId,
    p_checkout_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
    p_amount: amountTotal,
    p_license_type: licenseType,
  });

  if (error) {
    throw new Error(`complete_standard_purchase failed: ${error.message}`);
  }

  const purchaseId = extractPurchaseId(data);
  if (!purchaseId) {
    throw new Error(`Missing purchase id after complete_standard_purchase (session ${sessionId})`);
  }

  console.log("[stripe-webhook] Standard purchase completed via legacy RPC", { sessionId, purchaseId });
  return purchaseId;
}

const isCheckoutSession = (
  object: Stripe.Event.Data.Object,
): object is Stripe.Checkout.Session => object.object === "checkout.session";

const isSubscription = (
  object: Stripe.Event.Data.Object,
): object is Stripe.Subscription => object.object === "subscription";

const isInvoice = (
  object: Stripe.Event.Data.Object,
): object is Stripe.Invoice => object.object === "invoice";

async function notifyContractService(purchaseId: string) {
  const contractServiceUrl = Deno.env.get("CONTRACT_SERVICE_URL");
  const contractServiceSecret = Deno.env.get("CONTRACT_SERVICE_SECRET");
  const requestTimeoutMs = 8000;

  if (!contractServiceUrl || !contractServiceSecret) {
    console.warn("[contract-service] Missing CONTRACT_SERVICE_URL or CONTRACT_SERVICE_SECRET");
    return;
  }

  const endpoint = contractServiceUrl.endsWith("/generate-contract")
    ? contractServiceUrl
    : `${contractServiceUrl.replace(/\/$/, "")}/generate-contract`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${contractServiceSecret}`,
        },
        body: JSON.stringify({ purchase_id: purchaseId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      console.error("[contract-service] Request failed", {
        purchaseId,
        endpoint,
        status: response.status,
        body,
      });
      return;
    }

    console.log("[contract-service] Triggered", { purchaseId });
  } catch (error) {
    console.error("[contract-service] Unexpected error", {
      purchaseId,
      timeoutMs: requestTimeoutMs,
      error,
    });
  }
}

async function markStripeEvent(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  updates: { processed: boolean; error: string | null },
) {
  const payload: Record<string, unknown> = {
    processed: updates.processed,
    processed_at: updates.processed ? new Date().toISOString() : null,
    processing_started_at: null,
    error: updates.error,
  };

  const { error } = await supabase
    .from("stripe_events")
    .update(payload)
    .eq("id", eventId);

  if (error) {
    console.error("[stripe-webhook] Failed to update stripe_events row", {
      eventId,
      updateError: error,
      payload,
    });
  }
}

function isMissingProcessingStartedColumnError(error: { message?: string; details?: string; hint?: string; code?: string }) {
  const composed = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return (
    composed.includes("processing_started_at") &&
    (
      composed.includes("does not exist") ||
      composed.includes("schema cache") ||
      error.code === "42703" ||
      error.code === "PGRST204"
    )
  );
}

async function hasProcessingStartedAtColumn(supabase: ReturnType<typeof createClient>) {
  const probe = await supabase
    .from("stripe_events")
    .select("id, processing_started_at")
    .limit(1);

  if (!probe.error) {
    return true;
  }

  if (isMissingProcessingStartedColumnError(probe.error)) {
    console.error(
      "[stripe-webhook] Missing column public.stripe_events.processing_started_at. Run migrations before enabling webhook.",
      { code: probe.error.code, message: probe.error.message, details: probe.error.details },
    );
    return false;
  }

  throw new Error(`Failed to verify stripe_events schema: ${probe.error.message}`);
}

async function claimStripeEventProcessingLock(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  lockTimeoutMs: number,
) {
  // CLAIM LOCK (atomic):
  // 1) normal path: processing_started_at is NULL
  // 2) recovery path: stale lock older than lockTimeoutMs
  const nowIso = new Date().toISOString();
  const { data: freshClaim, error: freshClaimError } = await supabase
    .from("stripe_events")
    .update({ processing_started_at: nowIso })
    .eq("id", eventId)
    .eq("processed", false)
    .is("processing_started_at", null)
    .select("id")
    .maybeSingle();

  if (freshClaimError) {
    if (isMissingProcessingStartedColumnError(freshClaimError)) {
      throw new Error(
        "Missing column public.stripe_events.processing_started_at. Run migrations before enabling webhook.",
      );
    }
    throw new Error(`Failed to claim processing lock: ${freshClaimError.message}`);
  }

  if (freshClaim) {
    return freshClaim;
  }

  const staleBeforeIso = new Date(Date.now() - lockTimeoutMs).toISOString();
  const { data: staleClaim, error: staleClaimError } = await supabase
    .from("stripe_events")
    .update({ processing_started_at: nowIso })
    .eq("id", eventId)
    .eq("processed", false)
    .lt("processing_started_at", staleBeforeIso)
    .select("id")
    .maybeSingle();

  if (staleClaimError) {
    if (isMissingProcessingStartedColumnError(staleClaimError)) {
      throw new Error(
        "Missing column public.stripe_events.processing_started_at. Run migrations before enabling webhook.",
      );
    }
    throw new Error(`Failed to recover stale processing lock: ${staleClaimError.message}`);
  }

  return staleClaim;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !stripeWebhookSecret) {
    console.error("[stripe-webhook] Missing required environment variables");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const stripeSignature = req.headers.get("Stripe-Signature");
  if (!stripeSignature) {
    return new Response(JSON.stringify({ error: "Missing Stripe-Signature header" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const stripe = new Stripe(stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      stripeSignature,
      stripeWebhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    console.error("[stripe-webhook] Signature verification failed", { message });
    return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  try {
    const processingColumnExists = await hasProcessingStartedAtColumn(supabase);
    if (!processingColumnExists) {
      return new Response(
        JSON.stringify({
          error: "Server schema not up to date: missing stripe_events.processing_started_at",
        }),
        {
          status: 500,
          headers: jsonHeaders,
        },
      );
    }

    const { data: existingEvent, error: existingEventError } = await supabase
      .from("stripe_events")
      .select("id, processed")
      .eq("id", event.id)
      .maybeSingle();

    if (existingEventError) {
      throw new Error(`Failed to query stripe_events: ${existingEventError.message}`);
    }

    if (existingEvent?.processed) {
      console.log("[stripe-webhook] Event already processed", { eventId: event.id, eventType: event.type });
      return new Response(JSON.stringify({ received: true, status: "already_processed" }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    const { error: upsertError } = await supabase
      .from("stripe_events")
      .upsert({
        id: event.id,
        type: event.type,
        data: event.data,
      });

    if (upsertError) {
      throw new Error(`Failed to upsert stripe_events: ${upsertError.message}`);
    }

    const lockTimeoutMs = getEventProcessingLockTimeoutMs();

    // CLAIM LOCK (atomic idempotency gate)
    const claimed = await claimStripeEventProcessingLock(supabase, event.id, lockTimeoutMs);
    if (!claimed) {
      console.log("[stripe-webhook] Event already being processed", {
        eventId: event.id,
        eventType: event.type,
        lockTimeoutMs,
      });
      return new Response(JSON.stringify({ received: true, status: "already_processing" }), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          if (!isCheckoutSession(event.data.object)) {
            throw new WebhookError("Invalid payload for checkout.session.completed", 400, true);
          }
          await handleCheckoutCompleted(supabase, stripe, event.data.object);
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          if (!isSubscription(event.data.object)) {
            throw new WebhookError(`Invalid payload for ${event.type}`, 400, true);
          }
          await handleSubscriptionUpdate(supabase, event.data.object);
          break;
        }
        case "customer.subscription.deleted": {
          if (!isSubscription(event.data.object)) {
            throw new WebhookError("Invalid payload for customer.subscription.deleted", 400, true);
          }
          await handleSubscriptionDeleted(supabase, event.data.object);
          break;
        }
        case "invoice.payment_succeeded": {
          if (!isInvoice(event.data.object)) {
            throw new WebhookError("Invalid payload for invoice.payment_succeeded", 400, true);
          }
          await handlePaymentSucceeded(supabase, event.data.object);
          break;
        }
        case "invoice.payment_failed": {
          if (!isInvoice(event.data.object)) {
            throw new WebhookError("Invalid payload for invoice.payment_failed", 400, true);
          }
          await handlePaymentFailed(supabase, event.data.object);
          break;
        }
        default:
          console.log("[stripe-webhook] Unhandled event type", { eventId: event.id, eventType: event.type });
      }

      await markStripeEvent(supabase, event.id, { processed: true, error: null });

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: jsonHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing error";

      if (error instanceof WebhookError) {
        await markStripeEvent(supabase, event.id, {
          processed: error.markProcessed,
          error: message,
        });

        console.error("[stripe-webhook] Non-retryable event validation error", {
          eventId: event.id,
          eventType: event.type,
          status: error.status,
          message,
        });

        return new Response(JSON.stringify({ error: message }), {
          status: error.status,
          headers: jsonHeaders,
        });
      }

      await markStripeEvent(supabase, event.id, {
        processed: false,
        error: message,
      });

      console.error("[stripe-webhook] Processing failed", {
        eventId: event.id,
        eventType: event.type,
        message,
      });

      return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled webhook error";
    await markStripeEvent(supabase, event.id, {
      processed: false,
      error: message,
    });
    console.error("[stripe-webhook] Fatal webhook error", { message });

    return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  eventSession: Stripe.Checkout.Session,
) {
  const sessionId = asNonEmptyString(eventSession.id);
  if (!sessionId) {
    throw new WebhookError("Missing checkout session id", 400, true);
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid") {
    throw new WebhookError(`Checkout session ${sessionId} is not paid`, 400, true);
  }

  const mode = session.mode;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;
  const metadata = session.metadata ?? {};

  if (mode === "subscription") {
    if (!subscriptionId) {
      throw new WebhookError("Subscription checkout completed without subscription id", 400, true);
    }
    await upsertProducerSubscriptionFromStripe(supabase, stripe, subscriptionId);
    return;
  }

  const userId = asNonEmptyString(metadata.user_id);
  const productId = asNonEmptyString(metadata.product_id);
  const isExclusive = metadata.is_exclusive === "true";
  const metadataLicenseId = asNonEmptyString(metadata.license_id);
  const metadataLicenseName = asNonEmptyString(metadata.license_name);
  const licenseType = asNonEmptyString(metadata.license_type) || metadataLicenseName || "standard";

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const amountTotal = session.amount_total;

  if (!userId || !productId || !paymentIntentId || amountTotal === null) {
    throw new WebhookError("Missing secure checkout metadata for purchase completion", 400, true);
  }

  // Primary licensing flow:
  // Resolve a trusted license id and use the unified complete_license_purchase RPC.
  const resolvedLicenseId = await resolveLicenseIdForCheckout(supabase, {
    metadataLicenseId,
    metadataLicenseName,
    legacyLicenseType: licenseType,
    isExclusive,
  });

  let purchaseId: string | null = null;

  if (resolvedLicenseId) {
    const { data, error } = await supabase.rpc("complete_license_purchase", {
      p_product_id: productId,
      p_user_id: userId,
      p_checkout_session_id: sessionId,
      p_payment_intent_id: paymentIntentId,
      p_license_id: resolvedLicenseId,
      p_amount: amountTotal,
    });

    if (error) {
      if (isMissingCompleteLicensePurchaseFunctionError(error)) {
        console.warn("[stripe-webhook] complete_license_purchase missing, using legacy fallback", {
          sessionId,
          productId,
          userId,
        });
      } else {
        throw new Error(`complete_license_purchase failed: ${error.message}`);
      }
    } else {
      purchaseId = extractPurchaseId(data);
      console.log("[stripe-webhook] License purchase completed", {
        sessionId,
        purchaseId,
        licenseId: resolvedLicenseId,
      });
    }
  }

  if (!purchaseId) {
    purchaseId = await completePurchaseWithLegacyRpc(supabase, {
      isExclusive,
      sessionId,
      productId,
      userId,
      paymentIntentId,
      amountTotal,
      licenseType,
    });
  }

  if (!purchaseId) {
    throw new Error(`Missing purchase id after checkout completion (session ${sessionId})`);
  }

  await notifyContractService(purchaseId);
}

async function handleSubscriptionUpdate(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
) {
  const customerId = asNonEmptyString(
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id,
  );
  const subscriptionId = asNonEmptyString(subscription.id);

  if (!customerId || !subscriptionId) {
    throw new WebhookError("Invalid subscription update payload", 400, true);
  }

  await upsertProducerSubscription(supabase, {
    customerId,
    subscriptionId,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    userId: asNonEmptyString(subscription.metadata?.user_id),
  });
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription,
) {
  const customerId = asNonEmptyString(
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id,
  );
  const subscriptionId = asNonEmptyString(subscription.id);

  if (!customerId || !subscriptionId) {
    throw new WebhookError("Invalid subscription deleted payload", 400, true);
  }

  await upsertProducerSubscription(supabase, {
    customerId,
    subscriptionId,
    status: "canceled",
    currentPeriodEnd: 0,
    cancelAtPeriodEnd: true,
    userId: asNonEmptyString(subscription.metadata?.user_id),
  });
}

async function handlePaymentSucceeded(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
) {
  const customerId = asNonEmptyString(
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id,
  );
  const subscriptionId = asNonEmptyString(
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id,
  );

  if (!customerId || !subscriptionId) {
    console.warn("[handlePaymentSucceeded] Missing customer or subscription id", {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });
    return;
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (profile) {
    await supabase.rpc("log_audit_event", {
      p_user_id: profile.id,
      p_action: "subscription_payment_succeeded",
      p_resource_type: "subscription",
      p_metadata: { invoice_id: invoice.id, subscription_id: subscriptionId },
    });
  } else {
    console.warn("[handlePaymentSucceeded] No profile found for customer", { customerId });
  }
}

async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
) {
  const customerId = asNonEmptyString(
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id,
  );
  const subscriptionId = asNonEmptyString(
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id,
  );

  if (!customerId || !subscriptionId) return;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (profile) {
    await supabase.rpc("log_audit_event", {
      p_user_id: profile.id,
      p_action: "subscription_payment_failed",
      p_resource_type: "subscription",
      p_metadata: { invoice_id: invoice.id, subscription_id: subscriptionId },
    });
  }
}

async function upsertProducerSubscriptionFromStripe(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  subscriptionId: string,
) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const customerId = asNonEmptyString(
    typeof sub.customer === "string"
      ? sub.customer
      : sub.customer?.id,
  );

  if (!customerId) {
    throw new Error(`Subscription ${subscriptionId} is missing customer id`);
  }

  await upsertProducerSubscription(supabase, {
    customerId,
    subscriptionId,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    userId: asNonEmptyString(sub.metadata?.user_id),
  });
}

async function upsertProducerSubscription(
  supabase: ReturnType<typeof createClient>,
  params: {
    customerId: string;
    subscriptionId: string;
    status: string;
    currentPeriodEnd?: number | string;
    cancelAtPeriodEnd?: boolean;
    userId?: string;
  },
) {
  const { customerId, subscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd, userId } = params;

  let { data: profile } = await supabase
    .from("user_profiles")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!profile && userId) {
    const { data: profileById } = await supabase
      .from("user_profiles")
      .select("id, stripe_customer_id, stripe_subscription_id")
      .eq("id", userId)
      .maybeSingle();

    if (profileById) {
      profile = profileById;

      if (!profileById.stripe_customer_id) {
        const { error: linkErr } = await supabase
          .from("user_profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", profileById.id);

        if (linkErr) {
          console.error("[upsertProducerSubscription] Failed to link stripe_customer_id", linkErr);
        }
      }
    }
  }

  if (!profile) {
    const { data: existingSub } = await supabase
      .from("producer_subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (existingSub) {
      profile = { id: existingSub.user_id } as { id: string; stripe_customer_id?: string | null };
    }
  }

  if (!profile) {
    const { data: profileBySubscription } = await supabase
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (profileBySubscription) {
      profile = profileBySubscription;
    }
  }

  if (!profile) {
    throw new Error(`No user found for customer ${customerId} / subscription ${subscriptionId}`);
  }

  const periodEndTs = typeof currentPeriodEnd === "string"
    ? Number.parseInt(currentPeriodEnd, 10)
    : currentPeriodEnd;

  const periodEndMs = Number.isFinite(periodEndTs) ? (periodEndTs as number) * 1000 : undefined;

  let currentEndIso: string | null = periodEndMs ? new Date(periodEndMs).toISOString() : null;
  if (!currentEndIso) {
    const { data: existingPeriod } = await supabase
      .from("producer_subscriptions")
      .select("current_period_end")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    currentEndIso = existingPeriod?.current_period_end || new Date().toISOString();
  }

  const isActive = ["active", "trialing"].includes(status) && Date.parse(currentEndIso) > Date.now();

  const profileUpdates: Record<string, unknown> = { stripe_subscription_id: subscriptionId };
  if (!profile.stripe_customer_id) {
    profileUpdates.stripe_customer_id = customerId;
  }

  const { error: profileUpdateErr } = await supabase
    .from("user_profiles")
    .update(profileUpdates)
    .eq("id", profile.id);

  if (profileUpdateErr) {
    console.error("[upsertProducerSubscription] Failed to sync user profile identifiers", profileUpdateErr);
  }

  const { error } = await supabase
    .from("producer_subscriptions")
    .upsert({
      user_id: profile.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
      current_period_end: currentEndIso,
      cancel_at_period_end: cancelAtPeriodEnd ?? false,
      is_producer_active: isActive,
    }, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to upsert producer_subscriptions: ${error.message}`);
  }
}
