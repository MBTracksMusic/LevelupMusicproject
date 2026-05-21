import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PIPELINE_ACTIVE_RUN_WINDOW_SECONDS,
  PIPELINE_RECLAIM_AFTER_SECONDS,
} from "../_shared/eventPipelineConfig.ts";
import {
  isEmailTemplate,
  isUniqueEmailTemplate,
  type EmailTemplate,
} from "../_shared/emailTemplates.ts";
import { safeInsertPipelineMetrics } from "../_shared/pipelineMetrics.ts";
import {
  safeEmitPipelineRunAlerts,
  safeRecordPipelineRunEvent,
} from "../_shared/pipelineRunMonitoring.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

const MAX_BATCH_SIZE = 50;
const MAX_ERROR_LENGTH = 500;

type EventType =
  | "USER_SIGNUP"
  | "USER_CONFIRMED"
  | "PRODUCER_ACTIVATED"
  | "BEAT_PURCHASED"
  | "LICENSE_GENERATED"
  | "BATTLE_WON"
  | "BATTLE_INVITATION"
  | "COMMENT_RECEIVED";

type EventHandler = {
  event_type: EventType;
  handler_type: "email";
  handler_key: string;
  config: Record<string, unknown> | null;
  is_active: boolean;
};

type EventBusRow = {
  id: string;
  event_type: EventType;
  aggregate_type: string | null;
  aggregate_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  status: "pending" | "processing" | "processed" | "failed";
  attempts: number;
  max_attempts: number;
  created_at: string;
  processed_at: string | null;
  locked_at: string | null;
  last_error: string | null;
};

type SupabaseAdminClient = any;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asNonEmptyString = (value: unknown) => {
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

const normalizeEmail = (value: unknown) => {
  const email = asNonEmptyString(value);
  if (!email) return null;
  return email.toLowerCase();
};

const asUuid = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text || !UUID_RE.test(text)) return null;
  return text;
};

const trimError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, MAX_ERROR_LENGTH);
};

const toTemplate = (value: string): EmailTemplate | null =>
  isEmailTemplate(value) ? value : null;

const jsonResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });

const parseRequestBody = async (req: Request) => {
  const rawBody = await req.text();
  if (rawBody.trim() === "") {
    return { ok: true as const, body: {} as Record<string, unknown> };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {
      ok: false as const,
      response: jsonResponse(400, { error: "Invalid JSON payload" }),
    };
  }

  const body = asJsonObject(parsed);
  if (!body) {
    return {
      ok: false as const,
      response: jsonResponse(400, { error: "JSON payload must be an object" }),
    };
  }

  return { ok: true as const, body };
};

const resolveEmailForEvent = async (
  supabaseAdmin: SupabaseAdminClient,
  event: EventBusRow,
  cache: Map<string, string | null>,
) => {
  const payloadEmail = normalizeEmail(event.payload?.email);
  if (payloadEmail) return payloadEmail;

  const payloadRecipient = normalizeEmail(event.payload?.recipient_email);
  if (payloadRecipient) return payloadRecipient;

  const userId = asNonEmptyString(event.user_id);
  if (!userId) return null;

  if (cache.has(userId)) {
    return cache.get(userId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`resolve_email_from_profile_failed:${error.message}`);
  }

  const resolved = normalizeEmail((data as { email?: string | null } | null)?.email ?? null);
  cache.set(userId, resolved);
  return resolved;
};

