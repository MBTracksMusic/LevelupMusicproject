import { Resend } from "npm:resend";

export type EmailCategory = "marketing" | "transactional";
export type EmailDeliveryState =
  | "pending"
  | "claimed"
  | "sending"
  | "sent"
  | "failed_retryable"
  | "failed_final"
  | "provider_accepted_db_persist_failed";

const BRAND_NAME = "Beatelion";
const DEFAULT_APP_URL = "https://beatelion.com";
const DEFAULT_UNSUBSCRIBE_URL = `${DEFAULT_APP_URL}/unsubscribe`;
const DEFAULT_PREFERENCES_URL = `${DEFAULT_APP_URL}/settings/notifications`;
const DEFAULT_SUPPORT_EMAIL = "support@beatelion.com";
const DEFAULT_WARMUP_DAY_FIVE_LIMIT = 250;

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBooleanEnv = (value: string | null, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parsePositiveIntEnv = (value: string | null, fallback: number) => {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const isValidHttpUrl = (value: string | null) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const normalizeEmailForKey = (value: unknown) => {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (!normalized) {
    throw new Error("Invalid email key: expected a non-empty email value");
  }
  return normalized;
};

const normalizeTokenForKey = (value: unknown, label: string) => {
  const normalized = asNonEmptyString(value)
    ?.toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9:_-]/g, "-")
    .replace(/-+/g, "-");
  if (!normalized) {
    throw new Error(`Invalid ${label}: expected a non-empty value`);
  }
  return normalized;
};

export const normalizeCampaignKey = (value: unknown) =>
  normalizeTokenForKey(value, "campaign key");

export const normalizeNewsKey = (value: unknown) =>
  normalizeTokenForKey(value, "news key");

export const getEmailConfig = () => {
  const resendApiKey = asNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  const resendFromEmail = asNonEmptyString(Deno.env.get("RESEND_FROM_EMAIL"));
  const supportEmail = asNonEmptyString(Deno.env.get("SUPPORT_EMAIL")) ?? DEFAULT_SUPPORT_EMAIL;
  const recipientOverride = asNonEmptyString(Deno.env.get("RESEND_RECIPIENT_OVERRIDE"));
  const environment =
    asNonEmptyString(Deno.env.get("ENV"))
    ?? asNonEmptyString(Deno.env.get("NODE_ENV"))
    ?? (Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "development");
  const marketingSendsEnabled = parseBooleanEnv(
    asNonEmptyString(Deno.env.get("EMAIL_MARKETING_SENDS_ENABLED")),
    true,
  );
  const warmupMode = parseBooleanEnv(
    asNonEmptyString(Deno.env.get("EMAIL_DOMAIN_WARMUP_MODE")),
    false,
  );
  const maxBatchSize = parsePositiveIntEnv(
    asNonEmptyString(Deno.env.get("EMAIL_MAX_BATCH_SIZE")),
    50,
  );
  const warmupDay = parsePositiveIntEnv(
    asNonEmptyString(Deno.env.get("EMAIL_WARMUP_DAY")),
    1,
  );
  const debugMode = parseBooleanEnv(
    asNonEmptyString(Deno.env.get("EMAIL_DEBUG_MODE")),
    false,
  );
  const forceSafeMode = parseBooleanEnv(
    asNonEmptyString(Deno.env.get("EMAIL_FORCE_SAFE_MODE")),
    false,
  );
  const allowLargeMarketingOverride = parseBooleanEnv(
    asNonEmptyString(Deno.env.get("EMAIL_ALLOW_LARGE_MARKETING_OVERRIDE")),
    false,
  );
  const domainUnder30Days = parseBooleanEnv(
    asNonEmptyString(Deno.env.get("EMAIL_DOMAIN_UNDER_30_DAYS")),
    false,
  );

  const missing: string[] = [];
  if (!resendApiKey) missing.push("RESEND_API_KEY");
  if (!resendFromEmail) missing.push("RESEND_FROM_EMAIL");

  if (missing.length > 0) {
    const message = [
      `Missing required email configuration: ${missing.join(", ")}.`,
      environment === "production"
        ? "Set these in Supabase Edge Function secrets before sending email."
        : "Set these in your local Supabase/Deno environment before sending email locally.",
    ].join(" ");
    throw new Error(message);
  }

  return {
    resendApiKey: resendApiKey as string,
    resendFromEmail: resendFromEmail as string,
    supportEmail,
    recipientOverride,
    environment,
    marketingSendsEnabled,
    warmupMode,
    maxBatchSize,
    warmupDay,
    debugMode,
    forceSafeMode,
    allowLargeMarketingOverride,
    domainUnder30Days,
  };
};

