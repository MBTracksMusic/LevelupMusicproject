import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireAdminUser } from "../_shared/auth.ts";
import { Resend } from "npm:resend";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import {
  buildStandardEmailShell,
  classifySendError,
  getEmailConfig,
  isValidHttpUrl,
  normalizeEmailForKey,
  normalizeNewsKey,
  resolveMarketingSendWindow,
  sendEmailWithResend,
} from "../_shared/email.ts";

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const ALLOWED_CORS_ORIGINS = (() => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);
  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const n = normalizeOrigin(token.trim());
      if (n) allowed.add(n);
    }
  }
  return allowed;
})();

const buildCorsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? DEFAULT_ALLOWED_CORS_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Content-Type": "application/json",
  "Vary": "Origin",
});

const resolveRequestCorsOrigin = (req: Request): string | null => {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  const n = normalizeOrigin(raw);
  return n && ALLOWED_CORS_ORIGINS.has(n) ? n : null;
};

const MAX_RECIPIENTS_PER_RUN = 500;
const DEFAULT_RATE_LIMIT_SECONDS = 15 * 60;
const DEFAULT_SOCIAL_REPLY_TO = "social@beatelion.com";
const BROADCAST_CATEGORY = "news_broadcast";
type JsonRecord = Record<string, unknown>;
type NewsVideoRow = {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  is_published: boolean | null;
  broadcast_email: boolean | null;
  broadcast_sent_at: string | null;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toLowercaseEmail = (value: unknown) => {
  const clean = asNonEmptyString(value);
  if (!clean) return null;
  return clean.toLowerCase();
};

const getRateLimitSeconds = () => {
  const raw = asNonEmptyString(Deno.env.get("NEWS_BROADCAST_RATE_LIMIT_SECONDS"));
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT_SECONDS;
};

async function claimBroadcast(
  supabase: any,
  params: {
    dedupeKey: string;
    recipientEmail: string;
    actorId: string;
    rateLimitSeconds: number;
    metadata?: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc("claim_notification_email_delivery", {
    p_category: BROADCAST_CATEGORY,
    p_recipient_email: params.recipientEmail,
    p_dedupe_key: params.dedupeKey,
    p_rate_limit_seconds: params.rateLimitSeconds,
    p_metadata: {
      recipient_email: params.recipientEmail,
      actor_id: params.actorId,
      category: BROADCAST_CATEGORY,
      ...(params.metadata ?? {}),
    },
  });

  if (error) {
    throw new Error(`claim_notification_email_delivery failed: ${error.message}`);
  }

  const decision = data && typeof data === "object"
    ? data as { allowed?: unknown; reason?: unknown }
    : null;

  return {
    dedupeKey: params.dedupeKey,
    allowed: decision?.allowed === true,
    reason: typeof decision?.reason === "string" ? decision.reason : "unknown",
  };
}

async function updateDeliveryState(
  supabase: any,
  dedupeKey: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("notification_email_log")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", dedupeKey);

  if (error) {
    console.error("[broadcast-news] delivery state update failed", {
      dedupeKey,
      error: error.message,
      patch,
    });
  }
}

async function getSubscriberEmails(supabase: any) {
  const nowIso = new Date().toISOString();

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("producer_subscriptions")
    .select("user_id, subscription_status, current_period_end")
    .in("subscription_status", ["active", "trialing"])
    .gt("current_period_end", nowIso);

  if (subscriptionsError) {
    throw new Error(`Failed to load producer_subscriptions: ${subscriptionsError.message}`);
  }

  const userIds = [...new Set(
    ((subscriptions as { user_id?: string | null }[] | null) ?? [])
      .map((row) => asNonEmptyString(row.user_id))
      .filter((value): value is string => Boolean(value)),
  )];

  let emails: string[] = [];

  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("user_profiles")
      .select("email")
      .in("id", userIds);

    if (usersError) {
      throw new Error(`Failed to load user_profiles emails: ${usersError.message}`);
    }

    emails = ((users as { email?: string | null }[] | null) ?? [])
      .map((row) => toLowercaseEmail(row.email))
      .filter((value): value is string => Boolean(value));
  }

  if (emails.length > 0) {
    return [...new Set(emails)];
  }

  const { data: fallbackUsers, error: fallbackError } = await supabase
    .from("user_profiles")
    .select("email")
    .eq("is_producer_active", true);

  if (fallbackError) {
    throw new Error(`Failed to load fallback subscribers: ${fallbackError.message}`);
  }

  return [...new Set(
    ((fallbackUsers as { email?: string | null }[] | null) ?? [])
      .map((row) => toLowercaseEmail(row.email))
      .filter((value): value is string => Boolean(value)),
  )];
}

async function sendBroadcastEmail(
  resend: Resend,
  params: {
    replyTo: string;
    recipient: string;
    idempotencyKey: string;
    news: {
      title: string;
      description: string | null;
      videoUrl: string;
      thumbnailUrl: string | null;
    };
    appUrl: string;
  },
) {
  const { replyTo, recipient, news, appUrl } = params;
  const safeTitle = news.title;
  const safeDescription = news.description ?? "Nouvelle annonce vidéo disponible.";
  const safeAppUrl = appUrl.replace(/\/$/, "");
  const homeUrl = `${safeAppUrl}/`;
  const logoUrl = `${safeAppUrl}/beatelion-logo.png`;
  const safeVideoUrl = isValidHttpUrl(news.videoUrl) ? news.videoUrl : homeUrl;
  const safeThumbnailUrl = isValidHttpUrl(news.thumbnailUrl) ? news.thumbnailUrl : null;
  const subject = `Nouvelle annonce vidéo: ${safeTitle}`;
  const content = buildStandardEmailShell({
    type: "marketing",
    title: safeTitle,
    preheader: safeDescription,
    appUrl: safeAppUrl,
    bodyHtml: [
      `<p style="margin:0 0 14px;line-height:1.55;color:#111827;">${safeDescription}</p>`,
      safeThumbnailUrl
        ? `<img src="${safeThumbnailUrl}" alt="${safeTitle}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:8px;margin:0 0 14px;" />`
        : "",
      `<p style="margin:0 0 10px;"><a href="${safeVideoUrl}" target="_blank" rel="noopener noreferrer">Voir la vidéo</a></p>`,
      `<p style="margin:0;"><a href="${homeUrl}" target="_blank" rel="noopener noreferrer">Ouvrir l'accueil Beatelion</a></p>`,
    ].join(""),
    bodyText: [
      safeTitle,
      "",
      safeDescription,
      "",
      `Voir la vidéo: ${safeVideoUrl}`,
      `Accueil: ${homeUrl}`,
    ].join("\n"),
  });

  return await sendEmailWithResend({
    functionName: "broadcast-news",
    category: "marketing",
    resend,
    to: recipient,
    subject,
    text: content.text,
    html: content.html,
    replyTo,
    idempotencyKey: params.idempotencyKey,
  });
}

serveWithErrorHandling("broadcast-news", async (req: Request) => {
  const corsHeaders = buildCorsHeaders(resolveRequestCorsOrigin(req));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("[broadcast-news] ENV_ERROR", { hasResendApiKey: false });
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  const emailConfig = getEmailConfig();

  const authResult = await requireAdminUser(req, corsHeaders);
  if ("error" in authResult) return authResult.error;
  const { user: actor, supabaseAdmin: supabase } = authResult;

  const body = await req.json().catch(() => null) as JsonRecord | null;
  const newsId = asNonEmptyString(body?.news_id);
  if (!newsId) {
    return new Response(JSON.stringify({ error: "Missing news_id" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data, error: newsError } = await supabase
    .from("news_videos")
    .select("id, title, description, video_url, thumbnail_url, is_published, broadcast_email, broadcast_sent_at")
    .eq("id", newsId)
    .maybeSingle();
  const newsData = data as NewsVideoRow | null;

  if (newsError) {
    console.error("[broadcast-news] NEWS_FETCH_ERROR", { newsId, newsError });
    return new Response(JSON.stringify({ error: "Failed to load news" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  if (!newsData) {
    return new Response(JSON.stringify({ error: "News not found" }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  if (newsData.is_published !== true) {
    return new Response(JSON.stringify({ error: "News must be published before broadcast" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (newsData.broadcast_sent_at) {
    console.log("[broadcast-news] EMAIL_SKIPPED", {
      newsId,
      reason: "already_sent",
      broadcastSentAt: newsData.broadcast_sent_at,
    });
    return new Response(JSON.stringify({ status: "already_sent", news_id: newsId }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  // TODO: For higher precision anti-spam, switch to per-recipient claims
  // (dedupe key including email) instead of a single global claim.
  const normalizedNewsId = normalizeNewsKey(newsId);
  const claim = await claimBroadcast(supabase, {
    dedupeKey: `broadcast-news/${normalizedNewsId}/run`,
    recipientEmail: "all_subscribers",
    actorId: actor.id,
    rateLimitSeconds: getRateLimitSeconds(),
    metadata: { news_id: normalizedNewsId },
  });

  if (!claim.allowed) {
    console.log("[broadcast-news] EMAIL_SKIPPED", {
      newsId,
      reason: claim.reason,
      dedupeKey: claim.dedupeKey,
    });
    const status = claim.reason === "duplicate_dedupe" ? "already_sent" : "skipped";
    return new Response(JSON.stringify({ status, reason: claim.reason, news_id: newsId }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const recipients = await getSubscriberEmails(supabase);

    if (recipients.length === 0) {
      console.log("[broadcast-news] EMAIL_SKIPPED", { newsId, reason: "no_recipients" });
      await updateDeliveryState(supabase, claim.dedupeKey, {
        send_state: "failed_final",
        last_error: "no_recipients",
      });
      return new Response(JSON.stringify({ status: "no_recipients", sent: 0, total: 0 }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const marketingWindow = resolveMarketingSendWindow(recipients.length, "broadcast-news");
    const cappedRecipients = recipients.slice(0, Math.min(MAX_RECIPIENTS_PER_RUN, marketingWindow.allowedCount));
    const hasOverflow = recipients.length > MAX_RECIPIENTS_PER_RUN;
    const resend = new Resend(resendApiKey);
    const replyTo = asNonEmptyString(Deno.env.get("SOCIAL_EMAIL")) || DEFAULT_SOCIAL_REPLY_TO;
    const appUrl = asNonEmptyString(Deno.env.get("APP_BASE_URL"))
      || req.headers.get("origin")
      || "https://beatelion.com";

    let sentCount = 0;
    const failedRecipients: string[] = [];

    for (const recipient of cappedRecipients) {
      let recipientClaim:
        | {
            dedupeKey: string;
            allowed: boolean;
            reason: string;
          }
        | null = null;
      try {
        const normalizedRecipient = normalizeEmailForKey(recipient);
        const recipientDedupeKey = `broadcast-news/${normalizedNewsId}/${normalizedRecipient}`;
        recipientClaim = await claimBroadcast(supabase, {
          dedupeKey: recipientDedupeKey,
          recipientEmail: normalizedRecipient,
          actorId: actor.id,
          rateLimitSeconds: 365 * 24 * 60 * 60,
          metadata: {
            news_id: normalizedNewsId,
            subject: `Nouvelle annonce vidéo: ${newsData.title}`,
            sender: emailConfig.resendFromEmail,
          },
        });
        if (!recipientClaim.allowed) {
          console.log("[broadcast-news] EMAIL_RECIPIENT_SKIPPED", {
            newsId,
            recipient,
            reason: recipientClaim.reason,
          });
          continue;
        }
        await updateDeliveryState(supabase, recipientDedupeKey, {
          send_state: "sending",
          last_attempted_at: new Date().toISOString(),
        });

        const sendResult = await sendBroadcastEmail(resend, {
          replyTo,
          recipient: normalizedRecipient,
          idempotencyKey: recipientDedupeKey,
          appUrl,
          news: {
            title: newsData.title,
            description: newsData.description,
            videoUrl: newsData.video_url,
            thumbnailUrl: newsData.thumbnail_url,
          },
        });
        await updateDeliveryState(supabase, recipientDedupeKey, {
          send_state: "sent",
          provider_message_id: sendResult.providerMessageId,
          provider_accepted_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          last_error: null,
        });
        sentCount += 1;
      } catch (error) {
        if (recipientClaim?.dedupeKey) {
          const classification = classifySendError(error);
          await updateDeliveryState(supabase, recipientClaim.dedupeKey, {
            send_state: classification.nextState,
            last_error: classification.message,
          });
        }
        failedRecipients.push(recipient);
        console.error("[broadcast-news] EMAIL_SEND_ERROR", {
          newsId,
          recipient,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const hasFailures = failedRecipients.length > 0;
    const isPartial = hasOverflow || hasFailures;

    if (isPartial) {
      console.log("[broadcast-news] EMAIL_PARTIAL", {
        newsId,
        sent: sentCount,
        attempted: cappedRecipients.length,
        totalRecipients: recipients.length,
        failed: failedRecipients.length,
        overflow: hasOverflow,
      });

      await updateDeliveryState(supabase, claim.dedupeKey, {
        send_state: "failed_retryable",
        last_error: hasOverflow ? "warmup_or_batch_overflow" : "partial_recipient_failures",
      });
      return new Response(JSON.stringify({
        status: "partial",
        sent: sentCount,
        attempted: cappedRecipients.length,
        total: recipients.length,
        failed: failedRecipients.length,
        overflow: hasOverflow,
        warmup_limited: marketingWindow.warmupLimited,
      }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await (supabase as any)
      .from("news_videos")
      .update({ broadcast_sent_at: nowIso })
      .eq("id", newsId)
      .is("broadcast_sent_at", null);

    if (updateError) {
      console.error("[broadcast-news] NEWS_UPDATE_ERROR", { newsId, updateError });
      await updateDeliveryState(supabase, claim.dedupeKey, {
        send_state: "provider_accepted_db_persist_failed",
        last_error: "failed_to_persist_broadcast_sent_at",
      });
      return new Response(JSON.stringify({ error: "Failed to persist broadcast_sent_at" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    await updateDeliveryState(supabase, claim.dedupeKey, {
      send_state: "sent",
      sent_at: nowIso,
      provider_accepted_at: nowIso,
      last_error: null,
    });

    console.log("[broadcast-news] EMAIL_SENT", {
      newsId,
      sent: sentCount,
      total: recipients.length,
    });

    return new Response(JSON.stringify({
      status: "sent",
      news_id: newsId,
      sent: sentCount,
      total: recipients.length,
      broadcast_sent_at: nowIso,
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    await updateDeliveryState(supabase, claim.dedupeKey, {
      send_state: "failed_retryable",
      last_error: error instanceof Error ? error.message : String(error),
    });
    console.error("[broadcast-news] UNEXPECTED_ERROR", {
      newsId,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Broadcast failed",
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