const enqueueEmailFromEvent = async (
  supabaseAdmin: SupabaseAdminClient,
  event: EventBusRow,
  template: EmailTemplate,
  recipientEmail: string,
) => {
  const sourceOutboxId = asUuid(event.payload?.outbox_id);
  const queuePayload = {
    ...(event.payload ?? {}),
    event_id: event.id,
    event_type: event.event_type,
    event_created_at: event.created_at,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    user_id: event.user_id,
  };

  const queueUserId = isUniqueEmailTemplate(template)
    ? event.user_id
    : null;

  const { error } = await supabaseAdmin
    .from("email_queue")
    .upsert(
      {
        source_event_id: event.id,
        source_outbox_id: sourceOutboxId,
        user_id: queueUserId,
        email: recipientEmail,
        template,
        payload: queuePayload,
        status: "pending",
      },
      {
        onConflict: "source_event_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    throw new Error(`email_queue_upsert_failed:${error.message}`);
  }
};

serveWithErrorHandling("process-events", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const parsed = await parseRequestBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }

  const supabaseUrl = asNonEmptyString(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = asNonEmptyString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ??
    asNonEmptyString(Deno.env.get("SERVICE_ROLE_KEY"));
  const internalPipelineSecret = asNonEmptyString(Deno.env.get("INTERNAL_PIPELINE_SECRET"));
  if (!supabaseUrl || !serviceRoleKey || !internalPipelineSecret) {
    return jsonResponse(500, { error: "Missing server configuration" });
  }

  const providedInternalSecret = asNonEmptyString(req.headers.get("x-internal-secret"));
  if (!providedInternalSecret || providedInternalSecret !== internalPipelineSecret) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseAdminClient;
  const runId = crypto.randomUUID();
  const runStartedAtMs = Date.now();
  await safeRecordPipelineRunEvent(supabaseAdmin, {
    component: "process-events",
    runId,
    status: "start",
    labels: {
      mode: "compatibility",
    },
  });

  const finalizeRun = async (params: {
    status: "success" | "failure";
    processedCount: number;
    errorCount: number;
    extraLabels?: Record<string, unknown>;
    skipZeroProcessedAlert?: boolean;
  }) => {
    const durationMs = Date.now() - runStartedAtMs;
    await safeRecordPipelineRunEvent(supabaseAdmin, {
      component: "process-events",
      runId,
      status: params.status,
      processedCount: params.processedCount,
      errorCount: params.errorCount,
      durationMs,
      labels: {
        mode: "compatibility",
        ...(params.extraLabels ?? {}),
        ...(params.skipZeroProcessedAlert ? { skip_zero_processed_alert: true } : {}),
      },
    });
    await safeEmitPipelineRunAlerts(supabaseAdmin, {
      component: "process-events",
      runId,
      status: params.status,
      processedCount: params.processedCount,
      errorCount: params.errorCount,
      durationMs,
      config: {
        durationThresholdMs: 15_000,
        zeroProcessedConsecutiveRuns: 3,
        skipZeroProcessedAlert: params.skipZeroProcessedAlert === true,
      },
    });
  };

  // Internal rate limit: avoid concurrent workers processing the same queue.
  const activeLockThreshold = new Date(Date.now() - PIPELINE_ACTIVE_RUN_WINDOW_SECONDS * 1000).toISOString();
  const { count: activeProcessingCount, error: activeCountError } = await supabaseAdmin
    .from("event_bus")
    .select("id", { head: true, count: "exact" })
    .eq("status", "processing")
    .gte("locked_at", activeLockThreshold);

  if (activeCountError) {
    await finalizeRun({
      status: "failure",
      processedCount: 0,
      errorCount: 1,
      extraLabels: { reason: "active_lock_query_failed" },
      skipZeroProcessedAlert: true,
    });
    return jsonResponse(500, { error: "Unable to verify event worker state" });
  }

  if ((activeProcessingCount ?? 0) > 0) {
    await finalizeRun({
      status: "success",
      processedCount: 0,
      errorCount: 0,
      extraLabels: { reason: "already_processing" },
      skipZeroProcessedAlert: true,
    });
    return jsonResponse(429, {
      error: "Event worker is already processing",
      activeProcessingCount,
    });
  }

  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc("claim_event_bus_batch", {
    p_limit: MAX_BATCH_SIZE,
    p_reclaim_after_seconds: PIPELINE_RECLAIM_AFTER_SECONDS,
  });

  if (claimError) {
    await finalizeRun({
      status: "failure",
      processedCount: 0,
      errorCount: 1,
      extraLabels: { reason: "claim_batch_failed" },
      skipZeroProcessedAlert: true,
    });
    return jsonResponse(500, { error: "Unable to claim event batch" });
  }

  const events = (claimedRows as EventBusRow[] | null) ?? [];
  if (events.length === 0) {
    const { count: queueBacklogCount, error: queueBacklogError } = await supabaseAdmin
      .from("event_bus")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending");

    if (queueBacklogError) {
      await finalizeRun({
        status: "failure",
        processedCount: 0,
        errorCount: 1,
        extraLabels: { reason: "backlog_query_failed" },
      });
      return jsonResponse(500, { error: "Unable to load event backlog" });
    }

    const metricsInserted = await safeInsertPipelineMetrics(
      supabaseAdmin,
      [
        {
          component: "process-events",
          metricName: "events_processed",
          metricValue: 0,
          labels: { mode: "compatibility" },
        },
        {
          component: "process-events",
          metricName: "events_failed",
          metricValue: 0,
          labels: { mode: "compatibility" },
        },
        {
          component: "process-events",
          metricName: "queue_backlog",
          metricValue: queueBacklogCount ?? 0,
          labels: { queue: "event_bus", status: "pending", mode: "compatibility" },
        },
      ],
      "process-events",
    );

    if (!metricsInserted) {
      await finalizeRun({
        status: "failure",
        processedCount: 0,
        errorCount: 1,
        extraLabels: {
          reason: "metrics_insert_failed",
        },
      });
      return jsonResponse(500, { error: "Unable to write pipeline metrics" });
    }

    await finalizeRun({
      status: "success",
      processedCount: 0,
      errorCount: 0,
      extraLabels: {
        succeeded: 0,
        failed: 0,
        pending_retry: 0,
        enqueued_emails: 0,
      },
    });

    return jsonResponse(200, {
      processed: 0,
      succeeded: 0,
      failed: 0,
      pendingRetry: 0,
      enqueuedEmails: 0,
    });
  }

  const { data: handlersData, error: handlersError } = await supabaseAdmin
    .from("event_handlers")
    .select("event_type, handler_type, handler_key, config, is_active")
    .eq("is_active", true);

  if (handlersError) {
    await finalizeRun({
      status: "failure",
      processedCount: 0,
      errorCount: 1,
      extraLabels: { reason: "handlers_query_failed" },
    });
    return jsonResponse(500, { error: "Unable to load event handlers" });
  }

  const handlers = ((handlersData as EventHandler[] | null) ?? [])
    .filter((row) => row.handler_type === "email" && row.is_active === true);
  const handlersByEvent = new Map<EventType, EventHandler[]>();
  for (const handler of handlers) {
    const list = handlersByEvent.get(handler.event_type) ?? [];
    list.push(handler);
    handlersByEvent.set(handler.event_type, list);
  }

  const emailCache = new Map<string, string | null>();
  let succeeded = 0;
  let failed = 0;
  let pendingRetry = 0;
  let enqueuedEmails = 0;
  let stateUpdateFailures = 0;
  const stageLatenciesMs: number[] = [];

  for (const event of events) {
    console.log("[process-events] processing event", {
      eventId: event.id,
      eventType: event.event_type,
      attempt: event.attempts + 1,
      maxAttempts: event.max_attempts,
    });

    try {
      const currentHandlers = handlersByEvent.get(event.event_type) ?? [];
      const selectedHandler = currentHandlers.find((handler) => toTemplate(handler.handler_key));

      if (selectedHandler) {
        const template = toTemplate(selectedHandler.handler_key);
        if (!template) {
          throw new Error("invalid_handler_template");
        }

        const recipientEmail = await resolveEmailForEvent(supabaseAdmin, event, emailCache);
        if (!recipientEmail) {
          throw new Error("missing_recipient_email");
        }

        await enqueueEmailFromEvent(supabaseAdmin, event, template, recipientEmail);
        enqueuedEmails += 1;
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("event_bus")
        .update({
          status: "processed",
          processed_at: nowIso,
          locked_at: null,
          last_error: null,
        })
        .eq("id", event.id)
        .eq("status", "processing");

      if (updateError) {
        throw new Error(`event_update_processed_failed:${updateError.message}`);
      }

      const latencyMs = Date.now() - new Date(event.created_at).getTime();
      if (Number.isFinite(latencyMs) && latencyMs >= 0) {
        stageLatenciesMs.push(latencyMs);
      }

      succeeded += 1;
    } catch (error) {
      const nextAttempts = event.attempts + 1;
      const nextStatus = nextAttempts >= event.max_attempts ? "failed" : "pending";
      const nowIso = new Date().toISOString();
      const lastError = trimError(error);

      console.error("[process-events] processing failed", {
        eventId: event.id,
        eventType: event.event_type,
        nextStatus,
        lastError,
      });

      const { error: updateError } = await supabaseAdmin
        .from("event_bus")
        .update({
          attempts: nextAttempts,
          status: nextStatus,
          processed_at: nextStatus === "failed" ? nowIso : null,
          locked_at: null,
          last_error: lastError,
        })
        .eq("id", event.id)
        .eq("status", "processing");

      if (updateError) {
        console.error("[process-events] event update failed", {
          eventId: event.id,
          updateError,
        });
        stateUpdateFailures += 1;
      }

      if (nextStatus === "failed") {
        failed += 1;
      } else {
        pendingRetry += 1;
      }
    }
  }

  const avgStageLatencyMs = stageLatenciesMs.length
    ? stageLatenciesMs.reduce((sum, value) => sum + value, 0) / stageLatenciesMs.length
    : 0;

  const { count: queueBacklogCount, error: queueBacklogError } = await supabaseAdmin
    .from("event_bus")
    .select("id", { head: true, count: "exact" })
    .eq("status", "pending");

  if (queueBacklogError) {
    await finalizeRun({
      status: "failure",
      processedCount: events.length,
      errorCount: failed + pendingRetry + stateUpdateFailures + 1,
      extraLabels: { reason: "backlog_query_failed" },
    });
    return jsonResponse(500, { error: "Unable to load event backlog" });
  }

  const metricsInserted = await safeInsertPipelineMetrics(
    supabaseAdmin,
    [
      {
        component: "process-events",
        metricName: "events_processed",
        metricValue: succeeded,
        labels: { mode: "compatibility" },
      },
      {
        component: "process-events",
        metricName: "events_failed",
        metricValue: failed,
        labels: { mode: "compatibility" },
      },
      {
        component: "process-events",
        metricName: "pipeline_latency_ms",
        metricValue: avgStageLatencyMs,
        labels: { stage: "event_bus_processing", mode: "compatibility" },
      },
      {
        component: "process-events",
        metricName: "queue_backlog",
        metricValue: queueBacklogCount ?? 0,
        labels: { queue: "event_bus", status: "pending", mode: "compatibility" },
      },
    ],
    "process-events",
  );

  if (!metricsInserted) {
    await finalizeRun({
      status: "failure",
      processedCount: events.length,
      errorCount: failed + pendingRetry + stateUpdateFailures + 1,
      extraLabels: {
        reason: "metrics_insert_failed",
      },
    });
    return jsonResponse(500, { error: "Unable to write pipeline metrics" });
  }

  const runErrorCount = failed + pendingRetry + stateUpdateFailures;
  await finalizeRun({
    status: runErrorCount > 0 ? "failure" : "success",
    processedCount: events.length,
    errorCount: runErrorCount,
    extraLabels: {
      succeeded,
      failed,
      pending_retry: pendingRetry,
      enqueued_emails: enqueuedEmails,
      state_update_failures: stateUpdateFailures,
    },
  });

  return jsonResponse(200, {
    processed: events.length,
    succeeded,
    failed,
    pendingRetry,
    enqueuedEmails,
  });
});
