import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import {
  buildStandardEmailShell,
  classifySendError,
  escapeHtml,
  getEmailConfig,
  normalizeEmailForKey,
  sendEmailWithResend,
} from "../_shared/email.ts";

type AuthHookPayload = {
  user: {
    id: string;
    email: string;
    email_new?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
    old_email?: string;
    provider?: string;
  };
};

type AuthTemplate = {
  templateKey: string;
  subject: string;
  title: string;
  preheader: string;
  bodyLines: string[];
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const createAdminClient = () => {
  const supabaseUrl = asNonEmptyString(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = asNonEmptyString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getHookSecret = () => {
  const secret = asNonEmptyString(Deno.env.get("SEND_EMAIL_HOOK_SECRET"));
  if (!secret) {
    throw new Error("Missing SEND_EMAIL_HOOK_SECRET");
  }
  return secret.replace("v1,whsec_", "");
};

const CANONICAL_PUBLIC_APP_URL = "https://www.beatelion.com";

const normalizePublicUrl = (value: string | null) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.hostname === "beatelion.com") {
      url.hostname = "www.beatelion.com";
    }
    return url;
  } catch {
    return null;
  }
};

const resolveActionBaseUrl = (redirectTo: string | null, siteUrl: string | null) =>
  normalizePublicUrl(redirectTo)
  ?? normalizePublicUrl(siteUrl)
  ?? new URL(CANONICAL_PUBLIC_APP_URL);

const resolveAppOrigin = (redirectTo: string | null, siteUrl: string | null) =>
  (normalizePublicUrl(redirectTo) ?? normalizePublicUrl(siteUrl))?.origin
  ?? CANONICAL_PUBLIC_APP_URL;

const buildActionUrl = (params: {
  redirectTo: string | null;
  siteUrl: string | null;
  tokenHash: string;
  type: string;
}) => {
  const url = resolveActionBaseUrl(params.redirectTo, params.siteUrl);
  url.searchParams.set("token_hash", params.tokenHash);
  url.searchParams.set("type", params.type);
  return url.toString();
};

const getTemplate = (actionType: string, recipientEmail: string): AuthTemplate => {
  const normalizedAction = actionType.toLowerCase();

  if (normalizedAction === "signup") {
    return {
      templateKey: "auth_confirm_signup",
      subject: "Confirme ton compte Beatelion",
      title: "Confirme ton compte",
      preheader: "Finalise ton inscription Beatelion",
      bodyLines: [
        "Merci pour ton inscription.",
        "Clique sur le lien ci-dessous pour activer ton compte.",
      ],
    };
  }

  if (normalizedAction === "recovery") {
    return {
      templateKey: "auth_reset_password",
      subject: "Reinitialise ton mot de passe Beatelion",
      title: "Reinitialisation du mot de passe",
      preheader: "Utilise ce lien pour choisir un nouveau mot de passe",
      bodyLines: [
        "Une demande de reinitialisation de mot de passe a ete recue.",
        "Si tu es a l'origine de cette demande, utilise le lien ci-dessous.",
      ],
    };
  }

  if (normalizedAction === "magiclink" || normalizedAction === "magic_link") {
    return {
      templateKey: "auth_magic_link",
      subject: "Ton lien de connexion Beatelion",
      title: "Connexion securisee",
      preheader: "Utilise ce lien pour te connecter",
      bodyLines: [
        "Utilise ce lien temporaire pour te connecter a Beatelion.",
        "Ce lien est a usage unique.",
      ],
    };
  }

  if (normalizedAction === "invite") {
    return {
      templateKey: "auth_invite",
      subject: "Invitation Beatelion",
      title: "Tu as ete invite sur Beatelion",
      preheader: "Active ton acces Beatelion",
      bodyLines: [
        "Une invitation Beatelion t'attend.",
        "Clique sur le lien ci-dessous pour finaliser ton acces.",
      ],
    };
  }

  if (normalizedAction === "email_change") {
    return {
      templateKey: "auth_email_change",
      subject: "Confirme le changement d'email Beatelion",
      title: "Confirme ton changement d'email",
      preheader: "Valide cette action de securite",
      bodyLines: [
        `Cette demande concerne ${recipientEmail}.`,
        "Clique sur le lien ci-dessous pour confirmer ce changement.",
      ],
    };
  }

  return {
    templateKey: "auth_generic",
    subject: "Action de securite Beatelion",
    title: "Action de securite",
    preheader: "Une action Beatelion demande ton attention",
    bodyLines: [
      "Une action d'authentification a ete demandee sur ton compte.",
      "Clique sur le lien ci-dessous pour continuer.",
    ],
  };
};

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
    console.error("[auth-send-email] delivery state update failed", {
      dedupeKey,
      patch,
      error: error.message,
    });
  }
};

