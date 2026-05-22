import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCorsHeaders } from "../_shared/cors.ts";
import {
  createUserClient,
  extractBearerToken,
  requireAdminUser,
} from "../_shared/auth.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import {
  buildStandardEmailShell,
  classifySendError,
  escapeHtml,
  getEmailConfig,
  normalizeEmailForKey,
  sendEmailWithResend,
} from "../_shared/email.ts";

const FUNCTION_VERSION = "2026-05-22-accept-waitlist-entry-1";

type AcceptResult = {
  waitlist_id: string;
  email: string;
  campaign_type: string | null;
  whitelisted: boolean;
  user_existed: boolean;
  founding_promoted: boolean;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createServiceClient = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const updateDeliveryState = async (
  client: ReturnType<typeof createServiceClient>,
  dedupeKey: string,
  patch: Record<string, unknown>,
) => {
  if (!client) return;
  const { error } = await client
    .from("notification_email_log")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("dedupe_key", dedupeKey);
  if (error) {
    console.error("[accept-waitlist-entry] delivery state update failed", {
      dedupeKey,
      error: error.message,
    });
  }
};

const buildAcceptanceEmail = (
  email: string,
  campaignType: string | null,
  appUrl: string,
) => {
  const isFounding = campaignType === "founding";
  const signupUrl = `${appUrl.replace(/\/$/, "")}/register?email=${encodeURIComponent(email)}`;
  const safeSignupUrl = escapeHtml(signupUrl);

  const subject = isFounding
    ? "🎉 Bienvenue producteur fondateur sur Beatelion"
    : "✅ Ton accès à Beatelion est activé";

  const title = isFounding
    ? "Tu es producteur fondateur !"
    : "Ton accès est activé";

  const preheader = isFounding
    ? "Tu fais partie des 20 producteurs fondateurs"
    : "Ton accès Beatelion est activé";

  const ctaButtonHtml = `
    <p style="margin:24px 0;text-align:center;">
      <a href="${safeSignupUrl}" style="display:inline-block;padding:14px 28px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
        ${isFounding ? "Créer mon compte producteur" : "Créer mon compte"}
      </a>
    </p>
  `;

  const bodyHtml = isFounding
    ? `
      <p style="margin:0 0 14px;line-height:1.55;color:#111827;">
        Félicitations ! Tu fais partie des <strong>20 producteurs fondateurs</strong> sélectionnés pour rejoindre Beatelion.
      </p>
      <p style="margin:0 0 14px;line-height:1.55;color:#111827;">
        Ton statut producteur sera activé automatiquement à la création de ton compte, avec <strong>0% de commission</strong> et <strong>3 mois d'accès gratuit</strong> à toutes les fonctionnalités producteur.
      </p>
      ${ctaButtonHtml}
      <p style="margin:0 0 14px;line-height:1.55;color:#6b7280;font-size:14px;">
        Si tu as déjà un compte avec cet email, ton statut fondateur a été activé immédiatement. Connecte-toi pour découvrir ton espace producteur.
      </p>
    `
    : `
      <p style="margin:0 0 14px;line-height:1.55;color:#111827;">
        Ton accès à Beatelion est activé. Tu peux maintenant créer ton compte et explorer la plateforme.
      </p>
      ${ctaButtonHtml}
    `;

  const bodyText = isFounding
    ? `Félicitations ! Tu fais partie des 20 producteurs fondateurs sélectionnés.\n\nTon statut sera activé automatiquement avec 0% de commission et 3 mois d'accès gratuit.\n\nCrée ton compte : ${signupUrl}`
    : `Ton accès à Beatelion est activé.\n\nCrée ton compte : ${signupUrl}`;

  return { subject, title, preheader, bodyHtml, bodyText };
};

serveWithErrorHandling("accept-waitlist-entry", async (req: Request): Promise<Response> => {
  const corsHeaders = resolveCorsHeaders(req.headers.get("origin")) as Record<string, string>;
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const authContext = await requireAdminUser(req, corsHeaders);
  if ("error" in authContext) return authContext.error;

  const token = extractBearerToken(req);
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }
  const supabaseUser = createUserClient(token);
  const serviceClient = createServiceClient();

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const waitlistId = asNonEmptyString(body?.waitlist_id);
  if (!waitlistId || !UUID_RE.test(waitlistId)) {
    return new Response(JSON.stringify({ error: "invalid_waitlist_id" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const rpcCall = supabaseUser.rpc.bind(supabaseUser) as unknown as (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: AcceptResult | null; error: { code?: string; message?: string } | null }>;

  const { data: result, error: rpcError } = await rpcCall("accept_waitlist_entry", {
    p_waitlist_id: waitlistId,
  });

  if (rpcError || !result) {
    const code = rpcError?.code ?? "";
    const message = rpcError?.message ?? "RPC call failed";
    console.error("[accept-waitlist-entry] RPC error", {
      functionVersion: FUNCTION_VERSION,
      code,
      message,
      waitlistId,
    });
    if (code === "42501") {
      return new Response(JSON.stringify({ error: "Forbidden", message }), {
        status: 403,
        headers: jsonHeaders,
      });
    }
    if (code === "P0002") {
      return new Response(JSON.stringify({ error: "waitlist_entry_not_found", message }), {
        status: 404,
        headers: jsonHeaders,
      });
    }
    return new Response(JSON.stringify({ error: "rpc_error", message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  // Send confirmation email (best-effort: never fail the request if email errors)
  let emailSent = false;
  let emailError: string | null = null;

  try {
    getEmailConfig();
    if (!serviceClient) throw new Error("missing_service_client");

    const normalizedEmail = normalizeEmailForKey(result.email);
    const dedupeKey = `accept-waitlist-entry/${normalizedEmail}/${result.waitlist_id}`;
    const appUrl = Deno.env.get("APP_URL")
      ?? Deno.env.get("SITE_URL")
      ?? Deno.env.get("PUBLIC_SITE_URL")
      ?? "https://beatelion.com";

    const claimRpc = serviceClient.rpc.bind(serviceClient) as unknown as (
      fn: string,
      params?: Record<string, unknown>,
    ) => Promise<{ data: { allowed?: boolean; reason?: string } | null; error: { message?: string } | null }>;

    const { data: claimData, error: claimError } = await claimRpc(
      "claim_notification_email_delivery",
      {
        p_category: "waitlist_acceptance",
        p_recipient_email: normalizedEmail,
        p_dedupe_key: dedupeKey,
        p_rate_limit_seconds: 365 * 24 * 60 * 60,
        p_metadata: {
          recipient_email: normalizedEmail,
          campaign_type: result.campaign_type,
          subject: result.campaign_type === "founding"
            ? "🎉 Bienvenue producteur fondateur sur Beatelion"
            : "✅ Ton accès à Beatelion est activé",
        },
      },
    );

    if (claimError) throw claimError;

    if (claimData?.allowed !== true) {
      console.log("[accept-waitlist-entry] email skipped (already sent)", {
        email: normalizedEmail,
        reason: claimData?.reason ?? "unknown",
      });
    } else {
      await updateDeliveryState(serviceClient, dedupeKey, {
        send_state: "sending",
        last_attempted_at: new Date().toISOString(),
      });

      const { subject, title, preheader, bodyHtml, bodyText } = buildAcceptanceEmail(
        result.email,
        result.campaign_type,
        appUrl,
      );

      const emailContent = buildStandardEmailShell({
        type: "transactional",
        title,
        preheader,
        appUrl,
        bodyHtml,
        bodyText,
      });

      const sendResult = await sendEmailWithResend({
        functionName: "accept-waitlist-entry",
        category: "transactional",
        to: normalizedEmail,
        subject,
        html: emailContent.html,
        text: emailContent.text,
        idempotencyKey: dedupeKey,
      });

      await updateDeliveryState(serviceClient, dedupeKey, {
        send_state: "sent",
        provider_message_id: sendResult.providerMessageId,
        provider_accepted_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        last_error: null,
      });
      emailSent = true;
    }
  } catch (error) {
    const classification = classifySendError(error);
    emailError = classification.message;
    console.error("[accept-waitlist-entry] email send failed", {
      functionVersion: FUNCTION_VERSION,
      email: result.email,
      error: classification.message,
      nextState: classification.nextState,
    });
    if (serviceClient) {
      const normalizedEmail = normalizeEmailForKey(result.email);
      const dedupeKey = `accept-waitlist-entry/${normalizedEmail}/${result.waitlist_id}`;
      await updateDeliveryState(serviceClient, dedupeKey, {
        send_state: classification.nextState,
        last_error: classification.message,
      });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    result,
    email_sent: emailSent,
    email_error: emailError,
  }), {
    status: 200,
    headers: jsonHeaders,
  });
});
