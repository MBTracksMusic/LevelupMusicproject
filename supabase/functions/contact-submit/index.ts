import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey, x-supabase-auth",
  "Content-Type": "application/json",
};

const CONTACT_CATEGORIES = new Set([
  "support",
  "battle",
  "payment",
  "partnership",
  "other",
]);

const DEFAULT_EMAIL_RATE_LIMIT_SECONDS = 15 * 60;
const DEFAULT_EMAIL_FROM = "onboarding@resend.dev";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type JsonObject = Record<string, unknown>;

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseRateLimitSeconds = () => {
  const raw = asNonEmptyString(Deno.env.get("CONTACT_EMAIL_RATE_LIMIT_SECONDS"));
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EMAIL_RATE_LIMIT_SECONDS;
};

const normalizeIpAddress = (value: string): string | null => {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned || cleaned === "unknown") return null;

  if (/^[0-9.]+$/.test(cleaned)) return cleaned;
  if (/^[0-9a-f:]+$/.test(cleaned)) return cleaned;

  return null;
};

const extractIpAddress = (req: Request): string | null => {
  const candidateHeaders = [
    req.headers.get("x-forwarded-for"),
    req.headers.get("x-real-ip"),
    req.headers.get("cf-connecting-ip"),
  ];

  for (const rawValue of candidateHeaders) {
    const clean = asNonEmptyString(rawValue);
    if (!clean) continue;
    const first = clean.split(",")[0]?.trim();
    if (!first) continue;
    const normalized = normalizeIpAddress(first);
    if (normalized) return normalized;
  }

  return null;
};

const isValidEmail = (value: string | null) => {
  if (!value) return false;
  return EMAIL_REGEX.test(value);
};

const claimAdminNotificationEmail = async (
  supabase: any,
  params: {
    recipientEmail: string;
    dedupeKey: string;
    metadata: JsonObject;
  },
) => {
  const { data, error } = await supabase.rpc("claim_notification_email_send", {
    p_category: "contact_submit_admin_email",
    p_recipient_email: params.recipientEmail.toLowerCase(),
    p_dedupe_key: params.dedupeKey,
    p_rate_limit_seconds: parseRateLimitSeconds(),
    p_metadata: params.metadata,
  });

  if (error) {
    console.error("[contact-submit] EMAIL_CLAIM_ERROR", {
      dedupeKey: params.dedupeKey,
      error: error.message,
    });
    return { allowed: false, reason: "claim_error" };
  }

  const decision = data && typeof data === "object"
    ? data as { allowed?: unknown; reason?: unknown }
    : null;

  return {
    allowed: decision?.allowed === true,
    reason: typeof decision?.reason === "string" ? decision.reason : "unknown",
  };
};

