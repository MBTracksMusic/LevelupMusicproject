import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCorsHeaders } from "../_shared/cors.ts";
import { ApiError } from "../_shared/error-handler.ts";
import {
  buildStandardEmailShell,
  classifySendError,
  getEmailConfig,
  normalizeEmailForKey,
  sendEmailWithResend,
} from "../_shared/email.ts";
import { extractIpAddress, verifyHcaptchaToken } from "../_shared/hcaptcha.ts";

type JoinWaitlistBody = {
  email?: unknown;
  captchaToken?: unknown;
};

type JoinWaitlistResponse =
  | { message: "success" }
  | { message: "already_registered" }
  | { error: "invalid_email" | "method_not_allowed" | "server_error" | "rate_limit_exceeded" | "captcha_failed" };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const jsonResponse = (
  payload: JoinWaitlistResponse,
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

const sha256Hex = async (value: string): Promise<string> => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const createAdminClient = () => {
  const supabaseUrl = asNonEmptyString(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = asNonEmptyString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const updateDeliveryState = async (
  adminClient: any,
  dedupeKey: string,
  patch: Record<string, unknown>,
) => {
  const { error } = await adminClient
    .from("notification_email_log")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("dedupe_key", dedupeKey);

  if (error) {
    console.error("[join-waitlist] delivery state update failed", {
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
    return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);
  }

  try {
    const adminClient = createAdminClient();
    if (!adminClient) {
      return jsonResponse({ error: "server_error" }, 500, corsHeaders);
    }

    const body = await req.json().catch(() => null) as JoinWaitlistBody | null;
    const email = asNonEmptyString(body?.email)?.toLowerCase() ?? null;
    const captchaToken = asNonEmptyString(body?.captchaToken);

    if (!email || !email.includes("@") || !EMAIL_REGEX.test(email)) {
      return jsonResponse({ error: "invalid_email" }, 400, corsHeaders);
    }

    try {
      await verifyHcaptchaToken({
        captchaToken,
        remoteIp: extractIpAddress(req),
      });
    } catch (captchaError) {
      console.warn("[join-waitlist] captcha verification failed", {
        error: captchaError instanceof Error ? captchaError.message : String(captchaError),
        email: email.substring(0, 3) + '***',
      });
      return jsonResponse({ error: "captcha_failed" }, 403, corsHeaders);
    }

    const ipAddress = extractIpAddress(req) ?? "__unknown_ip__";
    const ipHash = await sha256Hex(ipAddress);
    const emailHash = await sha256Hex(email);
    const { error: rateLimitError } = await adminClient.rpc("rpc_waitlist_rate_limit", {
      p_ip_hash: ipHash,
      p_email_hash: emailHash,
    });

    if (rateLimitError) {
      if (rateLimitError.message.toLowerCase().includes("rate_limit_exceeded")) {
        console.warn("[join-waitlist] rate limit exceeded", {
          email: email.substring(0, 3) + '***',
          ipHash: ipHash.substring(0, 8) + '***',
        });
        return jsonResponse({ error: "rate_limit_exceeded" }, 429, corsHeaders);
      }
      console.error("[join-waitlist] rate limit check error", {
        error: rateLimitError.message,
      });
      return jsonResponse({ error: "server_error" }, 500, corsHeaders);
    }

    const { error: insertError } = await adminClient
      .from("waitlist")
      .insert({ email });

    if (insertError) {
      if (insertError.code === "23505") {
        console.log("[join-waitlist] email already registered", {
          email: email.substring(0, 3) + '***',
        });
        return jsonResponse({ message: "already_registered" }, 200, corsHeaders);
      }

      console.error("[join-waitlist] insert error", {
        code: insertError.code,
        message: insertError.message,
        email: email.substring(0, 3) + '***',
      });
      return jsonResponse({ error: "server_error" }, 500, corsHeaders);
    }

    console.log("[join-waitlist] email inserted successfully", {
      email: email.substring(0, 3) + '***',
      timestamp: new Date().toISOString(),
    });

    try {
      getEmailConfig();
      const normalizedEmail = normalizeEmailForKey(email);
      const dedupeKey = `join-waitlist/${normalizedEmail}`;
      const { data: claimData, error: claimError } = await (adminClient as any).rpc(
        "claim_notification_email_delivery",
        {
          p_category: "waitlist_confirmation",
          p_recipient_email: normalizedEmail,
          p_dedupe_key: dedupeKey,
          p_rate_limit_seconds: 365 * 24 * 60 * 60,
          p_metadata: {
            recipient_email: normalizedEmail,
            subject: "🎧 Tu es sur la waitlist",
          },
        },
      );

      if (claimError) {
        throw claimError;
      }

      const claim = claimData as { allowed?: unknown; reason?: unknown } | null;
      if (claim?.allowed !== true) {
        console.log("[join-waitlist] confirmation email skipped", {
          email: normalizedEmail,
          reason: claim?.reason ?? "unknown",
        });
        return jsonResponse({ message: "success" }, 200, corsHeaders);
      }

      await updateDeliveryState(adminClient, dedupeKey, {
        send_state: "sending",
        last_attempted_at: new Date().toISOString(),
      });

      const emailContent = buildStandardEmailShell({
        type: "transactional",
        title: "Bienvenue",
        preheader: "Tu es sur la waitlist Beatelion",
        appUrl: "https://beatelion.com",
        bodyHtml: "<p style=\"margin:0 0 14px;line-height:1.55;color:#111827;\">Tu es sur la waitlist. Nous te previendrons des que le lancement arrive.</p>",
        bodyText: "Tu es sur la waitlist. Nous te previendrons des que le lancement arrive.",
      });

      const sendResult = await sendEmailWithResend({
        functionName: "join-waitlist",
        category: "transactional",
        to: normalizedEmail,
        subject: "🎧 Tu es sur la waitlist",
        html: emailContent.html,
        text: emailContent.text,
        idempotencyKey: dedupeKey,
      });
      await updateDeliveryState(adminClient, dedupeKey, {
        send_state: "sent",
        provider_message_id: sendResult.providerMessageId,
        provider_accepted_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        last_error: null,
      });
    } catch (error) {
      const classification = classifySendError(error);
      console.error("[join-waitlist] EMAIL_SEND_ERROR", {
        email,
        error: classification.message,
        nextState: classification.nextState,
      });
      if (email) {
        const normalizedEmail = normalizeEmailForKey(email);
        await updateDeliveryState(adminClient, `join-waitlist/${normalizedEmail}`, {
          send_state: classification.nextState,
          last_error: classification.message,
        });
      }
    }

    return jsonResponse({ message: "success" }, 200, corsHeaders);
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("[join-waitlist] API error", {
        status: error.status,
        message: error.message,
      });

      if (error.message.toLowerCase().includes("captcha")) {
        return jsonResponse({ error: "captcha_failed" }, error.status, corsHeaders);
      }
      if (error.message.toLowerCase().includes("rate_limit")) {
        return jsonResponse({ error: "rate_limit_exceeded" }, error.status, corsHeaders);
      }

      return jsonResponse({ error: "server_error" }, error.status, corsHeaders);
    }
    console.error("[join-waitlist] unexpected error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return jsonResponse({ error: "server_error" }, 500, corsHeaders);
  }
});
