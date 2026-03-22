import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { invokeContractGeneration, resolveContractGenerateEndpoint } from "../_shared/contract-generation.js";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import { captureException, type RequestContext } from "../_shared/sentry.ts";

const jsonHeaders = {
  "Content-Type": "application/json",
};
const GA4_COLLECT_ENDPOINT = "https://www.google-analytics.com/mp/collect";

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

type ProducerTier = "user" | "producteur" | "elite";
type SubscriptionKind = "producer" | "user";
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const asProducerTier = (value: unknown): ProducerTier | null => {
  if (value === "user" || value === "producteur" || value === "elite") return value;
  if (value === "starter") return "user";
  if (value === "pro") return "producteur";
  return null;
};

const centsToCurrencyAmount = (amountInMinorUnits: number | null | undefined) => {
  if (typeof amountInMinorUnits !== "number" || !Number.isFinite(amountInMinorUnits)) {
    return null;
  }

  return Number((amountInMinorUnits / 100).toFixed(2));
};

type Ga4PurchaseItem = {
  item_id: string;
  item_name: string;
  price: number;
};

type Ga4PurchasePayload = {
  transactionId: string;
  stripeEventId: string;
  value: number;
  currency: string;
  userId: string | null;
  gaClientId: string | null;
  item: Ga4PurchaseItem;
};

async function claimGa4PurchaseTracking(
  supabase: ReturnType<typeof createClient>,
  transactionId: string,
  stripeEventId: string,
  eventName: string,
) {
  const { error } = await supabase
    .from("ga4_tracked_purchases")
    .insert({
      transaction_id: transactionId,
      stripe_event_id: stripeEventId,
      event_name: eventName,
      status: "pending",
    });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    const { data: existingRow, error: existingRowError } = await supabase
      .from("ga4_tracked_purchases")
      .select("status")
      .eq("transaction_id", transactionId)
      .maybeSingle();

    if (existingRowError) {
      throw new Error(`Failed to inspect existing GA4 purchase tracking row: ${existingRowError.message}`);
    }

    return false;
  }

  throw new Error(`Failed to claim GA4 purchase tracking: ${error.message}`);
}

async function markGa4PurchaseTrackingSent(
  supabase: ReturnType<typeof createClient>,
  transactionId: string,
) {
  const { error } = await supabase
    .from("ga4_tracked_purchases")
    .update({ status: "sent" })
    .eq("transaction_id", transactionId);

  if (error) {
    throw new Error(`Failed to mark GA4 tracking as sent: ${error.message}`);
  }
}