export const getResendFromEmail = () => getEmailConfig().resendFromEmail;
export const getResendApiKey = () => getEmailConfig().resendApiKey;
export const getRecipientOverride = () => getEmailConfig().recipientOverride;

const buildMarketingFooterHtml = (params: {
  unsubscribeUrl: string;
  preferencesUrl: string | null;
}) => `
  <div style="padding:14px 24px;border-top:1px solid #e4e4e7;color:#6b7280;font-size:12px;line-height:1.6;">
    <p style="margin:0 0 8px;">${BRAND_NAME}</p>
    <p style="margin:0 0 8px;">You are receiving this email because you opted in to hear from our platform.</p>
    <p style="margin:0 0 8px;">Unsubscribe: <a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#6b7280;">${escapeHtml(params.unsubscribeUrl)}</a></p>
    ${params.preferencesUrl
      ? `<p style="margin:0;">Preferences: <a href="${escapeHtml(params.preferencesUrl)}" style="color:#6b7280;">${escapeHtml(params.preferencesUrl)}</a></p>`
      : ""}
  </div>
`;

const buildTransactionalFooterHtml = (params: { supportEmail: string }) => `
  <div style="padding:14px 24px;border-top:1px solid #e4e4e7;color:#6b7280;font-size:12px;line-height:1.6;">
    <p style="margin:0 0 8px;">${BRAND_NAME}</p>
    <p style="margin:0 0 8px;">You are receiving this email because you interacted with our platform.</p>
    <p style="margin:0;">Need help? Reply to this email or contact ${escapeHtml(params.supportEmail)}.</p>
  </div>
`;

const buildMarketingFooterText = (params: {
  unsubscribeUrl: string;
  preferencesUrl: string | null;
}) => [
  BRAND_NAME,
  "You are receiving this email because you opted in to hear from our platform.",
  `Unsubscribe: ${params.unsubscribeUrl}`,
  ...(params.preferencesUrl ? [`Preferences: ${params.preferencesUrl}`] : []),
].join("\n");

const buildTransactionalFooterText = (params: { supportEmail: string }) => [
  BRAND_NAME,
  "You are receiving this email because you interacted with our platform.",
  `Need help? Reply to this email or contact ${params.supportEmail}.`,
].join("\n");

export const buildStandardEmailShell = (params: {
  type: EmailCategory;
  title: string;
  preheader?: string;
  appUrl?: string;
  bodyHtml: string;
  bodyText: string;
  supportEmail?: string | null;
  unsubscribeUrl?: string | null;
  preferencesUrl?: string | null;
}) => {
  const appUrl = (params.appUrl && isValidHttpUrl(params.appUrl)
    ? params.appUrl
    : DEFAULT_APP_URL).replace(/\/$/, "");
  const homeUrl = `${appUrl}/`;
  const logoUrl = `${appUrl}/beatelion-logo.png`;
  const preheader = escapeHtml(params.preheader ?? params.title);
  const supportEmail = params.supportEmail ?? DEFAULT_SUPPORT_EMAIL;
  const unsubscribeUrl = params.unsubscribeUrl ?? DEFAULT_UNSUBSCRIBE_URL;
  const preferencesUrl = params.preferencesUrl ?? DEFAULT_PREFERENCES_URL;

  const footerHtml = params.type === "marketing"
    ? buildMarketingFooterHtml({ unsubscribeUrl, preferencesUrl })
    : buildTransactionalFooterHtml({ supportEmail });
  const footerText = params.type === "marketing"
    ? buildMarketingFooterText({ unsubscribeUrl, preferencesUrl })
    : buildTransactionalFooterText({ supportEmail });

  const html = `
    <div lang="fr" style="margin:0;padding:20px 12px;background:#f4f4f5;">
      <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#ffffff;opacity:0;mso-hide:all;">
        ${preheader}
      </div>
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
        <div style="padding:20px 24px 8px;background:#111827;text-align:center;">
          <a href="${escapeHtml(homeUrl)}" style="display:inline-block;text-decoration:none;">
            <img
              src="${escapeHtml(logoUrl)}"
              alt="${BRAND_NAME} logo"
              width="164"
              style="display:block;border:0;outline:none;text-decoration:none;width:164px;max-width:100%;height:auto;margin:0 auto;"
            />
          </a>
        </div>
        <div style="padding:24px;">
          <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">${escapeHtml(params.title)}</h1>
          ${params.bodyHtml}
        </div>
        ${footerHtml}
      </div>
    </div>
  `;

  const text = [
    BRAND_NAME,
    "",
    params.title,
    "",
    params.bodyText.trim(),
    "",
    footerText,
  ].join("\n");

  return { html, text };
};

