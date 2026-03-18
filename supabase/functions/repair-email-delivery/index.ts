import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PIPELINE_RECLAIM_AFTER_SECONDS } from "../_shared/eventPipelineConfig.ts";
import {
  isEmailTemplate,
  isUniqueEmailTemplate,
  type EmailTemplate,
} from "../_shared/emailTemplates.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

const DEFAULT_SCAN_LIMIT = 200;
const MAX_SCAN_LIMIT = 500;
const MISSING_EMAIL_GRACE_SECONDS = 60;
const MAX_ERROR_LENGTH = 500;

type EventType =
  | "USER_SIGNUP"
  | "USER_CONFIRMED"
  | "PRODUCER_ACTIVATED"
  | "BEAT_PURCHASED"
  | "LICENSE_GENERATED"
  | "BATTLE_WON"
  | "COMMENT_RECEIVED";

type EventOutboxRow = {
  id: string;
  event_id: string | null;
  event_type: EventType;
  aggregate_type: string | null;
  aggregate_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  source_table: string | null;
  source_record_id: string | null;
  status: "pending" | "processing" | "processed" | "failed";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
  replayed_from_event_id: string | null;
  replay_reason: string | null;
};

type EventBusRow = {
  id: string;
  source_outbox_id: string | null;
  status: "pending" | "processing" | "processed" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
};

type EmailQueueRow = {
  id: string;
  source_event_id: string | null;
  source_outbox_id: string | null;
  user_id: string | null;
  email: string;
  template: string;
  payload: Record<string, unknown> | null;
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
  created_at: string;
  processed_at: string | null;
  locked_at: string | null;
  last_error: string | null;
  repair_count: number;
  last_repair_at: string | null;
  repair_reason: string | null;
};

type EventHandlerRow = {
  event_type: EventType;
  handler_type: "email";
  handler_key: string;
  is_active: boolean;
};

type SupabaseAdminClient = any;

type RepairStrategy = "auto" | "requeue" | "recreate" | "replay";

type OutboxCandidate = {
  outbox: EventOutboxRow;
  template: EmailTemplate;
  sourceEventId: string | null;
  sourceOutboxId: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVENT_TYPES = new Set<EventType>([
  "USER_SIGNUP",
  "USER_CONFIRMED",
  "PRODUCER_ACTIVATED",
  "BEAT_PURCHASED",
  "LICENSE_GENERATED",
  "BATTLE_WON",
  "COMMENT_RECEIVED",
]);

const DEFAULT_EVENT_TEMPLATE_MAP: Record<EventType, EmailTemplate> = {
  USER_SIGNUP: "confirm_account",
  USER_CONFIRMED: "welcome_user",
  PRODUCER_ACTIVATED: "producer_activation",
  BEAT_PURCHASED: "purchase_receipt",
  LICENSE_GENERATED: "license_ready",
  BATTLE_WON: "battle_won",
  COMMENT_RECEIVED: "comment_received",
};

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

const asUuid = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text || !UUID_RE.test(text)) return null;
  return text;
};

const normalizeEmail = (value: unknown) => {
  const text = asNonEmptyString(value);
  return text ? text.toLowerCase() : null;
};

const parseIsoDate = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "INVALID";
  return parsed.toISOString();
};

const resolveScanLimit = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SCAN_LIMIT;
  }
  const normalized = Math.trunc(value);
  return Math.max(1, Math.min(normalized, MAX_SCAN_LIMIT));
};

const resolveStrategy = (value: unknown): RepairStrategy | null => {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (!normalized) return "auto";
  if (normalized === "auto") return "auto";
  if (normalized === "requeue") return "requeue";
  if (normalized === "recreate") return "recreate";
  if (normalized === "replay") return "replay";
  return null;
};

const trimError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, MAX_ERROR_LENGTH);
};

const isUniqueViolation = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === "23505";
};

const isEventType = (value: unknown): value is EventType =>
  typeof value === "string" && EVENT_TYPES.has(value as EventType);

const jsonResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });

const REPAIR_EMAIL_DELIVERY_RATE_LIMIT_RPC = "repair_email_delivery";

const timingSafeEqual = (a: string, b: string): boolean => {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
};

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

