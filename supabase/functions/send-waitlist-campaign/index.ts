import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { resolveCorsHeaders } from "../_shared/cors.ts";
import { requireAdminUser } from "../_shared/auth.ts";
import {
  buildStandardEmailShell,
  classifySendError,
  getEmailConfig,
  normalizeCampaignKey,
  normalizeEmailForKey,
  resolveMarketingSendWindow,
  sendEmailWithResend,
} from "../_shared/email.ts";

type CampaignResponse =
  | { success: true; sent?: number; warmupLimited?: boolean; attempted?: number }
  | {
      success: false;
      error: "not_admin" | "missing_resend_key" | "db_error" | "unexpected_error" | "marketing_disabled";
    };

type WaitlistRow = {
  email: string;
};

const CAMPAIGN_ID = normalizeCampaignKey("waitlist_launch");
const CAMPAIGN_SUBJECT = "🚀 Beatelion est en ligne !";
const MAX_EMAILS = 200;

const jsonResponse = (
  payload: CampaignResponse,
  status: number,
  corsHeaders: Record<string, string>,
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const updateDeliveryState = async (
  supabaseAdmin: any,
  dedupeKey: string,
  patch: Record<string, unknown>,
) => {
  const { error } = await supabaseAdmin
    .from("notification_email_log")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", dedupeKey);

  if (error) {
    console.error("[send-waitlist-campaign] delivery state update failed", {
      dedupeKey,
      error: error.message,
      patch,
    });
  }
};

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = resolveCorsHeaders(req.headers.get("origin")) as Record<string, string>;

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "unexpected_error" }, 200, corsHeaders);
  }

  try {
    console.log("START CAMPAIGN");
    const authResult = await requireAdminUser(req, corsHeaders);
    if ("error" in authResult) {
      const status = authResult.error.status;
      if (status === 403) {
        return jsonResponse({ success: false, error: "not_admin" }, 200, corsHeaders);
      }

      return jsonResponse({ success: false, error: "unexpected_error" }, 200, corsHeaders);
    }
    console.log("AUTH OK");

    const { supabaseAdmin } = authResult;

    const { data, error } = await supabaseAdmin
      .from("waitlist")
      .select("email")
      .order("created_at", { ascending: true });

    if (error || !data) {
      return jsonResponse({ success: false, error: "db_error" }, 200, corsHeaders);
    }

    let emailConfig;
    try {
      emailConfig = getEmailConfig();
    } catch {
      return jsonResponse({ success: false, error: "missing_resend_key" }, 200, corsHeaders);
    }

    const users = (data as WaitlistRow[]).slice(0, MAX_EMAILS);
    console.log("USERS:", users.length);
    if (users.length === 0) {
      return jsonResponse({ success: true, sent: 0 }, 200, corsHeaders);
    }

    if (!emailConfig.marketingSendsEnabled) {
      return jsonResponse({ success: false, error: "marketing_disabled" }, 200, corsHeaders);
    }

    const marketingWindow = resolveMarketingSendWindow(users.length, "send-waitlist-campaign");
    const recipients = users.slice(0, marketingWindow.allowedCount);

    let sent = 0;

    for (const entry of recipients) {
      const email = asNonEmptyString(entry.email);
      if (!email) {
        continue;
      }
      const normalizedEmail = normalizeEmailForKey(email);
      const dedupeKey = `waitlist_campaign/${CAMPAIGN_ID}/${normalizedEmail}`;
      const { data: claimData, error: claimError } = await (supabaseAdmin as any).rpc("claim_notification_email_delivery", {
        p_category: "waitlist_campaign",
        p_recipient_email: normalizedEmail,
        p_dedupe_key: dedupeKey,
        p_rate_limit_seconds: 365 * 24 * 60 * 60,
        p_metadata: {
          campaign_id: CAMPAIGN_ID,
          recipient_email: normalizedEmail,
          subject: CAMPAIGN_SUBJECT,
          sender: emailConfig.resendFromEmail,
        },
      });

      if (claimError) {
        console.error("[send-waitlist-campaign] claim_notification_email_delivery failed", {
          email,
          error: claimError.message,
        });
        continue;
      }

      const claim = claimData as { allowed?: unknown; reason?: unknown } | null;
      if (claim?.allowed !== true) {
        console.log("[send-waitlist-campaign] skipped already-sent recipient", {
          email: normalizedEmail,
          reason: claim?.reason ?? "unknown",
        });
        continue;
      }

      await updateDeliveryState(supabaseAdmin, dedupeKey, {
        send_state: "sending",
        last_attempted_at: new Date().toISOString(),
      });

      const emailContent = buildStandardEmailShell({
        type: "marketing",
        title: "Beatelion est ouvert",
        preheader: "La plateforme est maintenant disponible",
        appUrl: "https://beatelion.com",
        bodyHtml: [
          "<p style=\"margin:0 0 14px;line-height:1.55;color:#111827;\">La plateforme est maintenant disponible.</p>",
          "<p style=\"margin:0 0 18px;\"><a href=\"https://beatelion.com\" style=\"display:inline-block;background:#ef4444;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;\">Acceder au site</a></p>",
        ].join(""),
        bodyText: [
          "La plateforme est maintenant disponible.",
          "",
          "Acceder au site: https://beatelion.com",
        ].join("\n"),
      });

      try {
        const sendResult = await sendEmailWithResend({
          functionName: "send-waitlist-campaign",
          category: "marketing",
          to: normalizedEmail,
          subject: CAMPAIGN_SUBJECT,
          html: emailContent.html,
          text: emailContent.text,
          idempotencyKey: dedupeKey,
        });
        await updateDeliveryState(supabaseAdmin, dedupeKey, {
          send_state: "sent",
          provider_message_id: sendResult.providerMessageId,
          provider_accepted_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          last_error: null,
        });
      } catch (error) {
        const classification = classifySendError(error);
        console.error("[send-waitlist-campaign] send failure", {
          email: normalizedEmail,
          error: classification.message,
          nextState: classification.nextState,
        });
        await updateDeliveryState(supabaseAdmin, dedupeKey, {
          send_state: classification.nextState,
          last_error: classification.message,
        });
        continue;
      }

      sent += 1;

      await delay(150);
    }

    return jsonResponse({
      success: true,
      sent,
      attempted: recipients.length,
      warmupLimited: marketingWindow.warmupLimited,
    }, 200, corsHeaders);
  } catch (err) {
    console.error("ERROR:", err);
    return jsonResponse({ success: false, error: "unexpected_error" }, 200, corsHeaders);
  }
});
