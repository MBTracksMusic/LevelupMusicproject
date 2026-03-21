import { Resend } from "npm:resend";

const BRAND_NAME = "Beatelion";
const DEFAULT_UNSUBSCRIBE_URL = "https://beatelion.com/unsubscribe";

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export const getResendFromEmail = () => {
  const from = asNonEmptyString(Deno.env.get("RESEND_FROM_EMAIL"));
  if (!from) {
    throw new Error("Missing RESEND_FROM_EMAIL");
  }
  return from;
};

export const getResendApiKey = () => {
  const apiKey = asNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }
  return apiKey;
};

export const getRecipientOverride = () =>
  asNonEmptyString(Deno.env.get("RESEND_RECIPIENT_OVERRIDE"));

export const appendStandardFooterHtml = (contentHtml: string) => `
  ${contentHtml}
  <div style="padding:14px 24px;border-top:1px solid #e4e4e7;color:#6b7280;font-size:12px;line-height:1.6;">
    <p style="margin:0 0 8px;">${BRAND_NAME}</p>
    <p style="margin:0 0 8px;">You are receiving this email because you interacted with our platform.</p>
    <p style="margin:0;">Unsubscribe: <a href="${escapeHtml(DEFAULT_UNSUBSCRIBE_URL)}" style="color:#6b7280;">${escapeHtml(DEFAULT_UNSUBSCRIBE_URL)}</a></p>
  </div>
`;

export const appendStandardFooterText = (contentText: string) => [
  contentText.trimEnd(),
  "",
  BRAND_NAME,
  "You are receiving this email because you interacted with our platform.",
  `Unsubscribe: ${DEFAULT_UNSUBSCRIBE_URL}`,
].join("\n");

export const buildStandardEmailShell = (params: {
  title: string;
  preheader?: string;
  appUrl?: string;
  bodyHtml: string;
  bodyText: string;
}) => {
  const appUrl = (params.appUrl && isValidHttpUrl(params.appUrl)
    ? params.appUrl
    : "https://beatelion.com").replace(/\/$/, "");
  const homeUrl = `${appUrl}/`;
  const logoUrl = `${appUrl}/beatelion-logo.png`;
  const preheader = escapeHtml(params.preheader ?? params.title);

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
        ${appendStandardFooterHtml("")}
      </div>
    </div>
  `;

  const text = appendStandardFooterText([
    BRAND_NAME,
    "",
    params.title,
    "",
    params.bodyText.trim(),
  ].join("\n"));

  return { html, text };
};

export const sendEmailWithResend = async (params: {
  functionName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  idempotencyKey?: string;
  resend?: Resend;
}) => {
  const resend = params.resend ?? new Resend(getResendApiKey());
  const override = getRecipientOverride();
  const recipient = override ?? params.to;
  const from = getResendFromEmail();
  const timestamp = new Date().toISOString();

  console.log(`[${params.functionName}] email_send_attempt`, {
    recipient,
    subject: params.subject,
    timestamp,
    overrideEnabled: Boolean(override),
  });

  try {
    const response = await resend.emails.send(
      {
        from,
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
      subject: params.subject,
      timestamp,
      providerMessageId: response.data?.id ?? null,
    });

    return {
      ok: true as const,
      recipient,
      providerMessageId: response.data?.id ?? null,
    };
  } catch (error) {
    console.error(`[${params.functionName}] email_send_failure`, {
      recipient,
      subject: params.subject,
      timestamp,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