export const appendFooterHtmlByCategory = (params: {
  type: EmailCategory;
  contentHtml: string;
  supportEmail?: string | null;
  unsubscribeUrl?: string | null;
  preferencesUrl?: string | null;
}) =>
  `${params.contentHtml}${
    params.type === "marketing"
      ? buildMarketingFooterHtml({
        unsubscribeUrl: params.unsubscribeUrl ?? DEFAULT_UNSUBSCRIBE_URL,
        preferencesUrl: params.preferencesUrl ?? DEFAULT_PREFERENCES_URL,
      })
      : buildTransactionalFooterHtml({
        supportEmail: params.supportEmail ?? DEFAULT_SUPPORT_EMAIL,
      })
  }`;

export const appendFooterTextByCategory = (params: {
  type: EmailCategory;
  contentText: string;
  supportEmail?: string | null;
  unsubscribeUrl?: string | null;
  preferencesUrl?: string | null;
}) =>
  [
    params.contentText.trimEnd(),
    "",
    params.type === "marketing"
      ? buildMarketingFooterText({
        unsubscribeUrl: params.unsubscribeUrl ?? DEFAULT_UNSUBSCRIBE_URL,
        preferencesUrl: params.preferencesUrl ?? DEFAULT_PREFERENCES_URL,
      })
      : buildTransactionalFooterText({
        supportEmail: params.supportEmail ?? DEFAULT_SUPPORT_EMAIL,
      }),
  ].join("\n");

export const resolveMarketingSendWindow = (requestedCount: number, functionName: string) => {
  const config = getEmailConfig();
  const dayBasedLimit = (() => {
    if (config.warmupDay <= 1) return 20;
    if (config.warmupDay === 2) return 40;
    if (config.warmupDay === 3) return 80;
    if (config.warmupDay === 4) return 150;
    return parsePositiveIntEnv(asNonEmptyString(Deno.env.get("EMAIL_WARMUP_DAY_FIVE_LIMIT")), DEFAULT_WARMUP_DAY_FIVE_LIMIT);
  })();

  if (config.forceSafeMode) {
    const message = "Marketing email sending is blocked by EMAIL_FORCE_SAFE_MODE=true";
    console.error(`[${functionName}] marketing_guardrail_block`, { requestedCount, message });
    throw new Error(message);
  }

  if (!config.marketingSendsEnabled) {
    const message = "Marketing email sending is disabled by EMAIL_MARKETING_SENDS_ENABLED=false";
    console.error(`[${functionName}] marketing_guardrail_block`, { requestedCount, message });
    throw new Error(message);
  }

  if (!config.warmupMode) {
    if (config.domainUnder30Days) {
      console.warn(`[${functionName}] young_domain_warning`, {
        requestedCount,
        domainUnder30Days: true,
      });
    }
    return {
      allowedCount: requestedCount,
      warmupLimited: false,
    };
  }

  const effectiveCap = Math.min(config.maxBatchSize, dayBasedLimit);
  const allowedCount = config.allowLargeMarketingOverride
    ? requestedCount
    : Math.min(requestedCount, effectiveCap);
  const warmupLimited = allowedCount < requestedCount;

  console.log(`[${functionName}] marketing_guardrail_check`, {
    requestedCount,
    allowedCount,
    warmupMode: config.warmupMode,
    maxBatchSize: config.maxBatchSize,
    warmupDay: config.warmupDay,
    dayBasedLimit,
    warmupLimited,
    allowLargeMarketingOverride: config.allowLargeMarketingOverride,
  });

  return {
    allowedCount,
    warmupLimited,
  };
};

