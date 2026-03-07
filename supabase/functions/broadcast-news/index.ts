import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey, x-supabase-auth",
  "Content-Type": "application/json",
};

const MAX_RECIPIENTS_PER_RUN = 500;
const DEFAULT_RATE_LIMIT_SECONDS = 15 * 60;
const DEFAULT_EMAIL_FROM = "onboarding@resend.dev";
const BROADCAST_CATEGORY = "news_broadcast";
const BROADCAST_RECIPIENT_SCOPE = "ALL_SUBSCRIBERS";

type JsonRecord = Record<string, unknown>;

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
    from: string;
    recipient: string;
    news: {
      title: string;
      description: string | null;
      videoUrl: string;
      thumbnailUrl: string | null;
    };
    appUrl: string;
  },
) {
  const { from, recipient, news, appUrl } = params;
  const safeTitle = news.title;
  const safeDescription = news.description ?? "Nouvelle annonce vidéo disponible.";
  const homeUrl = `${appUrl.replace(/\/$/, "")}/`;

  return await resend.emails.send({
    from,
    to: recipient,
    subject: `Nouvelle annonce vidéo: ${safeTitle}`,
    text: `${safeTitle}\n\n${safeDescription}\n\nVoir la vidéo: ${news.videoUrl}\nAccueil: ${homeUrl}`,
    html: `
      <div lang="fr" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#111">
        <h1 style="margin:0 0 10px;font-size:22px;">${safeTitle}</h1>
        <p style="margin:0 0 14px;line-height:1.5;color:#333;">${safeDescription}</p>
        ${news.thumbnailUrl ? `<img src="${news.thumbnailUrl}" alt="${safeTitle}" style="max-width:100%;border-radius:8px;margin:0 0 14px;" />` : ""}
        <p style="margin:0 0 10px;"><a href="${news.videoUrl}" target="_blank" rel="noopener noreferrer">Voir la vidéo</a></p>
        <p style="margin:0;"><a href="${homeUrl}" target="_blank" rel="noopener noreferrer">Ouvrir l'accueil Beatelion</a></p>
      </div>
    `,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    console.error("[broadcast-news] ENV_ERROR", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      hasResendApiKey: Boolean(resendApiKey),
    });
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const authHeader =
    req.headers.get("x-supabase-auth") ||
    req.headers.get("Authorization") ||
    "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as any;

  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  const actor = authData.user;
  if (authError || !actor) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const { data: isAdminData, error: isAdminError } = await supabase.rpc("is_admin", {
    p_user_id: actor.id,
  });
  if (isAdminError || isAdminData !== true) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  const body = await req.json().catch(() => null) as JsonRecord | null;
  const newsId = asNonEmptyString(body?.news_id);
  if (!newsId) {
    return new Response(JSON.stringify({ error: "Missing news_id" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: newsData, error: newsError } = await supabase
    .from("news_videos")
    .select("id, title, description, video_url, thumbnail_url, is_published, broadcast_email, broadcast_sent_at")
    .eq("id", newsId)
    .maybeSingle();

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
    const from = asNonEmptyString(Deno.env.get("EMAIL_FROM")) || DEFAULT_EMAIL_FROM;
    const appUrl = asNonEmptyString(Deno.env.get("APP_BASE_URL"))
      || req.headers.get("origin")
      || "https://beatelion.com";

    let sentCount = 0;
    const failedRecipients: string[] = [];

    for (const recipient of cappedRecipients) {
      try {
        await sendBroadcastEmail(resend, {
          from,
          recipient,
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
    const { error: updateError } = await supabase
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