const sendAuthEmail = async (params: {
  supabaseAdmin: any;
  recipient: string;
  actionType: string;
  tokenHash: string;
  redirectTo: string | null;
  siteUrl: string | null;
  bodyLines: string[];
  subject: string;
  title: string;
  preheader: string;
  templateKey: string;
}) => {
  const normalizedRecipient = normalizeEmailForKey(params.recipient);
  const dedupeKey = `auth-email/${params.templateKey}/${normalizedRecipient}/${params.tokenHash}`;
  const { data: claimData, error: claimError } = await (params.supabaseAdmin as any).rpc(
    "claim_notification_email_delivery",
    {
      p_category: "auth_email",
      p_recipient_email: normalizedRecipient,
      p_dedupe_key: dedupeKey,
      p_rate_limit_seconds: 24 * 60 * 60,
      p_metadata: {
        template_key: params.templateKey,
        recipient_email: normalizedRecipient,
        action_type: params.actionType,
        subject: params.subject,
      },
    },
  );

  if (claimError) {
    throw new Error(`claim_notification_email_delivery failed: ${claimError.message}`);
  }

  const claim = claimData as { allowed?: unknown; reason?: unknown } | null;
  if (claim?.allowed !== true) {
    console.log("[auth-send-email] auth email skipped", {
      recipient: normalizedRecipient,
      reason: claim?.reason ?? "unknown",
      templateKey: params.templateKey,
    });
    return;
  }

  await updateDeliveryState(params.supabaseAdmin, dedupeKey, {
    send_state: "sending",
    last_attempted_at: new Date().toISOString(),
  });

  const actionUrl = buildActionUrl({
    redirectTo: params.redirectTo,
    siteUrl: params.siteUrl,
    tokenHash: params.tokenHash,
    type: params.actionType,
  });

  const emailContent = buildStandardEmailShell({
    type: "transactional",
    title: params.title,
    preheader: params.preheader,
    appUrl: resolveAppOrigin(params.redirectTo, params.siteUrl),
    bodyHtml: [
      ...params.bodyLines.map((line) =>
        `<p style="margin:0 0 14px;line-height:1.55;color:#111827;">${line}</p>`
      ),
      `<p style="margin:0 0 18px;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#ef4444;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Continuer</a></p>`,
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#4b5563;">Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur: ${escapeHtml(actionUrl)}</p>`,
    ].join(""),
    bodyText: [
      ...params.bodyLines,
      "",
      `Continuer: ${actionUrl}`,
    ].join("\n"),
  });

  try {
    console.log("[auth-send-email] auth template resolved", {
      recipient: normalizedRecipient,
      templateKey: params.templateKey,
      actionType: params.actionType,
      dedupeKey,
    });
    const sendResult = await sendEmailWithResend({
      functionName: "auth-send-email",
      category: "transactional",
      to: normalizedRecipient,
      subject: params.subject,
      html: emailContent.html,
      text: emailContent.text,
      idempotencyKey: dedupeKey,
    });

    await updateDeliveryState(params.supabaseAdmin, dedupeKey, {
      send_state: "sent",
      provider_message_id: sendResult.providerMessageId,
      provider_accepted_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      last_error: null,
    });
  } catch (error) {
    const classification = classifySendError(error);
    console.error("[auth-send-email] provider send failed", {
      recipient: normalizedRecipient,
      templateKey: params.templateKey,
      actionType: params.actionType,
      nextState: classification.nextState,
      error: classification.message,
    });
    await updateDeliveryState(params.supabaseAdmin, dedupeKey, {
      send_state: classification.nextState,
      last_error: classification.message,
    });
    throw error;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payloadText = await req.text();
  const headers = Object.fromEntries(req.headers);
  let payload: AuthHookPayload;

  try {
    const webhook = new Webhook(getHookSecret());
    payload = webhook.verify(payloadText, headers) as AuthHookPayload;
  } catch (error) {
    console.error("[auth-send-email] hook verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    getEmailConfig();
    const supabaseAdmin = createAdminClient();
    const emailData = payload.email_data;
    const user = payload.user;
    const siteUrl = asNonEmptyString(emailData.site_url);
    const redirectTo = asNonEmptyString(emailData.redirect_to);
    const actionType = asNonEmptyString(emailData.email_action_type) ?? "generic";

    if (actionType === "email_change") {
      const newEmail = asNonEmptyString(user.email_new);
      const tokenHashForCurrentEmail = asNonEmptyString(emailData.token_hash_new);
      const tokenHashForNewEmail = asNonEmptyString(emailData.token_hash);
      let emailSent = false;

      if (tokenHashForCurrentEmail) {
        const currentRecipient = normalizeEmailForKey(user.email);
        const currentTemplate = getTemplate(actionType, currentRecipient);

        await sendAuthEmail({
          supabaseAdmin,
          recipient: currentRecipient,
          actionType,
          tokenHash: tokenHashForCurrentEmail,
          redirectTo,
          siteUrl,
          bodyLines: currentTemplate.bodyLines,
          subject: currentTemplate.subject,
          title: currentTemplate.title,
          preheader: currentTemplate.preheader,
          templateKey: currentTemplate.templateKey,
        });
        emailSent = true;
      }

      if (newEmail && tokenHashForNewEmail) {
        const secondaryRecipient = normalizeEmailForKey(newEmail);
        const secondaryTemplate = getTemplate(actionType, secondaryRecipient);

        await sendAuthEmail({
          supabaseAdmin,
          recipient: secondaryRecipient,
          actionType,
          tokenHash: tokenHashForNewEmail,
          redirectTo,
          siteUrl,
          bodyLines: secondaryTemplate.bodyLines,
          subject: secondaryTemplate.subject,
          title: secondaryTemplate.title,
          preheader: secondaryTemplate.preheader,
          templateKey: `${secondaryTemplate.templateKey}_new_email`,
        });
        emailSent = true;
      }

      if (!emailSent) {
        throw new Error("email_change_missing_target_token_hash");
      }
    } else {
      const primaryRecipient = normalizeEmailForKey(user.email);
      const primaryTemplate = getTemplate(actionType, primaryRecipient);

      await sendAuthEmail({
        supabaseAdmin,
        recipient: primaryRecipient,
        actionType,
        tokenHash: emailData.token_hash,
        redirectTo,
        siteUrl,
        bodyLines: primaryTemplate.bodyLines,
        subject: primaryTemplate.subject,
        title: primaryTemplate.title,
        preheader: primaryTemplate.preheader,
        templateKey: primaryTemplate.templateKey,
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[auth-send-email] request handling failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