const loadEventTemplateMap = async (supabaseAdmin: SupabaseAdminClient) => {
  const { data, error } = await supabaseAdmin
    .from("event_handlers")
    .select("event_type, handler_type, handler_key, is_active")
    .eq("handler_type", "email")
    .eq("is_active", true);

  if (error) {
    throw new Error(`event_handlers_load_failed:${error.message}`);
  }

  const handlers = (data as EventHandlerRow[] | null) ?? [];
  const mapping = new Map<EventType, EmailTemplate>();

  for (const handler of handlers) {
    if (!isEventType(handler.event_type)) continue;
    if (!isEmailTemplate(handler.handler_key)) continue;
    if (!mapping.has(handler.event_type)) {
      mapping.set(handler.event_type, handler.handler_key);
    }
  }

  if (mapping.size === 0) {
    for (const [eventType, template] of Object.entries(DEFAULT_EVENT_TEMPLATE_MAP)) {
      mapping.set(eventType as EventType, template);
    }
  }

  return mapping;
};

const resolveEmailForOutbox = async (
  supabaseAdmin: SupabaseAdminClient,
  outbox: EventOutboxRow,
  cache: Map<string, string | null>,
) => {
  const payloadEmail = normalizeEmail(outbox.payload?.email);
  if (payloadEmail) return payloadEmail;

  const payloadRecipient = normalizeEmail(outbox.payload?.recipient_email);
  if (payloadRecipient) return payloadRecipient;

  const userId = asNonEmptyString(outbox.user_id);
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
    cache.set(userId, null);
    return null;
  }

  const resolved = normalizeEmail((data as { email?: string | null } | null)?.email ?? null);
  cache.set(userId, resolved);
  return resolved;
};

