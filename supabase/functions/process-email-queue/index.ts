import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
import {
  PIPELINE_ACTIVE_RUN_WINDOW_SECONDS,
  PIPELINE_RECLAIM_AFTER_SECONDS,
} from "../_shared/eventPipelineConfig.ts";
import {
  isEmailTemplate,
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

const MAX_BATCH_SIZE = 20;
const MAX_ERROR_LENGTH = 500;

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
};

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

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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

const isValidHttpUrl = (value: string | null) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const resolvePublicAppUrl = (...candidates: Array<string | null | undefined>) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.trim().replace(/\/$/, "");
    if (isValidHttpUrl(normalized)) {
      return normalized;
    }
  }
  return "https://beatelion.com";
};

type TemplateContent = {
  subject: string;
  html: string;
  text: string;
};

const buildBrandedEmailContent = (params: {
  appUrl: string;
  title: string;
  preheader?: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string | null;
  metaLines?: string[];
}) => {
  const safeAppUrl = params.appUrl.replace(/\/$/, "");
  const homeUrl = `${safeAppUrl}/`;
  const logoUrl = `${safeAppUrl}/beatelion-logo.png`;
  const safePreheader = escapeHtml(params.preheader ?? params.bodyLines[0] ?? "BeatElion");
  const safeCtaUrl = params.ctaUrl && isValidHttpUrl(params.ctaUrl) ? params.ctaUrl : null;

  const bodyHtml = params.bodyLines
    .map((line) => `<p style="margin:0 0 14px;line-height:1.55;color:#111827;">${escapeHtml(line)}</p>`)
    .join("");

  const metaHtml = (params.metaLines ?? [])
    .map((line) => `<p style="margin:0 0 10px;line-height:1.5;color:#4b5563;font-size:13px;">${escapeHtml(line)}</p>`)
    .join("");

  const ctaHtml = safeCtaUrl && params.ctaLabel
    ? `
      <p style="margin:0 0 18px;">
        <a href="${escapeHtml(safeCtaUrl)}" style="display:inline-block;background:#ef4444;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
          ${escapeHtml(params.ctaLabel)}
        </a>
      </p>
    `
    : "";

  const html = `
    <div lang="fr" style="margin:0;padding:20px 12px;background:#f4f4f5;">
      <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#ffffff;opacity:0;mso-hide:all;">
        ${safePreheader}
      </div>
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
        <div style="padding:20px 24px 8px;background:#111827;text-align:center;">
          <a href="${escapeHtml(homeUrl)}" style="display:inline-block;text-decoration:none;">
            <img
              src="${escapeHtml(logoUrl)}"
              alt="BeatElion logo"
              width="164"
              style="display:block;border:0;outline:none;text-decoration:none;width:164px;max-width:100%;height:auto;margin:0 auto;"
            />
          </a>
        </div>
        <div style="padding:24px;">
          <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">${escapeHtml(params.title)}</h1>
          ${bodyHtml}
          ${ctaHtml}
          ${metaHtml}
        </div>
        <div style="padding:14px 24px;border-top:1px solid #e4e4e7;color:#6b7280;font-size:12px;line-height:1.5;">
          BeatElion • ${escapeHtml(homeUrl)}
        </div>
      </div>
    </div>
  `;

  const textLines: string[] = [
    "BeatElion",
    "",
    params.title,
    "",
    ...params.bodyLines,
  ];

  if ((params.metaLines ?? []).length > 0) {
    textLines.push("", ...(params.metaLines ?? []));
  }
  if (safeCtaUrl && params.ctaLabel) {
    textLines.push("", `${params.ctaLabel}: ${safeCtaUrl}`);
  }
  textLines.push("", `BeatElion • ${homeUrl}`);

  return {
    html,
    text: textLines.join("\n"),
  };
};

