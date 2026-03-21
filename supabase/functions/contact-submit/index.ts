import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey, x-hcaptcha-token",
  "Content-Type": "application/json",
};

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const resolveAllowedCorsOrigins = () => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);

  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const normalized = normalizeOrigin(token.trim());
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  for (const envValue of [
    Deno.env.get("APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("VITE_APP_URL"),
  ]) {
    if (typeof envValue !== "string") continue;
    const normalized = normalizeOrigin(envValue.trim());
    if (normalized) {
      allowed.add(normalized);
    }
  }

  return allowed;
};

const ALLOWED_CORS_ORIGINS = resolveAllowedCorsOrigins();
const DEFAULT_CORS_ORIGIN = DEFAULT_ALLOWED_CORS_ORIGINS[0];

const resolveRequestOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  return ALLOWED_CORS_ORIGINS.has(normalized) ? normalized : null;
};

const buildCorsHeaders = (origin: string | null) => ({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": origin ?? DEFAULT_CORS_ORIGIN,
  "Vary": "Origin",
});

// Required server env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - HCAPTCHA_SECRET_KEY (preferred) or HCAPTCHA_SECRET (legacy fallback)
// Optional email notification env vars:
// - CONTACT_TO_EMAIL
const DEFAULT_SUBJECT = "Contact request";
const HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify";
const CONTACT_SUBMIT_LOG_TABLE = "contact_submit_log";
const FALLBACK_UNKNOWN_IP_BUCKET = "__unknown_ip__";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MIN_SUBJECT_LENGTH = 3;
const MAX_SUBJECT_LENGTH = 120;
const MIN_MESSAGE_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 5000;
const MIN_HUMAN_SUBMISSION_DELAY_MS = 1500;

const DUPLICATE_WINDOW_MINUTES = 10;

const ALLOWED_FIELDS = new Set([
  "name",
  "email",
  "subject",
  "category",
  "message",
  "honeypot",
  "website",
  "company",
  "hp",
  "captcha_token",
  "hcaptcha_token",
  "hcaptchaToken",
  "captchaToken",
  "form_started_at",
  "started_at",
]);

const PLACEHOLDER_VALUES = new Set([
  "test",
  "testing",
  "hello",
  "bonjour",
  "coucou",
  "none",
  "n/a",
  "na",
  "-",
  "...",
  "lorem ipsum",
]);

const CONTACT_CATEGORIES = new Set([
  "support",
  "battle",
  "payment",
  "partnership",
  "other",
]);

type JsonObject = Record<string, unknown>;
type ContactLogStatus = "accepted" | "rejected";
type SupabaseAdminClient = any;

type ContactSubmitLogRow = {
  ip_address: string | null;
  email_hash: string | null;
  submission_hash: string | null;
  user_agent: string | null;
  subject: string | null;
  status: ContactLogStatus;
  reason: string | null;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeContactCategory = (value: unknown) => {
  const category = asNonEmptyString(value)?.toLowerCase();
  if (!category) return "support";
  return CONTACT_CATEGORIES.has(category) ? category : null;
};

const DEFAULT_ALLOWED_CAPTCHA_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "dev.beatelion.local",
  "beatelion.com",
  "www.beatelion.com",
];

const normalizeHostname = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fromUrl = (() => {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return null;
    }
  })();
  const candidate = (fromUrl ?? trimmed).toLowerCase().replace(/\.$/, "");

  if (candidate.includes(":") && !candidate.includes("[")) {
    return candidate.split(":")[0] ?? null;
  }

  return candidate;
};

