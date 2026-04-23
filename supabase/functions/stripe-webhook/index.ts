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

const asJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
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

type CheckoutCompletionItem = {
  productId: string;
  amount: number;
  isExclusive: boolean;
  licenseType: string;
  producerPayoutAmount: number | null;
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
    const { error: existingRowError } = await supabase
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

  const sent = await sendPurchaseToGA4(payload);
  if (sent) {
    await markGa4PurchaseTrackingSent(supabase, payload.transactionId);
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

const resolveStripeSubscriptionBillingPeriod = (
  subscription: Stripe.Subscription | null | undefined,
) => {
  const periodStart = toIsoFromUnixSeconds(subscription?.current_period_start ?? null);
  const periodEnd = toIsoFromUnixSeconds(resolveSubscriptionCurrentPeriodEnd(subscription));

  if (!periodStart || !periodEnd) {
    return {
      periodStart: null,
      periodEnd: null,
    };
  }

  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    return {
      periodStart: null,
      periodEnd: null,
    };
  }

  return {
    periodStart,
    periodEnd,
  };
};

async function resolveProfileForStripeCustomer<TProfile extends { id: string; stripe_customer_id: string | null }>(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  params: {
    customerId: string;
    subscriptionId: string;
    userId?: string;
    selectClause: string;
    logContext: string;
  },
): Promise<TProfile | null> {
  const { customerId, subscriptionId, userId, selectClause, logContext } = params;

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select(selectClause)
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`[${logContext}] Failed to lookup user by stripe_customer_id: ${profileError.message}`);
  }

  if (profile) {
    return profile as TProfile;
  }

  if (userId) {
    const { data: profileById, error: profileByIdError } = await supabase
      .from("user_profiles")
      .select(selectClause)
      .eq("id", userId)
      .maybeSingle();

    if (profileByIdError) {
      throw new Error(`[${logContext}] Failed to lookup user by id: ${profileByIdError.message}`);
    }

    if (profileById) {
      if (!profileById.stripe_customer_id) {
        const { error: linkErr } = await supabase
          .from("user_profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", profileById.id);

        if (linkErr) {
          console.error(`[${logContext}] Failed to link stripe_customer_id`, linkErr);
        } else {
          profileById.stripe_customer_id = customerId;
        }
      }

      return profileById as TProfile;
    }
  }

  console.error("Stripe customer not linked", customerId);
  console.log("customerId:", customerId);

  try {
    const customer = await stripe.customers.retrieve(customerId);
    console.log("stripe customer:", customer);
    if ("deleted" in customer && customer.deleted) {
      return null;
    }

    const customerEmail = asNonEmptyString(customer.email);
    if (!customerEmail) {
      console.error(`[${logContext}] CRITICAL: Stripe customer has no email — cannot fallback to email lookup`, {
        customerId,
        subscriptionId,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    const { data: profileByEmail, error: profileByEmailError } = await supabase
      .from("user_profiles")
      .select(selectClause)
      .ilike("email", customerEmail)
      .maybeSingle();

    if (profileByEmailError) {
      throw new Error(`[${logContext}] Failed to lookup user by email: ${profileByEmailError.message}`);
    }

    if (!profileByEmail) {
      console.error(`[${logContext}] CRITICAL: User not found after all fallback attempts (no email match)`, {
        customerId,
        subscriptionId,
        customerEmail,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    if (!profileByEmail.stripe_customer_id) {
      const { error: linkErr } = await supabase
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", profileByEmail.id);

      if (linkErr) {
        console.error(`[${logContext}] Failed to link stripe_customer_id after email fallback`, linkErr);
      } else {
        profileByEmail.stripe_customer_id = customerId;
      }
    }

    return profileByEmail as TProfile;
  } catch (error) {
    console.error(`[${logContext}] CRITICAL: Stripe customer retrieval failed — email fallback unavailable`, {
      customerId,
      subscriptionId,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    return null;
  }
}

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
  const { isActive, priceIds, subscriptionId, userId } = params;
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

  // Hard fail — ne jamais silencieusement fallback sur un abonnement actif avec un price_id inconnu.
  // L'utilisateur a payé : s'il est impossible de déterminer le tier, on rejette le webhook
  // afin que Stripe le réessaie et qu'une alerte soit visible dans les logs.
  throw new Error(
    `TIER_SYNC_UNKNOWN_PRICE: abonnement actif ${subscriptionId} (user ${userId}) — ` +
    `aucun tier ne correspond aux price IDs [${priceIds.join(", ")}]. ` +
    `Vérifiez producer_plans.stripe_price_id ou les variables d'env ` +
    `STRIPE_PRODUCER_PRICE_ID / STRIPE_PRODUCER_ELITE_PRICE_ID.`
  );
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

const parsePositiveIntMetadata = (value: unknown): number | null => {
  const rawValue = asNonEmptyString(value);
  if (!rawValue || !/^\d+$/.test(rawValue)) return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseNonNegativeIntMetadata = (value: unknown): number | null => {
  const rawValue = asNonEmptyString(value);
  if (!rawValue || !/^\d+$/.test(rawValue)) return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

function resolveCheckoutCompletionItems(
  metadata: Record<string, string>,
  amountTotal: number,
): CheckoutCompletionItem[] {
  const cartItemCount = parsePositiveIntMetadata(metadata.cart_item_count);

  if (cartItemCount !== null) {
    const items: CheckoutCompletionItem[] = [];

    for (let index = 0; index < cartItemCount; index += 1) {
      const productId = asNonEmptyString(metadata[`item_${index}_product_id`]);
      const amount = parsePositiveIntMetadata(metadata[`item_${index}_amount`]);

      if (!productId || amount === null) {
        return [];
      }

      items.push({
        productId,
        amount,
        isExclusive: metadata[`item_${index}_is_exclusive`] === "true",
        licenseType: asNonEmptyString(metadata[`item_${index}_license_type`]) || "standard",
        producerPayoutAmount: parseNonNegativeIntMetadata(metadata[`item_${index}_producer_payout_amount`]),
      });
    }

    return items;
  }

  const productId = asNonEmptyString(metadata.product_id);
  const amount =
    parsePositiveIntMetadata(metadata.db_price_snapshot) ??
    parsePositiveIntMetadata(metadata.db_price) ??
    amountTotal;

  if (!productId || !Number.isSafeInteger(amount) || amount <= 0) {
    return [];
  }

  return [{
    productId,
    amount,
    isExclusive: metadata.is_exclusive === "true",
    licenseType: asNonEmptyString(metadata.license_type) || asNonEmptyString(metadata.license_name) || "standard",
    producerPayoutAmount: parseNonNegativeIntMetadata(metadata.producer_payout_amount),
  }];
}

async function applyFallbackPayoutTracking(
  supabase: ReturnType<typeof createClient>,
  purchaseId: string,
  producerAmount: number,
) {
  const { data: existingPurchase, error: fetchError } = await supabase
    .from("purchases")
    .select("metadata")
    .eq("id", purchaseId)
    .maybeSingle();

  if (fetchError || !existingPurchase) {
    if (fetchError) {
      console.error("[stripe-webhook] Failed to fetch purchase metadata for fallback payout tracking", {
        purchaseId,
        message: fetchError.message,
      });
    }
    return;
  }

  const existingMetadata =
    typeof existingPurchase?.metadata === "object" && existingPurchase?.metadata !== null
      ? existingPurchase.metadata as Record<string, unknown>
      : {};

  const mergedMetadata = {
    ...existingMetadata,
    payout_mode: "platform_fallback",
    payout_amount: producerAmount,
    requires_manual_payout: true,
    payout_status: existingMetadata?.payout_status ?? "pending",
    tracked_at: new Date().toISOString(),
  };

  await supabase
    .from("purchases")
    .update({ metadata: mergedMetadata })
    .eq("id", purchaseId);
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

function extractCreditAllocationErrorCode(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  if (!message) {
    return null;
  }

  const knownCodes = [
    "user_subscription_not_found",
    "allocateMonthlyCredits_missing_invoice_id",
    "allocateMonthlyCredits_load_subscription_period_failed",
    "allocateMonthlyCredits_missing_subscription_period",
  ];

  for (const code of knownCodes) {
    if (message.includes(code)) {
      return code;
    }
  }

  return null;
}

async function logStripeWebhookMonitoringAlert(
  supabase: ReturnType<typeof createClient>,
  params: {
    eventType: string;
    severity?: "info" | "warning" | "critical";
    entityType?: string | null;
    details?: Record<string, unknown>;
  },
) {
  const { eventType, severity = "warning", entityType = null, details = {} } = params;

  const { error } = await supabase.rpc("log_monitoring_alert", {
    p_event_type: eventType,
    p_severity: severity,
    p_source: "stripe-webhook",
    p_entity_type: entityType,
    p_entity_id: null,
    p_details: details,
  });

  if (error) {
    console.error("[stripe-webhook] Failed to persist monitoring alert", {
      eventType,
      error: error.message,
    });
  }
}

async function persistFailedCreditAllocation(
  supabase: ReturnType<typeof createClient>,
  params: {
    customerId: string;
    subscriptionId: string;
    eventId: string;
    invoice: Stripe.Invoice;
    stripeSubscription: Stripe.Subscription;
    error: unknown;
  },
) {
  const { customerId, subscriptionId, eventId, invoice, stripeSubscription, error } = params;
  const nowIso = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = extractCreditAllocationErrorCode(error);

  try {
    const { data: existingFailure, error: existingFailureError } = await supabase
      .from("failed_credit_allocations")
      .select("retry_count")
      .eq("stripe_event_id", eventId)
      .maybeSingle();

    if (existingFailureError) {
      console.error("[stripe-webhook] Failed to inspect failed credit allocation row", {
        eventId,
        invoiceId: invoice.id,
        subscriptionId,
        error: existingFailureError.message,
      });
      return;
    }

    const retryCount = typeof existingFailure?.retry_count === "number" && existingFailure.retry_count >= 0
      ? existingFailure.retry_count + 1
      : 0;

    const { error: persistError } = await supabase
      .from("failed_credit_allocations")
      .upsert({
        stripe_invoice_id: asNonEmptyString(invoice.id),
        stripe_subscription_id: subscriptionId,
        stripe_event_id: eventId,
        error_message: errorMessage,
        error_code: errorCode,
        retry_count: retryCount,
        updated_at: nowIso,
        next_retry_at: nowIso,
        payload: {
          invoice_id: asNonEmptyString(invoice.id),
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_subscription_status: stripeSubscription.status,
          invoice_status: asNonEmptyString(invoice.status),
          billing_reason: asNonEmptyString(invoice.billing_reason),
          amount_paid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : null,
          metadata: invoice.metadata ?? {},
        },
      }, { onConflict: "stripe_event_id" });

    if (persistError) {
      console.error("[stripe-webhook] Failed to persist failed credit allocation row", {
        eventId,
        invoiceId: invoice.id,
        subscriptionId,
        error: persistError.message,
      });
    }
  } catch (persistError) {
    console.error("[stripe-webhook] Unexpected failed credit allocation persistence error", {
      eventId,
      invoiceId: invoice.id,
      subscriptionId,
      error: persistError instanceof Error ? persistError.message : String(persistError),
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

  if (staleClaim) {
    await logStripeWebhookMonitoringAlert(supabase, {
      eventType: "stripe_webhook_stale_lock_recovered",
      severity: "warning",
      entityType: "stripe_event",
      details: {
        stripe_event_id: eventId,
        recovered_at: nowIso,
        stale_before: staleBeforeIso,
        lock_timeout_ms: lockTimeoutMs,
      },
    });
  }

  return staleClaim;
}

async function processStripeEvent(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  event: Stripe.Event,
) {
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
      await handleSubscriptionUpdate(supabase, stripe, event.data.object);
      break;
    }
    case "customer.subscription.deleted": {
      if (!isSubscription(event.data.object)) {
        throw new WebhookError("Invalid payload for customer.subscription.deleted", 400, true);
      }
      await handleSubscriptionDeleted(supabase, stripe, event.data.object);
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
    case "payout.failed": {
      const payout = event.data.object as Stripe.Payout;

      console.log("[stripe-webhook] payout.failed", {
        payout_id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        failure_code: payout.failure_code,
        failure_message: payout.failure_message,
        arrival_date: payout.arrival_date,
      });

      const stripeAccountId = event.account;

      if (!stripeAccountId) {
        console.warn("[stripe-webhook] payout.failed without account, skipped");
        break;
      }

      const { data: producer, error: producerError } = await supabase
        .from("user_profiles")
        .select("id, email, full_name")
        .eq("stripe_account_id", stripeAccountId)
        .single();

      if (producerError || !producer) {
        console.error("[stripe-webhook] Producer not found for payout.failed", {
          stripeAccountId,
          error: producerError?.message,
        });
        break;
      }

      await supabase.from("stripe_payout_failures").insert({
        user_id: producer.id,
        stripe_account_id: stripeAccountId,
        payout_id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        failure_code: payout.failure_code ?? "unknown",
        failure_message: payout.failure_message ?? "Unknown error",
        arrival_date: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
      });

      console.log("[stripe-webhook] payout.failed processed", {
        producerId: producer.id,
        payoutId: payout.id,
        failureCode: payout.failure_code,
      });

      break;
    }
    case "account.application.deauthorized": {
      const stripeAccountId = event.account;

      console.log("[stripe-webhook] account.application.deauthorized", {
        stripe_account_id: stripeAccountId,
      });

      if (!stripeAccountId) {
        console.warn("[stripe-webhook] deauthorized event without account ID, skipped");
        break;
      }

      const { data: updated, error: updateError } = await supabase
        .from("user_profiles")
        .update({
          stripe_account_id: null,
          stripe_account_charges_enabled: false,
          stripe_account_details_submitted: false,
        })
        .eq("stripe_account_id", stripeAccountId)
        .select("id, email")
        .single();

      if (updateError || !updated) {
        console.error("[stripe-webhook] Failed to clear deauthorized account", {
          account: stripeAccountId,
          error: updateError?.message,
        });
        break;
      }

      console.log("[stripe-webhook] Stripe Connect account cleared after deauthorization", {
        producerId: updated.id,
        stripeAccountId: stripeAccountId,
      });

      break;
    }
    default:
      console.log("[stripe-webhook] Unhandled event type", { eventId: event.id, eventType: event.type });
  }
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
  const internalPipelineSecret = asNonEmptyString(Deno.env.get("INTERNAL_PIPELINE_SECRET"));

  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !stripeWebhookSecret) {
    console.error("[stripe-webhook] Missing required environment variables");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const stripeSignature = req.headers.get("Stripe-Signature");
  const providedInternalSecret = asNonEmptyString(req.headers.get("x-internal-secret"));

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const stripe = new Stripe(stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    if (stripeSignature) {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        stripeSignature,
        stripeWebhookSecret,
        undefined,
        cryptoProvider,
      );
    } else if (internalPipelineSecret && providedInternalSecret === internalPipelineSecret) {
      const parsedBody = rawBody.trim().length > 0 ? asJsonObject(JSON.parse(rawBody)) : null;
      const replayEventId = asNonEmptyString(parsedBody?.replay_event_id);

      if (!replayEventId) {
        return new Response(JSON.stringify({ error: "Missing replay_event_id" }), {
          status: 400,
          headers: jsonHeaders,
        });
      }

      event = await stripe.events.retrieve(replayEventId);
      console.log("[stripe-webhook] Internal replay request", {
        replayEventId,
        replayReason: asNonEmptyString(parsedBody?.replay_reason),
      });
    } else {
      return new Response(JSON.stringify({ error: "Missing Stripe-Signature header" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook payload";
    console.error("[stripe-webhook] Event loading failed", { message });
    return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
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
      await processStripeEvent(supabase, stripe, event);

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

        if (!error.markProcessed) {
          await logStripeWebhookMonitoringAlert(supabase, {
            eventType: "stripe_webhook_processing_failed",
            severity: "critical",
            entityType: "stripe_event",
            details: {
              stripe_event_id: event.id,
              stripe_event_type: event.type,
              error: message,
              status: error.status,
              will_retry: true,
            },
          });
        }

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

      await logStripeWebhookMonitoringAlert(supabase, {
        eventType: "stripe_webhook_processing_failed",
        severity: "critical",
        entityType: "stripe_event",
        details: {
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          error: message,
          will_retry: true,
        },
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
    await logStripeWebhookMonitoringAlert(supabase, {
      eventType: "stripe_webhook_fatal_error",
      severity: "critical",
      entityType: "stripe_event",
      details: {
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        error: message,
        will_retry: true,
      },
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
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const amountTotal = session.amount_total;

  if (
    !userId ||
    !paymentIntentId ||
    amountTotal === null ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal <= 0
  ) {
    throw new WebhookError("Missing secure checkout metadata for purchase completion", 400, true);
  }

  const checkoutItems = resolveCheckoutCompletionItems(metadata, amountTotal);
  const itemAmountTotal = checkoutItems.reduce((sum, item) => sum + item.amount, 0);
  const metadataAmountSnapshot =
    parsePositiveIntMetadata(metadata.cart_amount_snapshot) ??
    parsePositiveIntMetadata(metadata.db_price_snapshot) ??
    parsePositiveIntMetadata(metadata.db_price);

  if (
    checkoutItems.length === 0 ||
    itemAmountTotal !== amountTotal ||
    metadataAmountSnapshot === null ||
    metadataAmountSnapshot !== amountTotal
  ) {
    throw new WebhookError(
      `Checkout amount mismatch (expected ${metadataAmountSnapshot ?? "unknown"}, got ${amountTotal})`,
      400,
      true,
    );
  }

  const stripeConnectMode = asNonEmptyString(metadata.stripe_connect_mode);
  const priceSource = asNonEmptyString(metadata.price_source);
  const purchaseResults: Array<{ item: CheckoutCompletionItem; purchaseId: string }> = [];

  for (const item of checkoutItems) {
    let purchaseId: string | null = null;

    if (checkoutItems.length === 1 && priceSource !== "products.price") {
      const metadataLicenseId = asNonEmptyString(metadata.license_id);
      const metadataLicenseName = asNonEmptyString(metadata.license_name);
      const resolvedLicenseId = await resolveLicenseIdForCheckout(supabase, {
        metadataLicenseId,
        metadataLicenseName,
        legacyLicenseType: item.licenseType,
        isExclusive: item.isExclusive,
      });

      if (resolvedLicenseId) {
        const { data, error } = await supabase.rpc("complete_license_purchase", {
          p_product_id: item.productId,
          p_user_id: userId,
          p_checkout_session_id: sessionId,
          p_payment_intent_id: paymentIntentId,
          p_license_id: resolvedLicenseId,
          p_amount: item.amount,
        });

        if (error) {
          if (isMissingCompleteLicensePurchaseFunctionError(error)) {
            console.warn("[stripe-webhook] complete_license_purchase missing, using legacy fallback", {
              sessionId,
              productId: item.productId,
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
    }

    if (!purchaseId) {
      purchaseId = await completePurchaseWithLegacyRpc(supabase, {
        isExclusive: item.isExclusive,
        sessionId,
        productId: item.productId,
        userId,
        paymentIntentId,
        amountTotal: item.amount,
        licenseType: item.licenseType,
      });
    }

    if (!purchaseId) {
      throw new Error(`Missing purchase id after checkout completion (session ${sessionId})`);
    }

    purchaseResults.push({ item, purchaseId });

    if (stripeConnectMode === "fallback") {
      await applyFallbackPayoutTracking(
        supabase,
        purchaseId,
        item.producerPayoutAmount ?? Math.round(item.amount * 0.7),
      );
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
  }

  try {
    const currency = asNonEmptyString(session.currency)?.toUpperCase() ?? "EUR";
    const value = centsToCurrencyAmount(amountTotal);

    if (value !== null && purchaseResults.length > 0) {
      const firstItem = purchaseResults[0]!.item;
      const productTitle = purchaseResults.length === 1
        ? (
          asNonEmptyString(metadata.product_name)
          ?? (
            await supabase
              .from("products")
              .select("title")
              .eq("id", firstItem.productId)
              .maybeSingle()
          ).data?.title
          ?? "Product purchase"
        )
        : `${purchaseResults.length} product purchase`;

      await trackPurchaseViaGa4(supabase, {
        transactionId: sessionId,
        stripeEventId: eventId,
        value,
        currency,
        userId,
        gaClientId: asNonEmptyString(metadata.ga_client_id),
        item: {
          item_id: purchaseResults.length === 1 ? firstItem.productId : sessionId,
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
  stripe: Stripe,
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

  console.log("customerId:", customerId);
  console.log("metadata:", subscription.metadata);

  const priceIds = extractSubscriptionPriceIds(subscription);
  const subscriptionKind = await resolveSubscriptionKind(supabase, {
    subscriptionId,
    customerId,
    metadata: subscription.metadata ?? {},
    priceIds,
  });

  if (subscriptionKind === "user") {
    await upsertUserSubscription(supabase, {
      stripe,
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
      stripe,
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
  stripe: Stripe,
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

  console.log("customerId:", customerId);
  console.log("metadata:", subscription.metadata);

  const priceIds = extractSubscriptionPriceIds(subscription);
  const subscriptionKind = await resolveSubscriptionKind(supabase, {
    subscriptionId,
    customerId,
    metadata: subscription.metadata ?? {},
    priceIds,
  });

  if (subscriptionKind === "user") {
    await upsertUserSubscription(supabase, {
      stripe,
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
      stripe,
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

  // STRICT: Validate user exists BEFORE attempting subscription sync
  if (subscriptionKind === "user") {
    const userProfileCheck = await resolveProfileForStripeCustomer<{ id: string; stripe_customer_id: string | null }>(
      supabase,
      stripe,
      {
        customerId: subscriptionCustomerId,
        subscriptionId,
        selectClause: "id, stripe_customer_id",
        logContext: "handlePaymentSucceeded_userValidation",
      },
    );

    if (!userProfileCheck?.id) {
      // RULE 1: NEVER swallow critical errors — THROW to force Stripe retry
      throw new WebhookError(
        `User validation failed for Stripe customer ${subscriptionCustomerId} (subscription ${subscriptionId})`,
        400,
        false, // markProcessed=false: will retry
      );
    }

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
      timestamp: new Date().toISOString(),
    });
    try {
      await allocateMonthlyCredits(supabase, {
        customerId,
        subscriptionId,
        invoiceId: asNonEmptyString(invoice.id),
        invoice,
        stripeSubscription,
      });
    } catch (error) {
      await persistFailedCreditAllocation(supabase, {
        customerId,
        subscriptionId,
        eventId,
        invoice,
        stripeSubscription,
        error,
      });
      throw error;
    }
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
    stripeSubscription: Stripe.Subscription;
  },
) {
  const { customerId, subscriptionId, invoiceId, invoice, stripeSubscription } = params;

  if (!invoiceId) {
    throw new Error(`allocateMonthlyCredits_missing_invoice_id:${subscriptionId}:${customerId}`);
  }

  const amountPaid = typeof invoice.amount_paid === "number" && Number.isFinite(invoice.amount_paid)
    ? invoice.amount_paid
    : null;

  if (amountPaid !== null && amountPaid <= 0) {
    console.log("[allocateMonthlyCredits] Skipping non-positive paid invoice", {
      invoiceId,
      customerId,
      subscriptionId,
      amountPaid,
    });
    return;
  }

  let { periodStart, periodEnd } = resolveStripeSubscriptionBillingPeriod(stripeSubscription);
  let periodSource = "stripe_subscription";

  if (!periodStart || !periodEnd) {
    const { data: persistedSubscription, error: persistedSubscriptionError } = await supabase
      .from("user_subscriptions")
      .select("current_period_start, current_period_end")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (persistedSubscriptionError) {
      throw new Error(`allocateMonthlyCredits_load_subscription_period_failed:${persistedSubscriptionError.message}`);
    }

    periodStart = asNonEmptyString(persistedSubscription?.current_period_start);
    periodEnd = asNonEmptyString(persistedSubscription?.current_period_end);
    periodSource = "user_subscriptions";
  }

  if (!periodStart || !periodEnd) {
    throw new Error(`allocateMonthlyCredits_missing_subscription_period:${invoiceId}`);
  }

  const { data, error } = await supabase.rpc("allocate_monthly_user_credits_for_invoice", {
    p_stripe_invoice_id: invoiceId,
    p_stripe_subscription_id: subscriptionId,
    p_billing_period_start: periodStart,
    p_billing_period_end: periodEnd,
    p_metadata: {
      source: "stripe_webhook",
      stripe_event_source: "invoice_payment",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      invoice_amount_paid: amountPaid,
      period_source: periodSource,
    },
  });

  if (error) {
    // RULE 2: Distinguish transient vs permanent failures
    const isTransientUserMappingError = error.message?.includes("user_subscription_not_found");

    if (isTransientUserMappingError) {
      // Log as TRANSIENT — Stripe MUST retry
      console.warn("[allocateMonthlyCredits] ⚠️  TRANSIENT: User subscription not found — Stripe will retry", {
        invoiceId,
        subscriptionId,
        customerId,
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Log other RPC errors for investigation
      console.error("[allocateMonthlyCredits] RPC error (non-transient)", {
        invoiceId,
        subscriptionId,
        customerId,
        code: error.code,
        message: error.message,
        details: error.details,
        timestamp: new Date().toISOString(),
      });
    }

    // RULE 2: ALWAYS throw — ensures Stripe retries and prevents permanent credit loss
    throw new Error(`allocate_monthly_user_credits_for_invoice failed: ${error.message}`);
  }

  const payload = (data ?? {}) as {
    status?: string;
    allocated_credits?: number;
    previous_balance?: number;
    new_balance?: number;
    existing_status?: string;
    requested_stripe_invoice_id?: string;
    stripe_invoice_id?: string;
  };

  // RULE 3: Log all RPC outcomes for forensics
  console.log("[allocateMonthlyCredits] RPC result", {
    invoiceId,
    subscriptionId,
    customerId,
    status: payload.status,
    allocatedCredits: payload.allocated_credits ?? 0,
    previousBalance: payload.previous_balance ?? null,
    newBalance: payload.new_balance ?? null,
    timestamp: new Date().toISOString(),
  });

  if (payload.status === "processed") {
    console.log("[allocateMonthlyCredits] ✅ PROCESSED", {
      invoiceId,
      allocatedCredits: payload.allocated_credits ?? 0,
      newBalance: payload.new_balance ?? null,
    });
    return;
  }

  if (payload.status === "skipped_max_balance") {
    console.log("[allocateMonthlyCredits] ⏭️  SKIPPED (max balance)", {
      invoiceId,
      newBalance: payload.new_balance ?? null,
    });
    return;
  }

  if (payload.status === "duplicate" || payload.status === "duplicate_invoice") {
    console.log("[allocateMonthlyCredits] ⏭️  SKIPPED (duplicate invoice)", {
      invoiceId,
    });
    return;
  }

  if (payload.status === "duplicate_period") {
    console.log("[allocateMonthlyCredits] ⏭️  SKIPPED (duplicate billing period)", {
      invoiceId,
      existingInvoiceId: payload.stripe_invoice_id ?? null,
      existingStatus: payload.existing_status ?? null,
      subscriptionId,
    });
    return;
  }

  if (payload.status === "skipped_inactive_subscription") {
    console.log("[allocateMonthlyCredits] ⏭️  SKIPPED (subscription inactive)", {
      invoiceId,
      subscriptionId,
    });
    await logStripeWebhookMonitoringAlert(supabase, {
      eventType: "stripe_credit_allocation_skipped_inactive_subscription",
      severity: "warning",
      entityType: "stripe_subscription",
      details: {
        stripe_invoice_id: invoiceId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        stripe_subscription_status: stripeSubscription.status,
      },
    });
    return;
  }

  console.warn("[allocateMonthlyCredits] ⚠️  Unexpected status from RPC", {
    invoiceId,
    subscriptionId,
    status: payload.status,
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
    stripe,
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
    stripe,
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
    stripe: Stripe;
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
    stripe,
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

  let profile = await resolveProfileForStripeCustomer<{
    id: string;
    stripe_customer_id: string | null;
  }>(supabase, stripe, {
    customerId,
    subscriptionId,
    userId,
    selectClause: "id, stripe_customer_id",
    logContext: "upsertUserSubscription",
  });

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

  const profileUpdates: Record<string, unknown> = {
    stripe_subscription_id: subscriptionId,
    subscription_status: status,
  };

  if (!profile.stripe_customer_id) {
    profileUpdates.stripe_customer_id = customerId;
  }

  const { error: profileUpdateError } = await supabase
    .from("user_profiles")
    .update(profileUpdates)
    .eq("id", profile.id);

  if (profileUpdateError) {
    throw new Error(`Failed to update user profile with user subscription identifiers: ${profileUpdateError.message}`);
  }
}

async function upsertProducerSubscription(
  supabase: ReturnType<typeof createClient>,
  params: {
    stripe: Stripe;
    customerId: string;
    subscriptionId: string;
    status: string;
    currentPeriodEnd?: number | string;
    cancelAtPeriodEnd?: boolean;
    userId?: string;
    priceIds?: string[];
  },
) {
  const { stripe, customerId, subscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd, userId, priceIds = [] } = params;

  let profile = await resolveProfileForStripeCustomer<{
    id: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    producer_tier: ProducerTier | null;
    role: string | null;
  }>(supabase, stripe, {
    customerId,
    subscriptionId,
    userId,
    selectClause: "id, stripe_customer_id, stripe_subscription_id, producer_tier, role",
    logContext: "upsertProducerSubscription",
  });

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

  const currentTier = asProducerTier((profile as { producer_tier?: unknown })?.producer_tier ?? null);
  const tierResolution = await resolveProducerTierFromSubscription(supabase, {
    isActive,
    priceIds,
    currentTier,
    subscriptionId,
    userId: profile.id,
  });
  const nextTier = tierResolution.tier;

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

  // Écriture unique dans producer_subscriptions.
  // Le trigger trg_sync_user_profile_producer prend en charge la mise à jour atomique
  // de user_profiles (role, producer_tier, is_producer_active, stripe_subscription_id).
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
      producer_tier: nextTier,
    }, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to upsert producer_subscriptions: ${error.message}`);
  }
}