serveWithErrorHandling("repair-email-delivery", async (req: Request) => {
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
  const serviceRoleKey = asNonEmptyString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const emailRepairSecret = asNonEmptyString(Deno.env.get("EMAIL_REPAIR_SECRET"));
  if (!supabaseUrl || !serviceRoleKey || !emailRepairSecret) {
    return jsonResponse(500, { error: "Missing server configuration" });
  }

  const providedSecret = asNonEmptyString(req.headers.get("x-email-repair-secret"));
  if (!providedSecret || !timingSafeEqual(providedSecret, emailRepairSecret)) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const body = parsed.body;
  const execute = body.execute === true;
  const dryRun = !execute;
  const scanLimit = resolveScanLimit(body.limit);

  const strategy = resolveStrategy(body.strategy);
  if (!strategy) {
    return jsonResponse(400, { error: "Invalid strategy" });
  }

  const eventTypeFilterRaw = asNonEmptyString(body.event_type)?.toUpperCase() ?? null;
  const eventTypeFilter = eventTypeFilterRaw && isEventType(eventTypeFilterRaw)
    ? eventTypeFilterRaw as EventType
    : null;
  if (eventTypeFilterRaw && !eventTypeFilter) {
    return jsonResponse(400, { error: "Invalid event_type" });
  }

  const userIdFilter = body.user_id === undefined ? null : asUuid(body.user_id);
  if (body.user_id !== undefined && !userIdFilter) {
    return jsonResponse(400, { error: "Invalid user_id" });
  }

  const aggregateIdFilter = body.aggregate_id === undefined ? null : asUuid(body.aggregate_id);
  if (body.aggregate_id !== undefined && !aggregateIdFilter) {
    return jsonResponse(400, { error: "Invalid aggregate_id" });
  }

  const sourceEventIdFilter = body.source_event_id === undefined ? null : asUuid(body.source_event_id);
  if (body.source_event_id !== undefined && !sourceEventIdFilter) {
    return jsonResponse(400, { error: "Invalid source_event_id" });
  }

  const sourceOutboxIdFilter = body.source_outbox_id === undefined ? null : asUuid(body.source_outbox_id);
  if (body.source_outbox_id !== undefined && !sourceOutboxIdFilter) {
    return jsonResponse(400, { error: "Invalid source_outbox_id" });
  }

  const fromDateFilter = body.from_date === undefined ? null : parseIsoDate(body.from_date);
  if (fromDateFilter === "INVALID") {
    return jsonResponse(400, { error: "Invalid from_date" });
  }

  const toDateFilter = body.to_date === undefined ? null : parseIsoDate(body.to_date);
  if (toDateFilter === "INVALID") {
    return jsonResponse(400, { error: "Invalid to_date" });
  }

  if (fromDateFilter && toDateFilter && new Date(fromDateFilter).getTime() > new Date(toDateFilter).getTime()) {
    return jsonResponse(400, { error: "from_date must be before to_date" });
  }

  const reason = asNonEmptyString(body.reason) ?? "repair-email-delivery";

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseAdminClient;

  const { data: rateLimitAllowed, error: rateLimitError } = await supabaseAdmin.rpc(
    "check_rpc_rate_limit",
    {
      p_user_id: null,
      p_rpc_name: REPAIR_EMAIL_DELIVERY_RATE_LIMIT_RPC,
    },
  );

  if (rateLimitError) {
    console.error("[repair-email-delivery] rate limit check failed", { rateLimitError });
    return jsonResponse(500, { error: "Rate limit unavailable" });
  }

  if (!rateLimitAllowed) {
    return jsonResponse(429, { error: "Too many requests" });
  }

  const repairRunId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  try {
    const templateMap = await loadEventTemplateMap(supabaseAdmin);
    const graceThreshold = new Date(Date.now() - MISSING_EMAIL_GRACE_SECONDS * 1000).toISOString();

    let outboxQuery = supabaseAdmin
      .from("event_outbox")
      .select("id,event_id,event_type,aggregate_type,aggregate_id,user_id,payload,source_table,source_record_id,status,attempts,max_attempts,last_error,created_at,processed_at,replayed_from_event_id,replay_reason")
      .eq("status", "processed")
      .order("created_at", { ascending: false })
      .limit(scanLimit);

    if (!sourceEventIdFilter) {
      outboxQuery = outboxQuery.lte("created_at", graceThreshold);
    }

    if (eventTypeFilter) {
      outboxQuery = outboxQuery.eq("event_type", eventTypeFilter);
    }

    if (userIdFilter) {
      outboxQuery = outboxQuery.eq("user_id", userIdFilter);
    }

    if (aggregateIdFilter) {
      outboxQuery = outboxQuery.eq("aggregate_id", aggregateIdFilter);
    }

    if (fromDateFilter) {
      outboxQuery = outboxQuery.gte("created_at", fromDateFilter);
    }

    if (toDateFilter) {
      outboxQuery = outboxQuery.lte("created_at", toDateFilter);
    }

    if (sourceEventIdFilter) {
      outboxQuery = outboxQuery.eq("event_id", sourceEventIdFilter);
    }

    if (sourceOutboxIdFilter) {
      outboxQuery = outboxQuery.eq("id", sourceOutboxIdFilter);
    }

    const { data: outboxData, error: outboxError } = await outboxQuery;
    if (outboxError) {
      throw new Error(`outbox_query_failed:${outboxError.message}`);
    }

    const outboxRows: EventOutboxRow[] = (outboxData as EventOutboxRow[] | null) ?? [];

    if (sourceEventIdFilter && outboxRows.length === 0) {
      const { data: fallbackBus, error: fallbackBusError } = await supabaseAdmin
        .from("event_bus")
        .select("id,source_outbox_id,status,attempts,last_error,created_at,processed_at")
        .eq("id", sourceEventIdFilter)
        .maybeSingle();

      if (fallbackBusError) {
        throw new Error(`fallback_bus_query_failed:${fallbackBusError.message}`);
      }

      const fallbackOutboxId = asUuid((fallbackBus as EventBusRow | null)?.source_outbox_id ?? null);
      if (fallbackOutboxId) {
        const { data: fallbackOutbox, error: fallbackOutboxError } = await supabaseAdmin
          .from("event_outbox")
          .select("id,event_id,event_type,aggregate_type,aggregate_id,user_id,payload,source_table,source_record_id,status,attempts,max_attempts,last_error,created_at,processed_at,replayed_from_event_id,replay_reason")
          .eq("id", fallbackOutboxId)
          .eq("status", "processed")
          .maybeSingle();

        if (fallbackOutboxError) {
          throw new Error(`fallback_outbox_query_failed:${fallbackOutboxError.message}`);
        }

        if (fallbackOutbox) {
          outboxRows.push(fallbackOutbox as EventOutboxRow);
        }
      }
    }

    const outboxIds = outboxRows.map((row) => row.id);

    let busRows: EventBusRow[] = [];
    if (outboxIds.length > 0) {
      const { data: busData, error: busError } = await supabaseAdmin
        .from("event_bus")
        .select("id,source_outbox_id,status,attempts,last_error,created_at,processed_at")
        .in("source_outbox_id", outboxIds);

      if (busError) {
        throw new Error(`event_bus_query_failed:${busError.message}`);
      }

      busRows = (busData as EventBusRow[] | null) ?? [];
    }

    const busByOutboxId = new Map<string, EventBusRow>();
    for (const row of busRows) {
      const sourceOutboxId = asUuid(row.source_outbox_id);
      if (sourceOutboxId && !busByOutboxId.has(sourceOutboxId)) {
        busByOutboxId.set(sourceOutboxId, row);
      }
    }

    let backfilledOutboxEventIds = 0;
    const candidates: OutboxCandidate[] = [];

    for (const outbox of outboxRows) {
      const template = templateMap.get(outbox.event_type);
      if (!template) {
        continue;
      }

      const linkedBus = busByOutboxId.get(outbox.id) ?? null;
      let sourceEventId = asUuid(outbox.event_id) ?? asUuid(linkedBus?.id ?? null);

      if (execute && !asUuid(outbox.event_id) && sourceEventId) {
        const { error: backfillError } = await supabaseAdmin
          .from("event_outbox")
          .update({ event_id: sourceEventId })
          .eq("id", outbox.id)
          .is("event_id", null);

        if (backfillError) {
          console.error("[repair-email-delivery] outbox event_id backfill failed", {
            outboxId: outbox.id,
            backfillError,
          });
        } else {
          backfilledOutboxEventIds += 1;
        }
      }

      candidates.push({
        outbox,
        template,
        sourceEventId,
        sourceOutboxId: outbox.id,
      });
    }

    const sourceOutboxIds = Array.from(new Set(
      candidates
        .map((candidate) => candidate.sourceOutboxId)
        .filter((value): value is string => Boolean(value)),
    ));

    const sourceEventIds = Array.from(new Set(
      candidates
        .map((candidate) => candidate.sourceEventId)
        .filter((value): value is string => Boolean(value)),
    ));

    let queueRowsByOutbox: EmailQueueRow[] = [];
    if (sourceOutboxIds.length > 0) {
      const { data: queueDataByOutbox, error: queueByOutboxError } = await supabaseAdmin
        .from("email_queue")
        .select("id,source_event_id,source_outbox_id,user_id,email,template,payload,status,attempts,max_attempts,created_at,processed_at,locked_at,last_error,repair_count,last_repair_at,repair_reason")
        .in("source_outbox_id", sourceOutboxIds);

      if (queueByOutboxError) {
        throw new Error(`email_queue_by_outbox_query_failed:${queueByOutboxError.message}`);
      }

      queueRowsByOutbox = (queueDataByOutbox as EmailQueueRow[] | null) ?? [];
    }

    let queueRowsByEvent: EmailQueueRow[] = [];
    if (sourceEventIds.length > 0) {
      const { data: queueDataByEvent, error: queueByEventError } = await supabaseAdmin
        .from("email_queue")
        .select("id,source_event_id,source_outbox_id,user_id,email,template,payload,status,attempts,max_attempts,created_at,processed_at,locked_at,last_error,repair_count,last_repair_at,repair_reason")
        .in("source_event_id", sourceEventIds);

      if (queueByEventError) {
        throw new Error(`email_queue_by_event_query_failed:${queueByEventError.message}`);
      }

      queueRowsByEvent = (queueDataByEvent as EmailQueueRow[] | null) ?? [];
    }

    const queueRows = Array.from(
      new Map([...queueRowsByOutbox, ...queueRowsByEvent].map((row) => [row.id, row])).values(),
    );

    const queueBySourceOutboxId = new Map<string, EmailQueueRow>();
    for (const row of queueRows) {
      const sourceOutboxId = asUuid(row.source_outbox_id);
      if (sourceOutboxId && !queueBySourceOutboxId.has(sourceOutboxId)) {
        queueBySourceOutboxId.set(sourceOutboxId, row);
      }
    }

    const queueBySourceEventId = new Map<string, EmailQueueRow>();
    for (const row of queueRows) {
      const sourceEventId = asUuid(row.source_event_id);
      if (sourceEventId && !queueBySourceEventId.has(sourceEventId)) {
        queueBySourceEventId.set(sourceEventId, row);
      }
    }

    const staleLockThreshold = new Date(Date.now() - PIPELINE_RECLAIM_AFTER_SECONDS * 1000).toISOString();

    const recreateCandidates: OutboxCandidate[] = [];
    const replayCandidates: OutboxCandidate[] = [];
    const failedRows: EmailQueueRow[] = [];
    const staleRows: EmailQueueRow[] = [];

    for (const candidate of candidates) {
      const queueRow = queueBySourceOutboxId.get(candidate.sourceOutboxId)
        ?? (candidate.sourceEventId ? queueBySourceEventId.get(candidate.sourceEventId) : null);

      if (!queueRow) {
        if (strategy === "replay") {
          replayCandidates.push(candidate);
        } else {
          recreateCandidates.push(candidate);
        }
        continue;
      }

      if (queueRow.status === "failed") {
        failedRows.push(queueRow);
        continue;
      }

      if (
        queueRow.status === "processing"
        && queueRow.locked_at
        && queueRow.locked_at <= staleLockThreshold
      ) {
        staleRows.push(queueRow);
      }
    }

    const failedUnique = Array.from(new Map(failedRows.map((row) => [row.id, row])).values());
    const staleUnique = Array.from(new Map(staleRows.map((row) => [row.id, row])).values());

    const diagnostics = {
      outboxProcessed: outboxRows.length,
      outboxWithEventId: candidates.filter((candidate) => Boolean(candidate.sourceEventId)).length,
      outboxWithoutEventId: candidates.filter((candidate) => !candidate.sourceEventId).length,
      eventBusLinkedRows: busRows.length,
      eventBusFailedRows: busRows.filter((row) => row.status === "failed").length,
      queueRowsObserved: queueRows.length,
    };

    let recreatedEmails = 0;
    let replayedOutboxEvents = 0;
    let requeuedFailed = 0;
    let unlockedStale = 0;
    const errors: string[] = [];
    const emailCache = new Map<string, string | null>();

    const allowRequeue = execute && (strategy === "auto" || strategy === "requeue");
    const allowRecreate = execute && (strategy === "auto" || strategy === "recreate");
    const allowReplay = execute && (strategy === "auto" || strategy === "replay");

    if (allowRecreate) {
      for (const candidate of recreateCandidates) {
        const recipientEmail = await resolveEmailForOutbox(supabaseAdmin, candidate.outbox, emailCache);
        if (!recipientEmail) {
          errors.push(`missing_recipient_email:${candidate.outbox.id}`);
          continue;
        }

        const queuePayload = {
          ...(asJsonObject(candidate.outbox.payload) ?? {}),
          outbox_id: candidate.outbox.id,
          event_id: candidate.sourceEventId,
          event_type: candidate.outbox.event_type,
          event_created_at: candidate.outbox.created_at,
          aggregate_type: candidate.outbox.aggregate_type,
          aggregate_id: candidate.outbox.aggregate_id,
          user_id: candidate.outbox.user_id,
          repair: {
            run_id: repairRunId,
            action: "recreate_missing_queue",
            repaired_at: nowIso,
          },
        };

        const queueUserId = isUniqueEmailTemplate(candidate.template)
          ? candidate.outbox.user_id
          : null;

        const { error: queueInsertError } = await supabaseAdmin
          .from("email_queue")
          .upsert(
            {
              source_event_id: candidate.sourceEventId,
              source_outbox_id: candidate.sourceOutboxId,
              user_id: queueUserId,
              email: recipientEmail,
              template: candidate.template,
              payload: queuePayload,
              status: "pending",
              repair_count: 1,
              last_repair_at: nowIso,
              repair_reason: "recreate_missing_queue",
            },
            {
              onConflict: "source_outbox_id",
              ignoreDuplicates: true,
            },
          );

        if (queueInsertError) {
          errors.push(`queue_recreate_failed:${candidate.outbox.id}`);
          console.error("[repair-email-delivery] queue recreate failed", {
            outboxId: candidate.outbox.id,
            queueInsertError,
          });
          continue;
        }

        recreatedEmails += 1;
      }
    }

    if (allowRequeue) {
      for (const failedRow of failedUnique) {
        const { error: requeueError } = await supabaseAdmin
          .from("email_queue")
          .update({
            status: "pending",
            attempts: 0,
            processed_at: null,
            locked_at: null,
            last_error: null,
            repair_count: (failedRow.repair_count ?? 0) + 1,
            last_repair_at: nowIso,
            repair_reason: "requeue_failed",
          })
          .eq("id", failedRow.id)
          .eq("status", "failed");

        if (requeueError) {
          errors.push(`failed_requeue_error:${failedRow.id}`);
          console.error("[repair-email-delivery] failed email requeue error", {
            queueId: failedRow.id,
            requeueError,
          });
          continue;
        }

        requeuedFailed += 1;
      }

      for (const staleRow of staleUnique) {
        const { error: unlockError } = await supabaseAdmin
          .from("email_queue")
          .update({
            status: "pending",
            locked_at: null,
            last_error: null,
            repair_count: (staleRow.repair_count ?? 0) + 1,
            last_repair_at: nowIso,
            repair_reason: "unlock_stale_processing",
          })
          .eq("id", staleRow.id)
          .eq("status", "processing");

        if (unlockError) {
          errors.push(`stale_unlock_error:${staleRow.id}`);
          console.error("[repair-email-delivery] stale email unlock error", {
            queueId: staleRow.id,
            unlockError,
          });
          continue;
        }

        unlockedStale += 1;
      }
    }

    if (allowReplay) {
      for (const candidate of replayCandidates) {
        const replayDedupeKey = `repair-replay:${repairRunId}:${candidate.outbox.id}`;
        const replayPayload = {
          ...(asJsonObject(candidate.outbox.payload) ?? {}),
          repair: {
            run_id: repairRunId,
            action: "replay_outbox",
            repaired_at: nowIso,
          },
        };

        const { error: replayInsertError } = await supabaseAdmin
          .from("event_outbox")
          .insert({
            event_type: candidate.outbox.event_type,
            aggregate_type: candidate.outbox.aggregate_type,
            aggregate_id: candidate.outbox.aggregate_id,
            user_id: candidate.outbox.user_id,
            payload: replayPayload,
            source_table: candidate.outbox.source_table ?? "repair-email-delivery",
            source_record_id: candidate.outbox.source_record_id,
            dedupe_key: replayDedupeKey,
            status: "pending",
            attempts: 0,
            max_attempts: candidate.outbox.max_attempts,
            replayed_from_event_id: candidate.outbox.id,
            replay_reason: reason,
          });

        if (!replayInsertError) {
          replayedOutboxEvents += 1;
          continue;
        }

        if (isUniqueViolation(replayInsertError)) {
          continue;
        }

        errors.push(`replay_insert_failed:${candidate.outbox.id}`);
        console.error("[repair-email-delivery] replay insert failed", {
          outboxId: candidate.outbox.id,
          replayInsertError,
        });
      }
    }

    return jsonResponse(200, {
      dryRun,
      execute,
      strategy,
      filters: {
        event_type: eventTypeFilter,
        user_id: userIdFilter,
        aggregate_id: aggregateIdFilter,
        source_event_id: sourceEventIdFilter,
        source_outbox_id: sourceOutboxIdFilter,
        from_date: fromDateFilter,
        to_date: toDateFilter,
        limit: scanLimit,
      },
      diagnostics,
      candidates: {
        recreateMissingQueue: recreateCandidates.length,
        requeueFailed: failedUnique.length,
        unlockStaleProcessing: staleUnique.length,
        replayOutbox: replayCandidates.length,
      },
      executed: {
        recreatedEmails,
        requeuedFailed,
        unlockedStale,
        replayedOutboxEvents,
        backfilledOutboxEventIds,
      },
      errors: execute ? errors.slice(0, 100) : [],
      repairRunId,
    });
  } catch (error) {
    const safeError = trimError(error);
    console.error("[repair-email-delivery] fatal error", safeError);
    return jsonResponse(500, { error: "Unable to repair email delivery" });
  }
});