const resolveAllowedCaptchaHostnames = () => {
  const allowed = new Set<string>(
    DEFAULT_ALLOWED_CAPTCHA_HOSTNAMES
      .map((value) => normalizeHostname(value))
      .filter((value): value is string => Boolean(value)),
  );

  const csv = asNonEmptyString(Deno.env.get("HCAPTCHA_ALLOWED_HOSTNAMES"));
  if (csv) {
    for (const token of csv.split(",")) {
      const normalized = normalizeHostname(token);
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }

  return allowed;
};

const ALLOWED_CAPTCHA_HOSTNAMES = resolveAllowedCaptchaHostnames();

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeEmail = (value: unknown) => {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  return raw.toLowerCase();
};

const normalizeForFingerprint = (value: string) => normalizeWhitespace(value).toLowerCase();

const isValidEmail = (value: string | null): value is string => {
  if (!value) return false;
  return EMAIL_REGEX.test(value);
};

const escapeHtml = (value: string) => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const stripControlChars = (
  value: string,
  options?: { preserveLineBreaks?: boolean },
) => {
  let sanitized = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const code = value.charCodeAt(index);
    const isControl = code < 32 || code === 127;

    if (!isControl) {
      sanitized += char;
      continue;
    }

    if (options?.preserveLineBreaks && (code === 10 || code === 13)) {
      sanitized += char;
    }
  }

  return sanitized;
};

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ");

const sanitizeSingleLineField = (value: string) =>
  normalizeWhitespace(stripHtmlTags(stripControlChars(value)));

const sanitizeMessageField = (value: string) =>
  stripHtmlTags(
    stripControlChars(value, { preserveLineBreaks: true }).replace(/\r\n?/g, "\n"),
  ).trim();

const containsHeaderInjectionPattern = (value: string | null) => {
  if (!value) return false;
  return /(?:\r|\n|%0a|%0d|(?:^|[\s,;])(?:bcc|cc|to|content-type|mime-version)\s*:)/i.test(value);
};

const normalizeIpAddress = (value: string): string | null => {
  let candidate = value.trim();
  if (!candidate) return null;

  candidate = candidate.replace(/^for=/i, "").replace(/^"(.+)"$/, "$1").trim();

  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  }

  if (candidate.includes(".") && candidate.includes(":")) {
    const maybeIpv4 = candidate.split(":")[0]?.trim();
    if (maybeIpv4 && maybeIpv4.includes(".")) {
      candidate = maybeIpv4;
    }
  }

  candidate = candidate.toLowerCase().replace(/%[a-z0-9._-]+$/i, "");

  if (!candidate || candidate === "unknown") return null;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    const parts = candidate.split(".").map((part) => Number(part));
    if (parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return candidate;
    }
    return null;
  }

  if (candidate.includes(":") && /^[0-9a-f:]+$/i.test(candidate)) {
    return candidate;
  }

  return null;
};

const extractIpAddress = (req: Request): string | null => {
  const candidateHeaders = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-forwarded-for"),
    req.headers.get("x-real-ip"),
  ];

  for (const rawValue of candidateHeaders) {
    const clean = asNonEmptyString(rawValue);
    if (!clean) continue;

    const first = clean.split(",")[0]?.trim();
    if (!first) continue;

    const normalized = normalizeIpAddress(first);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const verifyCaptcha = async (params: {
  secret: string;
  token: string;
  remoteIp: string | null;
}) => {
  const body = new URLSearchParams({
    secret: params.secret,
    response: params.token,
  });

  if (params.remoteIp) {
    body.set("remoteip", params.remoteIp);
  }

  try {
    const response = await fetch(HCAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      console.error("[contact-submit] CAPTCHA_VERIFY_HTTP_ERROR", {
        status: response.status,
      });
      return { ok: false as const, reason: "captcha_http_error" as const };
    }

    const result = await response.json() as {
      success?: boolean;
      hostname?: string;
      "error-codes"?: string[];
    };
    const hostname = normalizeHostname(asNonEmptyString(result.hostname) ?? "");

    if (result.success !== true) {
      console.warn("[contact-submit] CAPTCHA_VERIFY_FAILED", {
        errors: result["error-codes"] ?? [],
      });
      return { ok: false as const, reason: "captcha_verify_failed" as const, hostname };
    }

    if (!hostname || !ALLOWED_CAPTCHA_HOSTNAMES.has(hostname)) {
      console.warn("[contact-submit] CAPTCHA_HOSTNAME_REJECTED", {
        hostname,
        allowed: [...ALLOWED_CAPTCHA_HOSTNAMES],
      });
      return { ok: false as const, reason: "captcha_hostname_rejected" as const, hostname };
    }

    return { ok: true as const, hostname };
  } catch (error) {
    console.error("[contact-submit] CAPTCHA_VERIFY_UNEXPECTED_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false as const, reason: "captcha_unexpected_error" as const };
  }
};

const parseSubmissionStartMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const parsedNumber = Number(trimmed);
      if (Number.isFinite(parsedNumber)) {
        return parsedNumber;
      }
    }

    const parsedDate = Date.parse(trimmed);
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return null;
};