async function sendPurchaseToGA4(payload: Ga4PurchasePayload) {
  const measurementId = asNonEmptyString(Deno.env.get("GA4_MEASUREMENT_ID"));
  const apiSecret = asNonEmptyString(Deno.env.get("GA4_API_SECRET"));

  if (!measurementId || !apiSecret) {
    return false;
  }

  const clientId = payload.gaClientId ?? crypto.randomUUID();
  const response = await fetch(
    `${GA4_COLLECT_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        user_id: payload.userId ?? undefined,
        timestamp_micros: Date.now() * 1000,
        events: [
          {
            name: "purchase",
            event_id: payload.transactionId,
            params: {
              value: payload.value,
              currency: payload.currency,
              transaction_id: payload.transactionId,
              engagement_time_msec: 1,
              items: [
                {
                  item_id: payload.item.item_id,
                  item_name: payload.item.item_name,
                  price: payload.item.price,
                },
              ],
            },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`GA4 Measurement Protocol request failed with status ${response.status}`);
  }

  return true;
}

async function trackPurchaseViaGa4(
  supabase: ReturnType<typeof createClient>,
  payload: Ga4PurchasePayload,
) {
  const measurementId = asNonEmptyString(Deno.env.get("GA4_MEASUREMENT_ID"));
  const apiSecret = asNonEmptyString(Deno.env.get("GA4_API_SECRET"));

  if (!measurementId || !apiSecret) {
    return;
  }

  const claimed = await claimGa4PurchaseTracking(
    supabase,
    payload.transactionId,
    payload.stripeEventId,
    "purchase",
  );

  if (!claimed) {
    return;
  }

  try {
    const sent = await sendPurchaseToGA4(payload);
    if (sent) {
      await markGa4PurchaseTrackingSent(supabase, payload.transactionId);
    }
  } catch (error) {
    throw error;
  }
}

const asSubscriptionKind = (value: unknown): SubscriptionKind | null => {
  if (value === "producer") return "producer";
  if (value === "user") return "user";
  return null;
};

const extractSubscriptionPriceIds = (subscription: Stripe.Subscription | null | undefined) => {
  const ids = (subscription?.items?.data || [])
    .map((item) => {
      const price = item?.price;
      if (typeof price === "string") return asNonEmptyString(price);
      return asNonEmptyString(price?.id);
    })
    .filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
};

const extractInvoicePriceIds = (invoice: Stripe.Invoice | null | undefined) => {
  const ids = (invoice?.lines?.data || [])
    .map((line) => {
      const price = line?.pricing?.price_details?.price;
      if (typeof price === "string") return asNonEmptyString(price);
      if (price && typeof price === "object" && "id" in price) {
        return asNonEmptyString((price as { id?: unknown }).id);
      }

      const plan = (line as Record<string, unknown> | null)?.plan;
      if (plan && typeof plan === "object" && "id" in plan) {
        return asNonEmptyString((plan as { id?: unknown }).id);
      }

      return null;
    })
    .filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
};

const resolveInvoiceSubscriptionMetadata = (invoice: Stripe.Invoice | null | undefined): Record<string, unknown> | null => {
  if (!invoice) return null;

  if (invoice.subscription_details && typeof invoice.subscription_details === "object") {
    const record = invoice.subscription_details as Record<string, unknown>;
    const metadata = record.metadata;
    if (metadata && typeof metadata === "object") {
      return metadata as Record<string, unknown>;
    }
  }

  const parent = (invoice as Record<string, unknown>).parent;
  if (parent && typeof parent === "object") {
    const subscriptionDetails = (parent as Record<string, unknown>).subscription_details;
    if (subscriptionDetails && typeof subscriptionDetails === "object") {
      const metadata = (subscriptionDetails as Record<string, unknown>).metadata;
      if (metadata && typeof metadata === "object") {
        return metadata as Record<string, unknown>;
      }
    }
  }

  return null;
};

const resolveSubscriptionCurrentPeriodEnd = (
  subscription: Stripe.Subscription | null | undefined,
): number | null => {
  const topLevelPeriodEnd = subscription?.current_period_end;
  if (typeof topLevelPeriodEnd === "number" && Number.isFinite(topLevelPeriodEnd) && topLevelPeriodEnd > 0) {
    return topLevelPeriodEnd;
  }

  const itemPeriodEnds = (subscription?.items?.data || [])
    .map((item) => {
      const itemRecord = item as Record<string, unknown>;
      const itemPeriodEnd = itemRecord.current_period_end;
      if (typeof itemPeriodEnd === "number" && Number.isFinite(itemPeriodEnd) && itemPeriodEnd > 0) {
        return itemPeriodEnd;
      }
      return null;
    })
    .filter((value): value is number => typeof value === "number");

  if (itemPeriodEnds.length === 0) return null;
  return Math.max(...itemPeriodEnds);
};

const normalizeStripeTimestampToIso = (value: number | string | null | undefined): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestampMs = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(timestampMs).toISOString();
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;

    if (/^-?\d+$/.test(trimmedValue)) {
      const parsed = Number.parseInt(trimmedValue, 10);
      if (Number.isFinite(parsed)) {
        const timestampMs = Math.abs(parsed) < 1_000_000_000_000 ? parsed * 1000 : parsed;
        return new Date(timestampMs).toISOString();
      }
      return null;
    }

    const parsedMs = Date.parse(trimmedValue);
    if (Number.isFinite(parsedMs)) {
      return new Date(parsedMs).toISOString();
    }
  }

  return null;
};

const toIsoFromUnixSeconds = (value: number | null | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
};

const resolveInvoiceBillingPeriod = (invoice: Stripe.Invoice) => {
  const linePeriods = (invoice.lines?.data || [])
    .map((line) => line.period)
    .filter((period): period is { start: number; end: number } =>
      Boolean(period)
      && typeof period.start === "number"
      && Number.isFinite(period.start)
      && period.start > 0
      && typeof period.end === "number"
      && Number.isFinite(period.end)
      && period.end > period.start
    );

  if (linePeriods.length === 0) {
    return {
      periodStart: null,
      periodEnd: null,
    };
  }

  const start = Math.min(...linePeriods.map((period) => period.start));
  const end = Math.max(...linePeriods.map((period) => period.end));

  return {
    periodStart: toIsoFromUnixSeconds(start),
    periodEnd: toIsoFromUnixSeconds(end),
  };
};

const getConfiguredUserSubscriptionPriceIds = () => {
  const ids = new Set<string>();

  for (const raw of [
    asNonEmptyString(Deno.env.get("STRIPE_USER_SUBSCRIPTION_PRICE_ID")),
    asNonEmptyString(Deno.env.get("STRIPE_USER_MONTHLY_PRICE_ID")),
  ]) {
    if (raw) ids.add(raw);
  }

  for (const csv of [
    asNonEmptyString(Deno.env.get("STRIPE_USER_SUBSCRIPTION_PRICE_IDS")),
    asNonEmptyString(Deno.env.get("STRIPE_USER_MONTHLY_PRICE_IDS")),
  ]) {
    if (!csv) continue;
    for (const token of csv.split(",")) {
      const value = asNonEmptyString(token);
      if (value) ids.add(value);
    }
  }

  return ids;
};

const USER_SUBSCRIPTION_PRICE_IDS = getConfiguredUserSubscriptionPriceIds();

const producerTierRank = (tier: ProducerTier) => {
  if (tier === "elite") return 3;
  if (tier === "producteur") return 2;
  return 1;
};

const resolveProducerTierFromDbPlans = async (
  supabase: ReturnType<typeof createClient>,
  priceIds: string[],
) => {
  if (priceIds.length === 0) return null;

  const { data, error } = await supabase
    .from("producer_plans")
    .select("tier, stripe_price_id")
    .in("stripe_price_id", priceIds)
    .eq("is_active", true);

  if (error) {
    console.error("TIER_SYNC_PLAN_LOOKUP_ERROR", {
      priceIds,
      message: error.message,
    });
    return null;
  }

  const candidates = ((data as Array<{ tier?: unknown; stripe_price_id?: unknown }> | null) || [])
    .map((row) => ({
      tier: asProducerTier(row.tier),
      priceId: asNonEmptyString(row.stripe_price_id),
    }))
    .filter((row): row is { tier: ProducerTier; priceId: string } => Boolean(row.tier && row.priceId))
    .sort((a, b) => producerTierRank(b.tier) - producerTierRank(a.tier));

  return candidates[0] ?? null;
};

const resolveSubscriptionKind = async (
  supabase: ReturnType<typeof createClient>,
  params: {
    subscriptionId: string;
    customerId?: string | null;
    metadata?: Record<string, unknown> | null;
    priceIds?: string[];
  },
): Promise<SubscriptionKind> => {
  const { subscriptionId, customerId = null, metadata = null, priceIds = [] } = params;

  const explicitKind = asSubscriptionKind(metadata?.subscription_kind);
  if (explicitKind) {
    return explicitKind;
  }

  const { data: existingUserSubscription } = await supabase
    .from("user_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (existingUserSubscription) {
    return "user";
  }

  const { data: existingProducerSubscription } = await supabase
    .from("producer_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (existingProducerSubscription) {
    return "producer";
  }

  if (customerId) {
    const { data: customerUserSubscription } = await supabase
      .from("user_subscriptions")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (customerUserSubscription) {
      return "user";
    }
  }

  const producerPlanMatch = await resolveProducerTierFromDbPlans(supabase, priceIds);
  if (producerPlanMatch) {
    return "producer";
  }

  if (priceIds.some((priceId) => USER_SUBSCRIPTION_PRICE_IDS.has(priceId))) {
    return "user";
  }

  return "producer";
};

const resolveProducerTierFromSubscription = async (
  supabase: ReturnType<typeof createClient>,
  params: {
  isActive: boolean;
  priceIds: string[];
  currentTier: ProducerTier | null;
  subscriptionId: string;
  userId: string;
}) => {
  const { isActive, priceIds, currentTier, subscriptionId, userId } = params;
  if (!isActive) {
    return { tier: "user" as ProducerTier, matchedPriceId: null, source: "inactive" };
  }

  const dbMatch = await resolveProducerTierFromDbPlans(supabase, priceIds);
  if (dbMatch) {
    return { tier: dbMatch.tier, matchedPriceId: dbMatch.priceId, source: "producer_plans" };
  }

  const proPriceId = asNonEmptyString(Deno.env.get("STRIPE_PRODUCER_PRICE_ID"));
  const elitePriceId = asNonEmptyString(Deno.env.get("STRIPE_PRODUCER_ELITE_PRICE_ID"));
  const priceSet = new Set(priceIds);

  if (elitePriceId && priceSet.has(elitePriceId)) {
    return { tier: "elite" as ProducerTier, matchedPriceId: elitePriceId, source: "env_fallback" };
  }
  if (proPriceId && priceSet.has(proPriceId)) {
    return { tier: "producteur" as ProducerTier, matchedPriceId: proPriceId, source: "env_fallback" };
  }

  const fallbackTier = currentTier ?? "user";
  console.warn("TIER_SYNC_UNKNOWN_PRICE", {
    subscriptionId,
    userId,
    priceIds,
    configuredProPriceId: proPriceId,
    configuredElitePriceId: elitePriceId,
    fallbackTier,
  });
  return { tier: fallbackTier, matchedPriceId: null, source: "current_tier_fallback" };
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
  const resolvedEndpoint = resolveContractGenerateEndpoint({
    CONTRACT_GENERATE_ENDPOINT: Deno.env.get("CONTRACT_GENERATE_ENDPOINT"),
    CONTRACT_SERVICE_URL: Deno.env.get("CONTRACT_SERVICE_URL"),
  });
  const contractServiceSecret = Deno.env.get("CONTRACT_SERVICE_SECRET");

  if (!resolvedEndpoint.endpoint) {
    return {
      ok: false as const,
      error: "missing_contract_generate_endpoint",
      source: resolvedEndpoint.source,
      details: resolvedEndpoint.error,
    };
  }

  if (!contractServiceSecret?.trim()) {
    return {
      ok: false as const,
      error: "missing_contract_service_secret",
      source: resolvedEndpoint.source,
      details: null,
    };
  }

  const result = await invokeContractGeneration({
    endpoint: resolvedEndpoint.endpoint,
    secret: contractServiceSecret,
    purchaseId,
    timeoutMs: 8000,
  });

  if (!result.ok) {
    console.error("[contract-service] Request failed", {
      purchaseId,
      endpoint: resolvedEndpoint.endpoint,
      source: resolvedEndpoint.source,
      status: result.status,
      error: result.error,
      body: result.body,
    });
    return {
      ok: false as const,
      error: result.error,
      source: resolvedEndpoint.source,
      details: result.body,
      status: result.status,
    };
  }

  console.log("[contract-service] Triggered", {
    purchaseId,
    endpoint: resolvedEndpoint.endpoint,
    source: resolvedEndpoint.source,
  });

  return {
    ok: true as const,
    source: resolvedEndpoint.source,
    status: result.status,
  };
}

const computeContractJobBackoffSeconds = (attempts: number) => {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  const base = 30 * Math.pow(2, Math.max(0, safeAttempts - 1));
  return Math.min(3600, Math.max(60, Math.floor(base)));
};

async function enqueueContractGenerationJob(
  supabase: ReturnType<typeof createClient>,
  purchaseId: string,
) {
  const { data, error } = await supabase.rpc("enqueue_contract_generation_job", {
    p_purchase_id: purchaseId,
  });

  if (error) {
    console.error("[contract-generation-jobs] enqueue failed", {
      purchaseId,
      code: error.code,
      message: error.message,
      details: error.details,
    });
    return null;
  }

  const jobId = typeof data === "string" ? data : null;
  console.log("[contract-generation-jobs] enqueued", { purchaseId, jobId });
  return jobId;
}

async function markContractGenerationJobSuccess(
  supabase: ReturnType<typeof createClient>,
  purchaseId: string,
) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("contract_generation_jobs")
    .update({
      status: "succeeded",
      last_error: null,
      locked_at: null,
      locked_by: null,
      next_run_at: nowIso,
      updated_at: nowIso,
    })
    .eq("purchase_id", purchaseId)
    .in("status", ["pending", "processing"]);

  if (error) {
    console.error("[contract-generation-jobs] mark success failed", {
      purchaseId,
      error,
    });
  }
}

async function markContractGenerationJobFailure(
  supabase: ReturnType<typeof createClient>,
  purchaseId: string,
  reason: string,
) {
  const { data: latestJob, error: readError } = await supabase
    .from("contract_generation_jobs")
    .select("id, attempts, status")
    .eq("purchase_id", purchaseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError || !latestJob?.id) {
    console.error("[contract-generation-jobs] failed to load latest job for failure update", {
      purchaseId,
      readError,
    });
    return;
  }

  const attempts = Number.isFinite(latestJob.attempts) ? Number(latestJob.attempts) : 0;
  const nextAttempts = attempts + 1;
  const backoffSeconds = computeContractJobBackoffSeconds(nextAttempts);
  const nowMs = Date.now();

  const { error: updateError } = await supabase
    .from("contract_generation_jobs")
    .update({
      status: "failed",
      attempts: nextAttempts,
      last_error: reason,
      next_run_at: new Date(nowMs + backoffSeconds * 1000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date(nowMs).toISOString(),
    })
    .eq("id", latestJob.id);

  if (updateError) {
    console.error("[contract-generation-jobs] mark failure failed", {
      purchaseId,
      jobId: latestJob.id,
      reason,
      updateError,
    });
  } else {
    console.error("[contract-generation-jobs] contract generation scheduled for retry", {
      purchaseId,
      jobId: latestJob.id,
      reason,
      nextAttempts,
      backoffSeconds,
    });
  }
}

async function triggerContractJobWorker(
  supabase: ReturnType<typeof createClient>,
  purchaseId: string,
) {
  const workerSecret = asNonEmptyString(Deno.env.get("CONTRACT_SERVICE_SECRET"));
  if (!workerSecret) {
    console.error("[contract-generation-jobs] cannot trigger worker: missing CONTRACT_SERVICE_SECRET");
    return;
  }

  const { error } = await supabase.functions.invoke("process-contract-jobs", {
    body: {
      limit: 5,
      worker: "stripe-webhook",
      purchase_id: purchaseId,
    },
    headers: {
      "x-contract-worker-secret": workerSecret,
    },
  });

  if (error) {
    console.error("[contract-generation-jobs] worker invoke failed", {
      purchaseId,
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

serveWithErrorHandling("stripe-webhook", async (req: Request, context: RequestContext) => {
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
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          if (!isCheckoutSession(event.data.object)) {
            throw new WebhookError(`Invalid payload for ${event.type}`, 400, true);
          }
          await handleCheckoutCompleted(supabase, stripe, event.data.object, event.id);
          break;
        }
        case "checkout.session.async_payment_failed":
          console.warn("[stripe-webhook] Async payment failed", {
            eventId: event.id,
            eventType: event.type,
          });
          break;
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
        case "invoice.payment_succeeded":
        case "invoice.paid": {
          if (!isInvoice(event.data.object)) {
            throw new WebhookError(`Invalid payload for ${event.type}`, 400, true);
          }
          await handlePaymentSucceeded(supabase, stripe, event.data.object, event.id);
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
      captureException(error, context);

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
    captureException(error, context);

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
  eventId: string,
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
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = asNonEmptyString(
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id,
    );
    const subscriptionKind = await resolveSubscriptionKind(supabase, {
      subscriptionId,
      customerId,
      metadata: {
        ...(subscription.metadata ?? {}),
        ...(session.metadata ?? {}),
      },
      priceIds: extractSubscriptionPriceIds(subscription),
    });

    if (subscriptionKind === "user") {
      await upsertUserSubscriptionFromStripe(supabase, stripe, subscriptionId, subscription);
    } else {
      await upsertProducerSubscriptionFromStripe(supabase, stripe, subscriptionId, subscription);
    }
    return;
  }

  const userId = asNonEmptyString(metadata.user_id);
  const productId = asNonEmptyString(metadata.product_id);
  const isExclusive = metadata.is_exclusive === "true";
  const metadataLicenseId = asNonEmptyString(metadata.license_id);
  const metadataLicenseName = asNonEmptyString(metadata.license_name);
  const licenseType = asNonEmptyString(metadata.license_type) || metadataLicenseName || "standard";
  // Source of truth for checkout pricing:
  // Stripe paid amount must match immutable snapshot captured at checkout creation.
  const metadataDbPriceSnapshotRaw =
    asNonEmptyString(metadata.db_price_snapshot) ??
    // Backward compatibility for sessions created before snapshot key rollout.
    asNonEmptyString(metadata.db_price);
  const metadataDbPriceSnapshot = metadataDbPriceSnapshotRaw && /^\d+$/.test(metadataDbPriceSnapshotRaw)
    ? Number.parseInt(metadataDbPriceSnapshotRaw, 10)
    : null;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const amountTotal = session.amount_total;

  if (
    !userId ||
    !productId ||
    !paymentIntentId ||
    amountTotal === null ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal <= 0
  ) {
    throw new WebhookError("Missing secure checkout metadata for purchase completion", 400, true);
  }

  if (metadataDbPriceSnapshot === null || metadataDbPriceSnapshot !== amountTotal) {
    throw new WebhookError(
      `Checkout amount mismatch (expected ${metadataDbPriceSnapshot ?? "unknown"}, got ${amountTotal})`,
      400,
      true,
    );
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
      // Persist the immutable checkout snapshot after Stripe-vs-snapshot validation above.
      p_amount: metadataDbPriceSnapshot,
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

  const { error: notificationError } = await supabase
    .from("notifications")
    .upsert(
      {
        user_id: userId,
        purchase_id: purchaseId,
        type: "purchase",
        title: "Paiement confirme",
        message: "Ton achat a ete valide, tu peux telecharger ton contenu.",
      },
      {
        onConflict: "purchase_id",
        ignoreDuplicates: true,
      },
    );

  if (notificationError) {
    console.error("[stripe-webhook] failed to upsert purchase notification", {
      purchaseId,
      userId,
      message: notificationError.message,
      code: notificationError.code,
    });
  }

  await enqueueContractGenerationJob(supabase, purchaseId);
  const contractTrigger = await notifyContractService(purchaseId);

  if (contractTrigger.ok) {
    await markContractGenerationJobSuccess(supabase, purchaseId);
  } else {
    const composedReason = [
      asNonEmptyString(contractTrigger.error),
      asNonEmptyString(contractTrigger.details),
      contractTrigger.status ? `status=${contractTrigger.status}` : null,
    ].filter((value): value is string => Boolean(value)).join(" | ") || "contract_generation_failed";

    await markContractGenerationJobFailure(supabase, purchaseId, composedReason);
    await triggerContractJobWorker(supabase, purchaseId);
  }

  try {
    const currency = asNonEmptyString(session.currency)?.toUpperCase() ?? "EUR";
    const value = centsToCurrencyAmount(amountTotal);

    if (value !== null) {
      const productTitle = asNonEmptyString(metadata.product_name)
        ?? (
          await supabase
            .from("products")
            .select("title")
            .eq("id", productId)
            .maybeSingle()
        ).data?.title
        ?? "Product purchase";

      await trackPurchaseViaGa4(supabase, {
        transactionId: sessionId,
        stripeEventId: eventId,
        value,
        currency,
        userId,
        gaClientId: asNonEmptyString(metadata.ga_client_id),
        item: {
          item_id: productId,
          item_name: productTitle,
          price: value,
        },
      });
    }
  } catch (error) {
    console.error("[stripe-webhook] GA4 purchase tracking failed after checkout.session.completed", {
      eventId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

  const priceIds = extractSubscriptionPriceIds(subscription);
  const subscriptionKind = await resolveSubscriptionKind(supabase, {
    subscriptionId,
    customerId,
    metadata: subscription.metadata ?? {},
    priceIds,
  });

  if (subscriptionKind === "user") {
    await upsertUserSubscription(supabase, {
      customerId,
      subscriptionId,
      status: subscription.status,
      currentPeriodStart: subscription.current_period_start ?? undefined,
      currentPeriodEnd: resolveSubscriptionCurrentPeriodEnd(subscription) ?? undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at ?? undefined,
      userId: asNonEmptyString(subscription.metadata?.user_id) ?? undefined,
      planCode: asNonEmptyString(subscription.metadata?.plan_code) ?? undefined,
      priceIds,
    });
  } else {
    await upsertProducerSubscription(supabase, {
      customerId,
      subscriptionId,
      status: subscription.status,
      currentPeriodEnd: resolveSubscriptionCurrentPeriodEnd(subscription) ?? undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      userId: asNonEmptyString(subscription.metadata?.user_id) ?? undefined,
      priceIds,
    });
  }
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

  const priceIds = extractSubscriptionPriceIds(subscription);
  const subscriptionKind = await resolveSubscriptionKind(supabase, {
    subscriptionId,
    customerId,
    metadata: subscription.metadata ?? {},
    priceIds,
  });

  if (subscriptionKind === "user") {
    await upsertUserSubscription(supabase, {
      customerId,
      subscriptionId,
      status: "canceled",
      currentPeriodStart: subscription.current_period_start ?? undefined,
      currentPeriodEnd: 0,
      cancelAtPeriodEnd: true,
      canceledAt: subscription.canceled_at ?? undefined,
      userId: asNonEmptyString(subscription.metadata?.user_id) ?? undefined,
      planCode: asNonEmptyString(subscription.metadata?.plan_code) ?? undefined,
      priceIds,
    });
  } else {
    await upsertProducerSubscription(supabase, {
      customerId,
      subscriptionId,
      status: "canceled",
      currentPeriodEnd: 0,
      cancelAtPeriodEnd: true,
      userId: asNonEmptyString(subscription.metadata?.user_id) ?? undefined,
      priceIds,
    });
  }
}

async function handlePaymentSucceeded(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  eventId: string,
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

  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionCustomerId = asNonEmptyString(
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id,
  ) ?? customerId;

  const subscriptionKind = await resolveSubscriptionKind(supabase, {
    subscriptionId,
    customerId: subscriptionCustomerId,
    metadata: {
      ...(stripeSubscription.metadata ?? {}),
      ...(resolveInvoiceSubscriptionMetadata(invoice) ?? {}),
    },
    priceIds: extractSubscriptionPriceIds(stripeSubscription),
  });

  console.log("[handlePaymentSucceeded] Stripe subscription sync context", {
    invoiceId: invoice.id,
    customerId,
    subscriptionId,
    subscriptionKind,
    stripeSubscriptionStatus: stripeSubscription.status,
    subscriptionPriceIds: extractSubscriptionPriceIds(stripeSubscription),
  });

  if (subscriptionKind === "user") {
    await upsertUserSubscriptionFromStripe(supabase, stripe, subscriptionId, stripeSubscription);
  } else {
    await upsertProducerSubscriptionFromStripe(supabase, stripe, subscriptionId, stripeSubscription);
  }

  const routedSubscriptionKind = await resolveInvoiceSubscriptionKind(supabase, {
    customerId,
    subscriptionId,
    invoice,
  });

  console.log("[handlePaymentSucceeded] Subscription payment routing", {
    invoiceId: invoice.id,
    customerId,
    subscriptionId,
    subscriptionKind: routedSubscriptionKind,
    invoicePriceIds: extractInvoicePriceIds(invoice),
    hasInvoiceSubscriptionMetadata: Boolean(resolveInvoiceSubscriptionMetadata(invoice)),
  });

  if (routedSubscriptionKind === "user") {
    console.log("[handlePaymentSucceeded] CREDITS ALLOCATION START", {
      invoiceId: invoice.id,
      customerId,
      subscriptionId,
    });
    await allocateMonthlyCredits(supabase, {
      customerId,
      subscriptionId,
      invoiceId: asNonEmptyString(invoice.id),
      invoice,
    });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (profile) {
    await supabase.rpc("log_audit_event", {
      p_user_id: profile.id,
      p_action: routedSubscriptionKind === "user"
        ? "user_subscription_payment_succeeded"
        : "subscription_payment_succeeded",
      p_resource_type: routedSubscriptionKind === "user" ? "user_subscription" : "subscription",
      p_metadata: { invoice_id: invoice.id, subscription_id: subscriptionId },
    });
  } else {
    console.warn("[handlePaymentSucceeded] No profile found for customer", { customerId });
  }

  try {
    const invoiceId = asNonEmptyString(invoice.id);
    const value = centsToCurrencyAmount(invoice.amount_paid);

    if (!invoiceId || value === null) {
      return;
    }

    const invoiceMetadata = resolveInvoiceSubscriptionMetadata(invoice) ?? {};
    const productId = asNonEmptyString(invoiceMetadata.product_id)
      ?? extractInvoicePriceIds(invoice)[0]
      ?? subscriptionId;
    const productName = asNonEmptyString(invoiceMetadata.product_name)
      ?? asNonEmptyString(invoice.lines?.data?.[0]?.description)
      ?? asNonEmptyString(invoiceMetadata.plan_code)
      ?? "Subscription payment";

    await trackPurchaseViaGa4(supabase, {
      transactionId: invoiceId,
      stripeEventId: eventId,
      value,
      currency: asNonEmptyString(invoice.currency)?.toUpperCase() ?? "EUR",
      userId: profile?.id ?? asNonEmptyString(invoiceMetadata.user_id),
      gaClientId: asNonEmptyString(invoiceMetadata.ga_client_id),
      item: {
        item_id: productId,
        item_name: productName,
        price: value,
      },
    });
  } catch (error) {
    console.error("[stripe-webhook] GA4 purchase tracking failed after invoice payment success", {
      eventId,
      invoiceId: invoice.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function allocateMonthlyCredits(
  supabase: ReturnType<typeof createClient>,
  params: {
    customerId: string;
    subscriptionId: string;
    invoiceId: string | null;
    invoice: Stripe.Invoice;
  },
) {
  const { customerId, subscriptionId, invoiceId, invoice } = params;

  if (!invoiceId) {
    console.warn("[allocateMonthlyCredits] Missing invoice id", {
      customerId,
      subscriptionId,
    });
    return;
  }

  const { periodStart, periodEnd } = resolveInvoiceBillingPeriod(invoice);

  if (!periodStart || !periodEnd) {
    console.warn("[allocateMonthlyCredits] Missing invoice billing period", {
      invoiceId,
      customerId,
      subscriptionId,
      invoiceLineCount: invoice.lines?.data?.length ?? 0,
    });
    return;
  }

  const { data, error } = await supabase.rpc("allocate_monthly_user_credits_for_invoice", {
    p_stripe_invoice_id: invoiceId,
    p_stripe_subscription_id: subscriptionId,
    p_billing_period_start: periodStart,
    p_billing_period_end: periodEnd,
    p_metadata: {
      source: "stripe_webhook",
      stripe_event_source: "invoice_payment_succeeded",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
    },
  });

  if (error) {
    console.error("[allocateMonthlyCredits] Allocation failed", {
      invoiceId,
      subscriptionId,
      customerId,
      code: error.code,
      message: error.message,
      details: error.details,
    });
    throw new Error(`allocate_monthly_user_credits_for_invoice failed: ${error.message}`);
  }

  const payload = (data ?? {}) as {
    status?: string;
    allocated_credits?: number;
    previous_balance?: number;
    new_balance?: number;
  };

  if (payload.status === "processed") {
    console.log("[allocateMonthlyCredits] CREDITS ALLOCATION RESULT", {
      invoiceId,
      subscriptionId,
      allocatedCredits: payload.allocated_credits ?? 0,
      previousBalance: payload.previous_balance ?? null,
      newBalance: payload.new_balance ?? null,
    });
    return;
  }

  if (payload.status === "skipped_max_balance") {
    console.log("[allocateMonthlyCredits] CREDITS ALLOCATION RESULT", {
      invoiceId,
      subscriptionId,
      status: payload.status,
      previousBalance: payload.previous_balance ?? null,
      newBalance: payload.new_balance ?? null,
    });
    return;
  }

  if (payload.status === "duplicate") {
    console.log("[allocateMonthlyCredits] CREDITS ALLOCATION RESULT", {
      invoiceId,
      subscriptionId,
      status: payload.status,
    });
    return;
  }

  if (payload.status === "skipped_inactive_subscription") {
    console.log("[allocateMonthlyCredits] CREDITS ALLOCATION RESULT", {
      invoiceId,
      subscriptionId,
      status: payload.status,
    });
    return;
  }

  console.log("[allocateMonthlyCredits] Allocation returned unexpected status", {
    invoiceId,
    subscriptionId,
    payload,
  });
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

  const subscriptionKind = await resolveInvoiceSubscriptionKind(supabase, {
    customerId,
    subscriptionId,
    invoice,
  });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (profile) {
    await supabase.rpc("log_audit_event", {
      p_user_id: profile.id,
      p_action: subscriptionKind === "user"
        ? "user_subscription_payment_failed"
        : "subscription_payment_failed",
      p_resource_type: subscriptionKind === "user" ? "user_subscription" : "subscription",
      p_metadata: { invoice_id: invoice.id, subscription_id: subscriptionId },
    });
  }
}

async function resolveInvoiceSubscriptionKind(
  supabase: ReturnType<typeof createClient>,
  params: {
    customerId: string;
    subscriptionId: string;
    invoice?: Stripe.Invoice;
  },
) {
  const { customerId, subscriptionId, invoice } = params;

  const explicitKind = asSubscriptionKind(resolveInvoiceSubscriptionMetadata(invoice)?.subscription_kind);
  if (explicitKind) {
    return explicitKind;
  }

  const { data: userSubscription } = await supabase
    .from("user_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (userSubscription) return "user" as SubscriptionKind;

  const { data: producerSubscription } = await supabase
    .from("producer_subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (producerSubscription) return "producer" as SubscriptionKind;

  const { data: userByCustomer } = await supabase
    .from("user_subscriptions")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (userByCustomer) return "user" as SubscriptionKind;

  const invoicePriceIds = extractInvoicePriceIds(invoice);
  if (invoicePriceIds.some((priceId) => USER_SUBSCRIPTION_PRICE_IDS.has(priceId))) {
    return "user" as SubscriptionKind;
  }

  const producerPlanMatch = await resolveProducerTierFromDbPlans(supabase, invoicePriceIds);
  if (producerPlanMatch) return "producer" as SubscriptionKind;

  return "producer" as SubscriptionKind;
}

async function upsertProducerSubscriptionFromStripe(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  subscriptionId: string,
  existingSubscription?: Stripe.Subscription,
) {
  const sub = existingSubscription ?? await stripe.subscriptions.retrieve(subscriptionId);

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
    currentPeriodEnd: resolveSubscriptionCurrentPeriodEnd(sub) ?? undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    userId: asNonEmptyString(sub.metadata?.user_id) ?? undefined,
    priceIds: extractSubscriptionPriceIds(sub),
  });
}

async function upsertUserSubscriptionFromStripe(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  subscriptionId: string,
  existingSubscription?: Stripe.Subscription,
) {
  const sub = existingSubscription ?? await stripe.subscriptions.retrieve(subscriptionId);

  const customerId = asNonEmptyString(
    typeof sub.customer === "string"
      ? sub.customer
      : sub.customer?.id,
  );

  if (!customerId) {
    throw new Error(`User subscription ${subscriptionId} is missing customer id`);
  }

  await upsertUserSubscription(supabase, {
    customerId,
    subscriptionId,
    status: sub.status,
    currentPeriodStart: sub.current_period_start ?? undefined,
    currentPeriodEnd: resolveSubscriptionCurrentPeriodEnd(sub) ?? undefined,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ?? undefined,
    userId: asNonEmptyString(sub.metadata?.user_id) ?? undefined,
    planCode: asNonEmptyString(sub.metadata?.plan_code) ?? undefined,
    priceIds: extractSubscriptionPriceIds(sub),
  });
}

async function upsertUserSubscription(
  supabase: ReturnType<typeof createClient>,
  params: {
    customerId: string;
    subscriptionId: string;
    status: string;
    currentPeriodStart?: number | string;
    currentPeriodEnd?: number | string;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: number | string | null;
    userId?: string;
    planCode?: string;
    priceIds?: string[];
  },
) {
  const {
    customerId,
    subscriptionId,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    canceledAt,
    userId,
    planCode,
    priceIds = [],
  } = params;

  let { data: profile } = await supabase
    .from("user_profiles")
    .select("id, stripe_customer_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!profile && userId) {
    const { data: profileById } = await supabase
      .from("user_profiles")
      .select("id, stripe_customer_id")
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
          console.error("[upsertUserSubscription] Failed to link stripe_customer_id", linkErr);
        }
      }
    }
  }

  if (!profile) {
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (existingSub) {
      profile = {
        id: existingSub.user_id,
        stripe_customer_id: null,
      } as { id: string; stripe_customer_id: string | null };
    }
  }

  if (!profile) {
    throw new Error(`No user found for customer ${customerId} / subscription ${subscriptionId}`);
  }

  const shouldBeActive = ACTIVE_SUBSCRIPTION_STATUSES.has(status);
  if (shouldBeActive) {
    const { data: conflictingProducerSubscription, error: conflictingProducerSubscriptionError } = await supabase
      .from("producer_subscriptions")
      .select("id, subscription_status, current_period_end, is_producer_active")
      .eq("user_id", profile.id)
      .maybeSingle();

    if (conflictingProducerSubscriptionError) {
      throw new Error(
        `Failed to validate producer subscription exclusivity for user ${profile.id}: ${conflictingProducerSubscriptionError.message}`,
      );
    }

    const hasConflictingProducerSubscription = Boolean(
      conflictingProducerSubscription && (
        conflictingProducerSubscription.is_producer_active === true ||
        (
          typeof conflictingProducerSubscription.subscription_status === "string" &&
          ACTIVE_SUBSCRIPTION_STATUSES.has(conflictingProducerSubscription.subscription_status) &&
          typeof conflictingProducerSubscription.current_period_end === "string" &&
          Date.parse(conflictingProducerSubscription.current_period_end) > Date.now()
        )
      ),
    );

    if (hasConflictingProducerSubscription) {
      console.error("[upsertUserSubscription] Conflicting active producer subscription detected", {
        userId: profile.id,
        subscriptionId,
        conflictingProducerSubscriptionId: conflictingProducerSubscription?.id ?? null,
      });
      throw new Error("subscription_conflict_producer_active");
    }
  }

  const currentStartIso = normalizeStripeTimestampToIso(currentPeriodStart);
  let currentEndIso = normalizeStripeTimestampToIso(currentPeriodEnd);

  if (!currentEndIso) {
    const { data: existingPeriod } = await supabase
      .from("user_subscriptions")
      .select("current_period_end")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    currentEndIso = existingPeriod?.current_period_end || null;
  }

  const canceledAtIso = normalizeStripeTimestampToIso(canceledAt);
  const resolvedPlanCode = planCode ?? "user_monthly";
  const resolvedPriceId = priceIds[0] ?? asNonEmptyString(Deno.env.get("STRIPE_USER_SUBSCRIPTION_PRICE_ID"));

  if (!resolvedPriceId) {
    throw new Error(`User subscription ${subscriptionId} is missing a resolved Stripe price id`);
  }

  const { error } = await supabase
    .from("user_subscriptions")
    .upsert({
      user_id: profile.id,
      plan_code: resolvedPlanCode,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_price_id: resolvedPriceId,
      subscription_status: status,
      current_period_start: currentStartIso,
      current_period_end: currentEndIso,
      cancel_at_period_end: cancelAtPeriodEnd ?? false,
      canceled_at: canceledAtIso,
    }, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to upsert user_subscriptions: ${error.message}`);
  }
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
    priceIds?: string[];
  },
) {
  const { customerId, subscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd, userId, priceIds = [] } = params;

  let { data: profile } = await supabase
    .from("user_profiles")
    .select("id, stripe_customer_id, stripe_subscription_id, producer_tier, role")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!profile && userId) {
    const { data: profileById } = await supabase
      .from("user_profiles")
      .select("id, stripe_customer_id, stripe_subscription_id, producer_tier, role")
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
      profile = {
        id: existingSub.user_id,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        producer_tier: null,
        role: null,
      } as {
        id: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        producer_tier: ProducerTier | null;
        role: string | null;
      };
    }
  }

  if (!profile) {
    const { data: profileBySubscription } = await supabase
      .from("user_profiles")
      .select("id, stripe_customer_id, stripe_subscription_id, producer_tier, role")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (profileBySubscription) {
      profile = profileBySubscription;
    }
  }

  if (!profile) {
    throw new Error(`No user found for customer ${customerId} / subscription ${subscriptionId}`);
  }

  const shouldBeActive = ACTIVE_SUBSCRIPTION_STATUSES.has(status);
  if (shouldBeActive) {
    const { data: conflictingUserSubscription, error: conflictingUserSubscriptionError } = await supabase
      .from("user_subscriptions")
      .select("id, subscription_status, current_period_end")
      .eq("user_id", profile.id)
      .maybeSingle();

    if (conflictingUserSubscriptionError) {
      throw new Error(
        `Failed to validate user subscription exclusivity for user ${profile.id}: ${conflictingUserSubscriptionError.message}`,
      );
    }

    const hasConflictingUserSubscription = Boolean(
      conflictingUserSubscription &&
      typeof conflictingUserSubscription.subscription_status === "string" &&
      ACTIVE_SUBSCRIPTION_STATUSES.has(conflictingUserSubscription.subscription_status) &&
      (
        typeof conflictingUserSubscription.current_period_end !== "string" ||
        Date.parse(conflictingUserSubscription.current_period_end) > Date.now()
      )
    );

    if (hasConflictingUserSubscription) {
      console.error("[upsertProducerSubscription] Conflicting active user subscription detected", {
        userId: profile.id,
        subscriptionId,
        conflictingUserSubscriptionId: conflictingUserSubscription?.id ?? null,
      });
      throw new Error("subscription_conflict_user_active");
    }
  }

  let periodEndMs: number | undefined;
  if (typeof currentPeriodEnd === "number" && Number.isFinite(currentPeriodEnd)) {
    periodEndMs = Math.abs(currentPeriodEnd) < 1_000_000_000_000
      ? currentPeriodEnd * 1000
      : currentPeriodEnd;
  } else if (typeof currentPeriodEnd === "string") {
    const trimmedPeriodEnd = currentPeriodEnd.trim();
    if (trimmedPeriodEnd.length > 0) {
      if (/^-?\d+$/.test(trimmedPeriodEnd)) {
        const numericTs = Number.parseInt(trimmedPeriodEnd, 10);
        if (Number.isFinite(numericTs)) {
          periodEndMs = Math.abs(numericTs) < 1_000_000_000_000
            ? numericTs * 1000
            : numericTs;
        }
      } else {
        const parsedMs = Date.parse(trimmedPeriodEnd);
        if (Number.isFinite(parsedMs)) {
          periodEndMs = parsedMs;
        }
      }
    }
  }

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
  let profileRole = (profile as { role?: string | null }).role ?? null;
  if (profileRole === null) {
    const { data: profileRoleRow, error: profileRoleErr } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", profile.id)
      .maybeSingle();

    if (profileRoleErr) {
      console.error("[upsertProducerSubscription] Failed to resolve current role", profileRoleErr);
    } else {
      profileRole = (profileRoleRow as { role?: string | null } | null)?.role ?? null;
    }
  }

  const currentTier = asProducerTier((profile as { producer_tier?: unknown })?.producer_tier ?? null);
  const tierResolution = await resolveProducerTierFromSubscription(supabase, {
    isActive,
    priceIds,
    currentTier,
    subscriptionId,
    userId: profile.id,
  });
  const nextTier = tierResolution.tier;
  const shouldExposeProducerAccess = isActive && profileRole !== "admin";

  const profileUpdates: Record<string, unknown> = {
    stripe_subscription_id: subscriptionId,
    producer_tier: nextTier,
    is_producer_active: shouldExposeProducerAccess,
  };
  if (!profile.stripe_customer_id) {
    profileUpdates.stripe_customer_id = customerId;
  }
  if (shouldExposeProducerAccess && profileRole !== "producer") {
    profileUpdates.role = "producer";
  }

  const { error: profileUpdateErr } = await supabase
    .from("user_profiles")
    .update(profileUpdates)
    .eq("id", profile.id);

  if (profileUpdateErr) {
    console.error("[upsertProducerSubscription] Failed to sync user profile identifiers", profileUpdateErr);
    throw new Error(`Failed to update user profile: ${profileUpdateErr.message}`);
  }

  console.log("TIER_SYNC", {
    userId: profile.id,
    subscriptionId,
    status,
    isActive,
    source: tierResolution.source,
    matchedPriceId: tierResolution.matchedPriceId,
    previousTier: currentTier,
    nextTier,
    priceIds,
  });

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