export const logDeliverabilityTest = (params: {
  providerMessageId: string | null;
  recipient: string;
  subject: string;
  timestamp: string;
}) => {
  console.log("[email-deliverability-test]", {
    providerMessageId: params.providerMessageId,
    recipient: params.recipient,
    subject: params.subject,
    timestamp: params.timestamp,
    manualChecks: [
      "Open Gmail or Outlook received message",
      "Use Gmail Show original or Outlook message headers",
      "Confirm SPF=PASS, DKIM=PASS, DMARC=PASS",
    ],
  });
};

export const classifySendError = (error: unknown): {
  nextState: EmailDeliveryState;
  retryable: boolean;
  ambiguous: boolean;
  message: string;
} => {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : null;

  if (
    lowered.includes("timeout")
    || lowered.includes("network")
    || lowered.includes("fetch")
    || lowered.includes("aborted")
    || lowered.includes("econnreset")
  ) {
    return { nextState: "sending", retryable: false, ambiguous: true, message };
  }

  if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
    return { nextState: "failed_final", retryable: false, ambiguous: false, message };
  }

  return { nextState: "failed_retryable", retryable: true, ambiguous: false, message };
};

export const sendEmailWithResend = async (params: {
  functionName: string;
  category: EmailCategory;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  idempotencyKey?: string;
  resend?: Resend;
}) => {
  const config = getEmailConfig();
  const resend = params.resend ?? new Resend(config.resendApiKey);
  const normalizedRecipient = normalizeEmailForKey(params.to);
  const recipient = config.recipientOverride ?? normalizedRecipient;
  const timestamp = new Date().toISOString();

  if (config.domainUnder30Days && params.category === "marketing") {
    console.warn(`[${params.functionName}] young_domain_warning`, {
      recipient,
      subject: params.subject,
      timestamp,
      category: params.category,
    });
  }

  console.log(`[${params.functionName}] email_send_attempt`, {
    recipient,
    normalizedRecipient,
    subject: params.subject,
    timestamp,
    category: params.category,
    overrideEnabled: Boolean(config.recipientOverride),
    idempotencyKey: params.idempotencyKey ?? null,
  });

  try {
    const response = await resend.emails.send(
      {
        from: config.resendFromEmail,
        to: recipient,
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
    );

    console.log(`[${params.functionName}] email_send_success`, {
      recipient,
      normalizedRecipient,
      subject: params.subject,
      timestamp,
      category: params.category,
      providerMessageId: response.data?.id ?? null,
    });

    if (config.debugMode) {
      console.log(`[${params.functionName}] email_debug_payload`, {
        sender: config.resendFromEmail,
        recipient,
        normalizedRecipient,
        subject: params.subject,
        category: params.category,
        idempotencyKey: params.idempotencyKey ?? null,
        providerMessageId: response.data?.id ?? null,
        htmlPreview: params.html.slice(0, 500),
        textPreview: params.text.slice(0, 500),
      });
      logDeliverabilityTest({
        providerMessageId: response.data?.id ?? null,
        recipient,
        subject: params.subject,
        timestamp,
      });
    }

    return {
      ok: true as const,
      recipient,
      normalizedRecipient,
      providerMessageId: response.data?.id ?? null,
    };
  } catch (error) {
    const classification = classifySendError(error);
    console.error(`[${params.functionName}] email_send_failure`, {
      recipient,
      normalizedRecipient,
      subject: params.subject,
      timestamp,
      category: params.category,
      idempotencyKey: params.idempotencyKey ?? null,
      nextState: classification.nextState,
      retryable: classification.retryable,
      ambiguous: classification.ambiguous,
      error: classification.message,
    });
    throw error;
  }
};