const extractCaptchaToken = (req: Request, payload: JsonObject | null) => {
  const candidates: unknown[] = [
    req.headers.get("x-hcaptcha-token"),
    payload?.captcha_token,
    payload?.hcaptcha_token,
    payload?.hcaptchaToken,
    payload?.captchaToken,
  ];

  for (const candidate of candidates) {
    const token = asNonEmptyString(candidate);
    if (token) return token;
  }

  return null;
};

const hasFilledHoneypot = (payload: JsonObject | null) => {
  if (!payload) return false;

  const honeypotKeys = ["honeypot", "website", "company", "hp"];
  return honeypotKeys.some((key) => {
    const value = payload[key];
    return asNonEmptyString(value) !== null;
  });
};

const isLikelyPlaceholder = (value: string) => {
  return PLACEHOLDER_VALUES.has(normalizeForFingerprint(value));
};

const insertContactSubmitLog = async (
  supabase: SupabaseAdminClient,
  row: ContactSubmitLogRow,
) => {
  const { error } = await supabase
    .from(CONTACT_SUBMIT_LOG_TABLE)
    .insert(row as never);

  if (error) {
    throw new Error(`contact_submit_log_insert_failed:${error.message}`);
  }
};

const insertRejectedLogBestEffort = async (
  supabase: SupabaseAdminClient,
  row: Omit<ContactSubmitLogRow, "status">,
) => {
  try {
    await insertContactSubmitLog(supabase, {
      ...row,
      status: "rejected",
    });
  } catch (error) {
    console.error("[contact-submit] CONTACT_LOG_REJECTED_INSERT_FAILED", {
      reason: row.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const hasRecentDuplicateSubmission = async (
  supabase: SupabaseAdminClient,
  submissionHash: string,
) => {
  const sinceIso = new Date(Date.now() - (DUPLICATE_WINDOW_MINUTES * 60 * 1000)).toISOString();
  const { data, error } = await supabase
    .from(CONTACT_SUBMIT_LOG_TABLE)
    .select("id")
    .eq("status", "accepted")
    .eq("submission_hash", submissionHash)
    .gte("created_at", sinceIso)
    .limit(1);

  if (error) {
    throw new Error(`contact_submit_log_duplicate_check_failed:${error.message}`);
  }

  return Array.isArray(data) && data.length > 0;
};

serveWithErrorHandling("contact-submit", async (req: Request) => {
  const requestOriginHeader = req.headers.get("origin");
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);

  if (requestOriginHeader && !requestOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = asNonEmptyString(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = asNonEmptyString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const anonKey = asNonEmptyString(Deno.env.get("SUPABASE_ANON_KEY"));
  const captchaSecret = asNonEmptyString(Deno.env.get("HCAPTCHA_SECRET_KEY"))
    ?? asNonEmptyString(Deno.env.get("HCAPTCHA_SECRET"));

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  if (!captchaSecret) {
    console.error("[contact-submit] CAPTCHA_CONFIG_ERROR", {
      hasCaptchaSecret: false,
    });
    return new Response(JSON.stringify({ error: "Captcha configuration error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorizationHeader = asNonEmptyString(req.headers.get("authorization"))
    ?? asNonEmptyString(req.headers.get("Authorization"));
  let authenticatedUser: { id: string; email: string | null } | null = null;

  const userClientKey = anonKey ?? serviceRoleKey;
  if (authorizationHeader) {
    const supabaseUser = createClient(supabaseUrl, userClientKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: authorizationHeader,
        },
      },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (!userError && userData.user) {
      authenticatedUser = {
        id: userData.user.id,
        email: asNonEmptyString(userData.user.email),
      };
    }
  }

  const userAgent = asNonEmptyString(req.headers.get("user-agent"));
  const ipAddress = extractIpAddress(req);
  const ipAddressBucket = ipAddress ?? FALLBACK_UNKNOWN_IP_BUCKET;
  const ipHash = await sha256Hex(ipAddressBucket);

  const payload = await req.json().catch(() => null) as JsonObject | null;
  if (!payload || Array.isArray(payload)) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const unsupportedFields = Object.keys(payload).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unsupportedFields.length > 0) {
    await insertRejectedLogBestEffort(supabase, {
      ip_address: ipAddressBucket,
      email_hash: null,
      submission_hash: null,
      user_agent: userAgent,
      subject: null,
      reason: "unsupported_fields",
    });

    return new Response(
      JSON.stringify({ error: `Unsupported fields: ${unsupportedFields.join(", ")}` }),
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  if (hasFilledHoneypot(payload)) {
    await insertRejectedLogBestEffort(supabase, {
      ip_address: ipAddressBucket,
      email_hash: null,
      submission_hash: null,
      user_agent: userAgent,
      subject: null,
      reason: "honeypot_triggered",
    });

    return new Response(JSON.stringify({ error: "Invalid submission" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const submissionStartedAt = parseSubmissionStartMs(payload.form_started_at ?? payload.started_at);
  if (submissionStartedAt !== null) {
    const elapsedMs = Date.now() - submissionStartedAt;
    if (!Number.isFinite(elapsedMs) || elapsedMs < MIN_HUMAN_SUBMISSION_DELAY_MS) {
      await insertRejectedLogBestEffort(supabase, {
        ip_address: ipAddressBucket,
        email_hash: null,
        submission_hash: null,
        user_agent: userAgent,
        subject: null,
        reason: "submission_too_fast",
      });

      return new Response(JSON.stringify({ error: "Submission too fast" }), {
        status: 400,
        headers: corsHeaders,
      });
    }
  }

  try {
    const { error: rateLimitError } = await supabase.rpc("rpc_contact_submit_rate_limit", {
      p_ip_hash: ipHash,
    });

    if (rateLimitError) {
      const normalizedMessage = rateLimitError.message.toLowerCase();
      if (normalizedMessage.includes("rate_limit_exceeded")) {
        await insertRejectedLogBestEffort(supabase, {
          ip_address: ipAddressBucket,
          email_hash: null,
          submission_hash: null,
          user_agent: userAgent,
          subject: null,
          reason: "rpc_rate_limit_exceeded",
        });

        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: corsHeaders,
        });
      }

      throw new Error(`rpc_contact_submit_rate_limit_failed:${rateLimitError.message}`);
    }
  } catch (error) {
    console.error("[contact-submit] ATTEMPT_RATE_LIMIT_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const captchaToken = extractCaptchaToken(req, payload);
  if (!captchaToken) {
    await insertRejectedLogBestEffort(supabase, {
      ip_address: ipAddressBucket,
      email_hash: null,
      submission_hash: null,
      user_agent: userAgent,
      subject: null,
      reason: "captcha_missing",
    });

    return new Response(JSON.stringify({ error: "Missing captcha token" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const captchaResult = await verifyCaptcha({
    secret: captchaSecret,
    token: captchaToken,
    remoteIp: ipAddress,
  });

  if (!captchaResult.ok) {
    await insertRejectedLogBestEffort(supabase, {
      ip_address: ipAddressBucket,
      email_hash: null,
      submission_hash: null,
      user_agent: userAgent,
      subject: null,
      reason: captchaResult.reason,
    });

    return new Response(JSON.stringify({ error: "Captcha verification failed" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  const nameRaw = asNonEmptyString(payload.name);
  const email = authenticatedUser
    ? normalizeEmail(authenticatedUser.email)
    : normalizeEmail(payload.email);
  const subjectRaw = asNonEmptyString(payload.subject) ?? DEFAULT_SUBJECT;
  const messageRaw = asNonEmptyString(payload.message);

  if (
    containsHeaderInjectionPattern(nameRaw) ||
    containsHeaderInjectionPattern(subjectRaw) ||
    containsHeaderInjectionPattern(email)
  ) {
    await insertRejectedLogBestEffort(supabase, {
      ip_address: ipAddressBucket,
      email_hash: email ? await sha256Hex(email) : null,
      submission_hash: null,
      user_agent: userAgent,
      subject: subjectRaw ? sanitizeSingleLineField(subjectRaw) : null,
      reason: "header_injection_pattern",
    });

    return new Response(JSON.stringify({ error: "Invalid submission content" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const name = nameRaw ? sanitizeSingleLineField(nameRaw) : null;
  const subject = sanitizeSingleLineField(subjectRaw);
  const category = normalizeContactCategory(payload.category);
  const message = messageRaw ? sanitizeMessageField(messageRaw) : null;

  if (!name || name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    return new Response(JSON.stringify({
      error: `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters`,
    }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: "Invalid email format" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (subject.length < MIN_SUBJECT_LENGTH || subject.length > MAX_SUBJECT_LENGTH) {
    return new Response(JSON.stringify({
      error: `Subject must be between ${MIN_SUBJECT_LENGTH} and ${MAX_SUBJECT_LENGTH} characters`,
    }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!category) {
    return new Response(JSON.stringify({ error: "Invalid category" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (!message || message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return new Response(JSON.stringify({
      error: `Message must be between ${MIN_MESSAGE_LENGTH} and ${MAX_MESSAGE_LENGTH} characters`,
    }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (isLikelyPlaceholder(name) || isLikelyPlaceholder(subject) || isLikelyPlaceholder(message)) {
    await insertRejectedLogBestEffort(supabase, {
      ip_address: ipAddressBucket,
      email_hash: await sha256Hex(email),
      submission_hash: null,
      user_agent: userAgent,
      subject,
      reason: "placeholder_content",
    });

    return new Response(JSON.stringify({ error: "Invalid message content" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const emailHash = await sha256Hex(email);
  const submissionFingerprintBase = [
    normalizeForFingerprint(email),
    normalizeForFingerprint(subject),
    normalizeForFingerprint(message),
  ].join("||");
  const submissionHash = await sha256Hex(submissionFingerprintBase);

  try {
    const duplicateDetected = await hasRecentDuplicateSubmission(supabase, submissionHash);
    if (duplicateDetected) {
      await insertRejectedLogBestEffort(supabase, {
        ip_address: ipAddressBucket,
        email_hash: emailHash,
        submission_hash: submissionHash,
        user_agent: userAgent,
        subject,
        reason: "duplicate_submission",
      });

      return new Response(JSON.stringify({ error: "Duplicate submission detected" }), {
        status: 409,
        headers: corsHeaders,
      });
    }

    const { data: insertedMessage, error: insertError } = await supabase
      .from("contact_messages")
      .insert({
        user_id: authenticatedUser?.id ?? null,
        name,
        email,
        subject,
        category,
        message,
        origin_page: "/contact",
        user_agent: userAgent,
        ip_address: ipAddress,
      })
      .select("id")
      .single();

    if (insertError || !insertedMessage?.id) {
      console.error("[contact-submit] INSERT_ERROR", {
        error: insertError?.message ?? "missing_inserted_message_id",
      });
      return new Response(JSON.stringify({ error: "Unable to submit message" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    try {
      await insertContactSubmitLog(supabase, {
        ip_address: ipAddressBucket,
        email_hash: emailHash,
        submission_hash: submissionHash,
        user_agent: userAgent,
        subject,
        status: "accepted",
        reason: "accepted",
      });
    } catch (error) {
      console.error("[contact-submit] CONTACT_LOG_ACCEPTED_INSERT_FAILED", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const contactToEmail = asNonEmptyString(Deno.env.get("CONTACT_TO_EMAIL"));
    if (contactToEmail) {
      const { error: enqueueEmailError } = await supabase
        .from("email_queue")
        .insert({
          user_id: null,
          email: contactToEmail,
          template: "contact_admin_notification",
          payload: {
            submitted_at: new Date().toISOString(),
            name,
            email,
            subject,
            category,
            message,
            ip_hash: ipHash,
            user_agent: userAgent,
            source: "contact-submit",
          },
          status: "pending",
        });

      if (enqueueEmailError) {
        console.error("[contact-submit] EMAIL_QUEUE_ENQUEUE_ERROR", {
          error: enqueueEmailError.message,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("[contact-submit] SECURITY_CHECK_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