const getTemplateContent = (params: {
  template: EmailTemplate;
  payload: Record<string, unknown> | null;
  appUrl: string;
}): TemplateContent => {
  const { template, payload, appUrl } = params;
  const safeAppUrl = appUrl.replace(/\/$/, "");
  const dashboardUrl = `${safeAppUrl}/dashboard`;

  if (template === "confirm_account") {
    const payloadUrl = asNonEmptyString(payload?.confirmation_url);
    const fallbackUrl = `${safeAppUrl}/email-confirmation`;
    const confirmationUrl = isValidHttpUrl(payloadUrl) ? payloadUrl : fallbackUrl;

    return {
      subject: "Confirme ton compte BeatElion",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Confirme ton compte BeatElion",
        preheader: "Finalise ton inscription BeatElion",
        bodyLines: [
          "Merci pour ton inscription.",
          "Clique sur le bouton ci-dessous pour finaliser l'activation de ton compte.",
        ],
        ctaLabel: "Confirmer mon compte",
        ctaUrl: confirmationUrl,
        metaLines: [
          `Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur: ${confirmationUrl}`,
        ],
      }),
    };
  }

  if (template === "welcome_user") {
    return {
      subject: "Bienvenue sur BeatElion",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Bienvenue sur BeatElion",
        preheader: "Ton compte est actif",
        bodyLines: [
          "Ton compte est maintenant actif.",
          "Tu peux explorer les beats, suivre les battles et personnaliser ton profil.",
        ],
        ctaLabel: "Ouvrir BeatElion",
        ctaUrl: safeAppUrl,
      }),
    };
  }

  if (template === "purchase_receipt") {
    const purchaseId = asNonEmptyString(payload?.purchase_id) ?? "N/A";
    return {
      subject: "Ton achat BeatElion est confirme",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Achat confirme",
        preheader: "Ton achat BeatElion est confirme",
        bodyLines: [
          "Merci pour ton achat.",
          "Ta commande a ete enregistree avec succes.",
        ],
        ctaLabel: "Voir mon dashboard",
        ctaUrl: dashboardUrl,
        metaLines: [`Reference achat: ${purchaseId}`],
      }),
    };
  }

  if (template === "license_ready") {
    const purchaseId = asNonEmptyString(payload?.purchase_id) ?? "N/A";
    return {
      subject: "Ta licence BeatElion est prete",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Licence prete",
        preheader: "Ta licence BeatElion est prete",
        bodyLines: [
          "Ton contrat de licence est genere.",
          "Tu peux maintenant le recuperer depuis ton dashboard.",
        ],
        ctaLabel: "Acceder a mes achats",
        ctaUrl: dashboardUrl,
        metaLines: [`Reference achat: ${purchaseId}`],
      }),
    };
  }

  if (template === "battle_won") {
    const battleId = asNonEmptyString(payload?.battle_id) ?? "N/A";
    return {
      subject: "Bravo, tu as remporte une battle",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Victoire en battle",
        preheader: "Bravo pour ta victoire BeatElion",
        bodyLines: [
          "Felicitations, tu viens de remporter une battle sur BeatElion.",
        ],
        ctaLabel: "Voir mes battles",
        ctaUrl: `${safeAppUrl}/producer/battles`,
        metaLines: [`Battle: ${battleId}`],
      }),
    };
  }

  if (template === "comment_received") {
    const battleId = asNonEmptyString(payload?.battle_id);
    const metaLines = battleId ? [`Battle: ${battleId}`] : [];
    return {
      subject: "Nouveau commentaire recu",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Nouveau commentaire",
        preheader: "Tu as recu un nouveau commentaire",
        bodyLines: [
          "Tu as recu un nouveau commentaire sur BeatElion.",
        ],
        ctaLabel: "Ouvrir les battles",
        ctaUrl: `${safeAppUrl}/battles`,
        metaLines,
      }),
    };
  }

  if (template === "contact_reply") {
    const contactMessageId = asNonEmptyString(payload?.contact_message_id);
    const originalSubject = asNonEmptyString(payload?.subject) ?? "votre message";
    const contactName = asNonEmptyString(payload?.name);
    const reply = asNonEmptyString(payload?.reply) ?? "Notre equipe vous a repondu.";
    const greetingName = contactName ? `Bonjour ${contactName},` : "Bonjour,";
    const metaLines = [
      `Sujet initial: ${originalSubject}`,
      ...(contactMessageId ? [`Reference message: ${contactMessageId}`] : []),
    ];

    return {
      subject: "Reponse a votre message de contact",
      ...buildBrandedEmailContent({
        appUrl: safeAppUrl,
        title: "Reponse de l'equipe BeatElion",
        preheader: "Nous avons repondu a votre message",
        bodyLines: [
          greetingName,
          "Merci pour votre message.",
          "Voici notre reponse:",
          reply,
        ],
        ctaLabel: "Nous contacter",
        ctaUrl: `${safeAppUrl}/contact`,
        metaLines,
      }),
    };
  }

  return {
    subject: "Ton compte producteur est prêt",
    ...buildBrandedEmailContent({
      appUrl: safeAppUrl,
      title: "Ton compte producteur est pret",
      preheader: "Ton statut producteur est actif",
      bodyLines: [
        "Bonne nouvelle: ton statut producteur est actif.",
        "Tu peux maintenant publier tes beats et participer aux fonctionnalites dediees.",
      ],
      ctaLabel: "Acceder au dashboard",
      ctaUrl: dashboardUrl,
    }),
  };
};