const sendAdminEmail = async (params: {
  resendApiKey: string;
  from: string;
  to: string;
  record: {
    id: string;
    created_at: string;
    user_id: string | null;
    name: string | null;
    email: string | null;
    subject: string;
    category: string;
    message: string;
    origin_page: string | null;
    ip_address: string | null;
    user_agent: string | null;
  };
}) => {
  const resend = new Resend(params.resendApiKey);
  const item = params.record;

  return await resend.emails.send({
    from: params.from,
    to: params.to,
    subject: `[Contact] ${item.category} - ${item.subject}`,
    text: [
      `Contact message ID: ${item.id}`,
      `Created at: ${item.created_at}`,
      `Category: ${item.category}`,
      `Subject: ${item.subject}`,
      `User ID: ${item.user_id ?? "anonymous"}`,
      `Name: ${item.name ?? "-"}`,
      `Email: ${item.email ?? "-"}`,
      `Origin page: ${item.origin_page ?? "-"}`,
      `IP: ${item.ip_address ?? "-"}`,
      `User-Agent: ${item.user_agent ?? "-"}`,
      "",
      item.message,
    ].join("\n"),
    html: `
      <div lang="fr" style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:24px;color:#111">
        <h1 style="margin:0 0 14px;font-size:22px;">Nouveau message de contact</h1>
        <p style="margin:0 0 6px;"><strong>ID:</strong> ${item.id}</p>
        <p style="margin:0 0 6px;"><strong>Créé le:</strong> ${item.created_at}</p>
        <p style="margin:0 0 6px;"><strong>Catégorie:</strong> ${item.category}</p>
        <p style="margin:0 0 6px;"><strong>Sujet:</strong> ${item.subject}</p>
        <p style="margin:0 0 6px;"><strong>User ID:</strong> ${item.user_id ?? "anonymous"}</p>
        <p style="margin:0 0 6px;"><strong>Nom:</strong> ${item.name ?? "-"}</p>
        <p style="margin:0 0 6px;"><strong>Email:</strong> ${item.email ?? "-"}</p>
        <p style="margin:0 0 6px;"><strong>Page origine:</strong> ${item.origin_page ?? "-"}</p>
        <p style="margin:0 0 6px;"><strong>IP:</strong> ${item.ip_address ?? "-"}</p>
        <p style="margin:0 0 14px;"><strong>User-Agent:</strong> ${item.user_agent ?? "-"}</p>
        <div style="white-space:pre-wrap;line-height:1.55;background:#f4f4f5;padding:14px;border-radius:8px;">${item.message}</div>
      </div>
    `,
  });
};

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
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;

  const authHeader =
    req.headers.get("x-supabase-auth") ||
    req.headers.get("Authorization") ||
    "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  let actorId: string | null = null;
  let actorEmail: string | null = null;
  if (jwt) {
    const { data: authData } = await supabase.auth.getUser(jwt);
    actorId = authData.user?.id ?? null;
    actorEmail = asNonEmptyString(authData.user?.email) ?? null;
  }

  const payload = await req.json().catch(() => null) as JsonObject | null;
  if (!payload) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const subject = asNonEmptyString(payload.subject);
  const message = asNonEmptyString(payload.message);
  const category = asNonEmptyString(payload.category) ?? "support";
  const name = asNonEmptyString(payload.name);
  const payloadEmail = asNonEmptyString(payload.email)?.toLowerCase() ?? null;
  const originPage = asNonEmptyString(payload.origin_page);

  if (!subject || subject.length < 3 || subject.length > 200) {
    return new Response(JSON.stringify({ error: "Subject must be between 3 and 200 characters" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!message || message.length < 10 || message.length > 5000) {
    return new Response(JSON.stringify({ error: "Message must be between 10 and 5000 characters" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!CONTACT_CATEGORIES.has(category)) {
    return new Response(JSON.stringify({ error: "Unsupported category" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const isAnonymous = actorId === null;
  const effectiveEmail = payloadEmail || actorEmail;

  if (isAnonymous && !name) {
    return new Response(JSON.stringify({ error: "Name is required for anonymous submissions" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (isAnonymous && !isValidEmail(effectiveEmail)) {
    return new Response(JSON.stringify({ error: "Valid email is required for anonymous submissions" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!isAnonymous && payloadEmail && !isValidEmail(payloadEmail)) {
    return new Response(JSON.stringify({ error: "Invalid email format" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const userAgent = asNonEmptyString(req.headers.get("user-agent"));
  const ipAddress = extractIpAddress(req);

  const { data: inserted, error: insertError } = await supabase
    .from("contact_messages")
    .insert({
      user_id: actorId,
      name,
      email: effectiveEmail,
      subject,
      category,
      message,
      origin_page: originPage,
      user_agent: userAgent,
      ip_address: ipAddress,
    })
    .select("id, created_at, user_id, name, email, subject, category, message, origin_page, user_agent, ip_address")
    .single();

  if (insertError || !inserted) {
    console.error("[contact-submit] INSERT_ERROR", { error: insertError?.message });
    return new Response(JSON.stringify({ error: "Unable to submit message" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const contactToEmail = asNonEmptyString(Deno.env.get("CONTACT_TO_EMAIL"));
  const emailFrom = asNonEmptyString(Deno.env.get("EMAIL_FROM")) || DEFAULT_EMAIL_FROM;

  if (!resendApiKey || !contactToEmail) {
    console.error("[contact-submit] EMAIL_CONFIG_MISSING", {
      hasResendApiKey: Boolean(resendApiKey),
      hasContactToEmail: Boolean(contactToEmail),
      contactMessageId: inserted.id,
    });
    return new Response(JSON.stringify({ ok: true, id: inserted.id }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  const dedupeKey = `contact_message:${inserted.id}`;
  const claim = await claimAdminNotificationEmail(supabase, {
    recipientEmail: contactToEmail,
    dedupeKey,
    metadata: {
      contact_message_id: inserted.id,
      category,
      user_id: actorId,
    },
  });

  if (!claim.allowed) {
    console.log("[contact-submit] EMAIL_SKIPPED", {
      contactMessageId: inserted.id,
      dedupeKey,
      reason: claim.reason,
    });
    return new Response(JSON.stringify({ ok: true, id: inserted.id }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    await sendAdminEmail({
      resendApiKey,
      from: emailFrom,
      to: contactToEmail,
      record: {
        id: inserted.id as string,
        created_at: inserted.created_at as string,
        user_id: (inserted.user_id as string | null) ?? null,
        name: (inserted.name as string | null) ?? null,
        email: (inserted.email as string | null) ?? null,
        subject: inserted.subject as string,
        category: inserted.category as string,
        message: inserted.message as string,
        origin_page: (inserted.origin_page as string | null) ?? null,
        ip_address: (inserted.ip_address as string | null) ?? null,
        user_agent: (inserted.user_agent as string | null) ?? null,
      },
    });
    console.log("[contact-submit] EMAIL_SENT", { contactMessageId: inserted.id });
  } catch (error) {
    console.error("[contact-submit] EMAIL_SEND_ERROR", {
      contactMessageId: inserted.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new Response(JSON.stringify({ ok: true, id: inserted.id }), {
    status: 200,
    headers: corsHeaders,
  });
});
