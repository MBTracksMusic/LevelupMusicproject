import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireAdminUser } from "../_shared/auth.ts";
import { Resend } from "npm:resend";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import {
  appendStandardFooterHtml,
  appendStandardFooterText,
  escapeHtml,
  getResendFromEmail,
  isValidHttpUrl,
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
const BROADCAST_RECIPIENT_SCOPE = "ALL_SUBSCRIBERS";

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

async function releaseClaim(
  supabase: any,
  dedupeKey: string,
) {
  const { error } = await supabase
    .from("notification_email_log")
    .delete()
    .eq("dedupe_key", dedupeKey);

  if (error) {
    console.error("[broadcast-news] CLAIM_RELEASE_ERROR", { dedupeKey, error });
  }
}

async function claimBroadcast(
  supabase: any,
  params: {
    newsId: string;
    actorId: string;
    rateLimitSeconds: number;
  },
) {
  const dedupeKey = `news_broadcast:${params.newsId}`;

  const { data, error } = await supabase.rpc("claim_notification_email_send", {
    p_category: BROADCAST_CATEGORY,
    p_recipient_email: BROADCAST_RECIPIENT_SCOPE,
    p_dedupe_key: dedupeKey,
    p_rate_limit_seconds: params.rateLimitSeconds,
    p_metadata: {
      news_id: params.newsId,
      actor_id: params.actorId,
      category: BROADCAST_CATEGORY,
    },
  });

  if (error) {
    throw new Error(`claim_notification_email_send failed: ${error.message}`);
  }

  const decision = data && typeof data === "object"
    ? data as { allowed?: unknown; reason?: unknown }
    : null;

  return {
    dedupeKey,
    allowed: decision?.allowed === true,
    reason: typeof decision?.reason === "string" ? decision.reason : "unknown",
  };
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
  const safeTitleHtml = escapeHtml(safeTitle);
  const safeDescriptionHtml = escapeHtml(safeDescription);

  const subject = `Nouvelle annonce vidéo: ${safeTitle}`;
  const text = appendStandardFooterText([
      "Beatelion",
      "",
      safeTitle,
      "",
      safeDescription,
      "",
      `Voir la vidéo: ${safeVideoUrl}`,
      `Accueil: ${homeUrl}`,
    ].join("\n"));
  const html = `
      <div lang="fr" style="margin:0;padding:20px 12px;background:#f4f4f5;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
          <div style="padding:20px 24px 8px;background:#111827;text-align:center;">
            <a href="${escapeHtml(homeUrl)}" style="display:inline-block;text-decoration:none;">
              <img
                src="${escapeHtml(logoUrl)}"
                alt="Beatelion logo"
                width="164"
                style="display:block;border:0;outline:none;text-decoration:none;width:164px;max-width:100%;height:auto;margin:0 auto;"
              />
            </a>
          </div>
          <div style="padding:24px;color:#111827;">
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;">${safeTitleHtml}</h1>
            <p style="margin:0 0 14px;line-height:1.55;color:#111827;">${safeDescriptionHtml}</p>
            ${safeThumbnailUrl ? `<img src="${escapeHtml(safeThumbnailUrl)}" alt="${safeTitleHtml}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:8px;margin:0 0 14px;" />` : ""}
            <p style="margin:0 0 10px;"><a href="${escapeHtml(safeVideoUrl)}" target="_blank" rel="noopener noreferrer">Voir la vidéo</a></p>
            <p style="margin:0;"><a href="${escapeHtml(homeUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir l'accueil Beatelion</a></p>
          </div>
          ${appendStandardFooterHtml(
            `<div style="padding:0 24px 14px;color:#6b7280;font-size:12px;line-height:1.5;">Beatelion • ${escapeHtml(homeUrl)}</div>`,
          )}
        </div>
      </div>
    `;

  return await sendEmailWithResend({
    functionName: "broadcast-news",
    resend,
    to: recipient,
    subject,
    text,
    html,
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
  getResendFromEmail();

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
  const claim = await claimBroadcast(supabase, {
    newsId,
    actorId: actor.id,
    rateLimitSeconds: getRateLimitSeconds(),
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
      await releaseClaim(supabase, claim.dedupeKey);
      return new Response(JSON.stringify({ status: "no_recipients", sent: 0, total: 0 }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const cappedRecipients = recipients.slice(0, MAX_RECIPIENTS_PER_RUN);
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
        recipientClaim = await claimBroadcast(supabase, {
          newsId: `${newsId}:${recipient}`,
          actorId: actor.id,
          rateLimitSeconds: 365 * 24 * 60 * 60,
        });
        if (!recipientClaim.allowed) {
          console.log("[broadcast-news] EMAIL_RECIPIENT_SKIPPED", {
            newsId,
            recipient,
            reason: recipientClaim.reason,
          });
          continue;
        }

        await sendBroadcastEmail(resend, {
          replyTo,
          recipient,
          idempotencyKey: `broadcast-news/${newsId}/${recipient}`,
          appUrl,
          news: {
            title: newsData.title,
            description: newsData.description,
            videoUrl: newsData.video_url,
            thumbnailUrl: newsData.thumbnail_url,
          },
        });
        sentCount += 1;
      } catch (error) {
        if (recipientClaim?.dedupeKey) {
          await releaseClaim(supabase, recipientClaim.dedupeKey);
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

      await releaseClaim(supabase, claim.dedupeKey);
      return new Response(JSON.stringify({
        status: "partial",
        sent: sentCount,
        attempted: cappedRecipients.length,
        total: recipients.length,
        failed: failedRecipients.length,
        overflow: hasOverflow,
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
      await releaseClaim(supabase, claim.dedupeKey);
      return new Response(JSON.stringify({ error: "Failed to persist broadcast_sent_at" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

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
    await releaseClaim(supabase, claim.dedupeKey);
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