const toTemplate = (value: string): EmailTemplate | null =>
  isEmailTemplate(value) ? value : null;

const trimErrorMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, MAX_ERROR_LENGTH);
};

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

serveWithErrorHandling("process-email-queue", async (req: Request) => {
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
  const resendApiKey = asNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  const emailFrom = asNonEmptyString(Deno.env.get("RESEND_FROM_EMAIL")) ?? "BeatElion <noreply@beatelion.com>";
  const replyTo = asNonEmptyString(Deno.env.get("SUPPORT_EMAIL")) ?? "support@beatelion.com";
  const appUrl = resolvePublicAppUrl(
    asNonEmptyString(Deno.env.get("APP_URL")),
    asNonEmptyString(Deno.env.get("SITE_URL")),
    asNonEmptyString(Deno.env.get("PUBLIC_SITE_URL")),
    asNonEmptyString(Deno.env.get("VITE_APP_URL")),
  );

  const missingConfig: string[] = [];
  if (!supabaseUrl) missingConfig.push("SUPABASE_URL");
  if (!serviceRoleKey) missingConfig.push("SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY");
  if (!internalPipelineSecret) missingConfig.push("INTERNAL_PIPELINE_SECRET");
  if (!resendApiKey) missingConfig.push("RESEND_API_KEY");

  if (missingConfig.length > 0) {
    console.error("[process-email-queue] missing configuration", { missingConfig });
    return jsonResponse(500, { error: `Missing server configuration: ${missingConfig.join(", ")}` });
  }

  const supabaseUrlValue = supabaseUrl as string;
  const serviceRoleKeyValue = serviceRoleKey as string;
  const resendApiKeyValue = resendApiKey as string;

  const providedInternalSecret = asNonEmptyString(req.headers.get("x-internal-secret"));
  if (!providedInternalSecret || providedInternalSecret !== internalPipelineSecret) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const supabaseAdmin = createClient(supabaseUrlValue, serviceRoleKeyValue, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const resend = new Resend(resendApiKeyValue);
  const runId = crypto.randomUUID();
  const runStartedAtMs = Date.now();
  await safeRecordPipelineRunEvent(supabaseAdmin, {
    component: "process-email-queue",
    runId,
    status: "start",
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
      component: "process-email-queue",
      runId,
      status: params.status,
      processedCount: params.processedCount,
      errorCount: params.errorCount,
      durationMs,
      labels: {
        ...(params.extraLabels ?? {}),
        ...(params.skipZeroProcessedAlert ? { skip_zero_processed_alert: true } : {}),
      },
    });
    await safeEmitPipelineRunAlerts(supabaseAdmin, {
      component: "process-email-queue",
      runId,
      status: params.status,
      processedCount: params.processedCount,
      errorCount: params.errorCount,
      durationMs,
      config: {
        durationThresholdMs: 20_000,
        zeroProcessedConsecutiveRuns: 3,
        skipZeroProcessedAlert: params.skipZeroProcessedAlert === true,
      },
    });
  };

  // Internal rate limit: do not start a new run if another run has active processing locks.
  const activeLockThreshold = new Date(Date.now() - PIPELINE_ACTIVE_RUN_WINDOW_SECONDS * 1000).toISOString();
  const { count: activeProcessingCount, error: activeCountError } = await supabaseAdmin
    .from("email_queue")
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
    return jsonResponse(500, { error: "Unable to verify worker state" });
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
      error: "Worker is already processing the queue",
      activeProcessingCount,
    });
  }

  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc("claim_email_queue_batch", {
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
    return jsonResponse(500, { error: "Unable to claim email batch" });
  }

  const rows = (claimedRows as EmailQueueRow[] | null) ?? [];
  if (rows.length === 0) {
    const [{ count: pendingBacklog, error: pendingBacklogError }, { count: failedBacklog, error: failedBacklogError }] =
      await Promise.all([
      supabaseAdmin
        .from("email_queue")
        .select("id", { head: true, count: "exact" })
        .eq("status", "pending"),
      supabaseAdmin
        .from("email_queue")
        .select("id", { head: true, count: "exact" })
        .eq("status", "failed"),
    ]);

    if (pendingBacklogError || failedBacklogError) {
      await finalizeRun({
        status: "failure",
        processedCount: 0,
        errorCount: 1,
        extraLabels: { reason: "backlog_query_failed" },
      });
      return jsonResponse(500, { error: "Unable to load email backlog" });
    }

    const metricsInserted = await safeInsertPipelineMetrics(
      supabaseAdmin,
      [
        {
          component: "process-email-queue",
          metricName: "email_sent",
          metricValue: 0,
        },
        {
          component: "process-email-queue",
          metricName: "email_failed",
          metricValue: 0,
        },
        {
          component: "process-email-queue",
          metricName: "queue_backlog",
          metricValue: pendingBacklog ?? 0,
          labels: { queue: "email_queue", status: "pending" },
        },
        {
          component: "process-email-queue",
          metricName: "queue_backlog",
          metricValue: failedBacklog ?? 0,
          labels: { queue: "email_queue", status: "failed" },
        },
      ],
      "process-email-queue",
    );

    if (!metricsInserted) {
      await finalizeRun({
        status: "failure",
        processedCount: 0,
        errorCount: 1,
        extraLabels: { reason: "metrics_insert_failed" },
      });
      return jsonResponse(500, { error: "Unable to write pipeline metrics" });
    }

    await finalizeRun({
      status: "success",
      processedCount: 0,
      errorCount: 0,
      extraLabels: {
        sent: 0,
        failed: 0,
        pending_retry: 0,
      },
    });

    return jsonResponse(200, {
      processed: 0,
      sent: 0,
      failed: 0,
      pendingRetry: 0,
    });
  }

  let sent = 0;
  let failed = 0;
  let pendingRetry = 0;
  let stateUpdateFailures = 0;
  let latencyResolutionErrors = 0;
  const sentRowsForLatency: Array<{ row: EmailQueueRow; processedAtIso: string }> = [];

  for (const row of rows) {
    console.log("[process-email-queue] processing email job", {
      emailQueueId: row.id,
      template: row.template,
      attempt: row.attempts + 1,
      maxAttempts: row.max_attempts,
    });

    const template = toTemplate(row.template);
    const email = normalizeEmail(row.email);

    if (!template || !email) {
      const nextAttempts = row.attempts + 1;
      const nextStatus = nextAttempts >= row.max_attempts ? "failed" : "pending";
      const nowIso = new Date().toISOString();

      const { error: updateError } = await supabaseAdmin
        .from("email_queue")
        .update({
          attempts: nextAttempts,
          status: nextStatus,
          processed_at: nextStatus === "failed" ? nowIso : null,
          locked_at: null,
          last_error: template ? "invalid_email" : "invalid_template",
        })
        .eq("id", row.id)
        .eq("status", "processing");

      if (updateError) {
        console.error("[process-email-queue] queue update error (invalid row)", {
          id: row.id,
          updateError,
        });
        stateUpdateFailures += 1;
      }

      if (nextStatus === "failed") failed += 1;
      else pendingRetry += 1;
      continue;
    }

    const { subject, html, text } = getTemplateContent({
      template,
      payload: row.payload,
      appUrl,
    });
    const htmlSize = new TextEncoder().encode(html).length;
    if (htmlSize > 90_000) {
      console.warn(
        "[email-template] HTML size approaching Gmail clipping limit",
        { template, htmlSize },
      );
    }

    try {
      await resend.emails.send(
        {
          from: emailFrom,
          replyTo,
          to: email,
          subject,
          text,
          html,
        },
        {
          idempotencyKey: `email_queue/${row.id}`,
        },
      );

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("email_queue")
        .update({
          status: "sent",
          processed_at: nowIso,
          locked_at: null,
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", "processing");

      if (updateError) {
        console.error("[process-email-queue] queue update error (sent)", {
          id: row.id,
          updateError,
        });
        const { error: sentFallbackError } = await supabaseAdmin
          .from("email_queue")
          .update({
            status: "sent",
            processed_at: nowIso,
            locked_at: null,
            last_error: null,
          })
          .eq("id", row.id)
          .eq("status", "processing");

        if (sentFallbackError) {
          console.error("[process-email-queue] queue update error (sent fallback)", {
            id: row.id,
            sentFallbackError,
          });
          stateUpdateFailures += 1;
        }
      }

      sent += 1;
      sentRowsForLatency.push({ row, processedAtIso: nowIso });
    } catch (error) {
      const nextAttempts = row.attempts + 1;
      const nextStatus = nextAttempts >= row.max_attempts ? "failed" : "pending";
      const nowIso = new Date().toISOString();
      const lastError = trimErrorMessage(error);

      console.error("[process-email-queue] email send failed", {
        emailQueueId: row.id,
        template: row.template,
        nextStatus,
        lastError,
      });

      const { error: updateError } = await supabaseAdmin
        .from("email_queue")
        .update({
          attempts: nextAttempts,
          status: nextStatus,
          processed_at: nextStatus === "failed" ? nowIso : null,
          locked_at: null,
          last_error: lastError,
        })
        .eq("id", row.id)
        .eq("status", "processing");

      if (updateError) {
        console.error("[process-email-queue] queue update error (failed)", {
          id: row.id,
          updateError,
        });
        stateUpdateFailures += 1;
      }

      if (nextStatus === "failed") failed += 1;
      else pendingRetry += 1;
    }
  }

  let avgPipelineLatencyMs = 0;
  if (sentRowsForLatency.length > 0) {
    const sourceOutboxIds = new Set<string>();
    const sourceEventIds = new Set<string>();

    for (const item of sentRowsForLatency) {
      const outboxId = asUuid(item.row.source_outbox_id);
      const eventId = asUuid(item.row.source_event_id);
      if (outboxId) {
        sourceOutboxIds.add(outboxId);
      } else if (eventId) {
        sourceEventIds.add(eventId);
      }
    }

    const eventToOutbox = new Map<string, string>();
    if (sourceEventIds.size > 0) {
      const { data: eventBusRows, error: eventBusError } = await supabaseAdmin
        .from("event_bus")
        .select("id,source_outbox_id")
        .in("id", Array.from(sourceEventIds));

      if (!eventBusError) {
        for (const row of (eventBusRows as Array<{ id: string; source_outbox_id: string | null }> | null) ?? []) {
          const eventId = asUuid(row.id);
          const outboxId = asUuid(row.source_outbox_id);
          if (eventId && outboxId) {
            eventToOutbox.set(eventId, outboxId);
            sourceOutboxIds.add(outboxId);
          }
        }
      } else {
        console.error("[process-email-queue] event bus lookup failed for latency", { eventBusError });
        latencyResolutionErrors += 1;
      }
    }

    const outboxCreatedAt = new Map<string, string>();
    if (sourceOutboxIds.size > 0) {
      const { data: outboxRows, error: outboxError } = await supabaseAdmin
        .from("event_outbox")
        .select("id,created_at")
        .in("id", Array.from(sourceOutboxIds));

      if (!outboxError) {
        for (const row of (outboxRows as Array<{ id: string; created_at: string }> | null) ?? []) {
          const outboxId = asUuid(row.id);
          const createdAt = asNonEmptyString(row.created_at);
          if (outboxId && createdAt) {
            outboxCreatedAt.set(outboxId, createdAt);
          }
        }
      } else {
        console.error("[process-email-queue] outbox lookup failed for latency", { outboxError });
        latencyResolutionErrors += 1;
      }
    }

    const latencyValues: number[] = [];
    for (const item of sentRowsForLatency) {
      const sourceOutboxId = asUuid(item.row.source_outbox_id);
      const sourceEventId = asUuid(item.row.source_event_id);
      const resolvedOutboxId = sourceOutboxId ?? (sourceEventId ? eventToOutbox.get(sourceEventId) ?? null : null);
      const baselineIso = resolvedOutboxId
        ? outboxCreatedAt.get(resolvedOutboxId) ?? item.row.created_at
        : item.row.created_at;
      const latencyMs = new Date(item.processedAtIso).getTime() - new Date(baselineIso).getTime();
      if (Number.isFinite(latencyMs) && latencyMs >= 0) {
        latencyValues.push(latencyMs);
      }
    }

    if (latencyValues.length > 0) {
      avgPipelineLatencyMs = latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length;
    }
  }

  const [{ count: pendingBacklog, error: pendingBacklogError }, { count: failedBacklog, error: failedBacklogError }] =
    await Promise.all([
    supabaseAdmin
      .from("email_queue")
      .select("id", { head: true, count: "exact" })
      .eq("status", "pending"),
    supabaseAdmin
      .from("email_queue")
      .select("id", { head: true, count: "exact" })
      .eq("status", "failed"),
  ]);

  if (pendingBacklogError || failedBacklogError) {
    await finalizeRun({
      status: "failure",
      processedCount: rows.length,
      errorCount: failed + pendingRetry + stateUpdateFailures + latencyResolutionErrors + 1,
      extraLabels: { reason: "backlog_query_failed" },
    });
    return jsonResponse(500, { error: "Unable to load email backlog" });
  }

  const metricsInserted = await safeInsertPipelineMetrics(
    supabaseAdmin,
    [
      {
        component: "process-email-queue",
        metricName: "email_sent",
        metricValue: sent,
      },
      {
        component: "process-email-queue",
        metricName: "email_failed",
        metricValue: failed,
      },
      {
        component: "process-email-queue",
        metricName: "pipeline_latency_ms",
        metricValue: avgPipelineLatencyMs,
        labels: { stage: "outbox_to_email_processed" },
      },
      {
        component: "process-email-queue",
        metricName: "queue_backlog",
        metricValue: pendingBacklog ?? 0,
        labels: { queue: "email_queue", status: "pending" },
      },
      {
        component: "process-email-queue",
        metricName: "queue_backlog",
        metricValue: failedBacklog ?? 0,
        labels: { queue: "email_queue", status: "failed" },
      },
    ],
    "process-email-queue",
  );

  if (!metricsInserted) {
    await finalizeRun({
      status: "failure",
      processedCount: rows.length,
      errorCount: failed + pendingRetry + stateUpdateFailures + latencyResolutionErrors + 1,
      extraLabels: { reason: "metrics_insert_failed" },
    });
    return jsonResponse(500, { error: "Unable to write pipeline metrics" });
  }

  const runErrorCount = failed + pendingRetry + stateUpdateFailures + latencyResolutionErrors;
  await finalizeRun({
    status: runErrorCount > 0 ? "failure" : "success",
    processedCount: rows.length,
    errorCount: runErrorCount,
    extraLabels: {
      sent,
      failed,
      pending_retry: pendingRetry,
      state_update_failures: stateUpdateFailures,
      latency_resolution_errors: latencyResolutionErrors,
    },
  });

  return jsonResponse(200, {
    processed: rows.length,
    sent,
    failed,
    pendingRetry,
  });
});
