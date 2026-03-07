import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey, x-supabase-auth, x-hcaptcha-token",
  "Content-Type": "application/json",
};

const DEFAULT_EMAIL_FROM = "onboarding@resend.dev";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SUBJECT = "Contact form submission";
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 120;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 5000;
const HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify";
const ALLOWED_FIELDS = new Set(["name", "email", "message"]);
const CONTACT_SUBMIT_RATE_LIMIT_RPC = "rpc_contact_submit_rate_limit";
const PRODUCTION_ENV_VALUES = new Set(["production", "prod"]);

type JsonObject = Record<string, unknown>;

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const runtimeEnv = (asNonEmptyString(Deno.env.get("ENV")) ??
  asNonEmptyString(Deno.env.get("NODE_ENV")) ??
  "development").toLowerCase();
const IS_PRODUCTION = PRODUCTION_ENV_VALUES.has(runtimeEnv);
const HCAPTCHA_SECRET = asNonEmptyString(Deno.env.get("HCAPTCHA_SECRET"));

if (IS_PRODUCTION && !HCAPTCHA_SECRET) {
  throw new Error("Missing HCAPTCHA_SECRET environment variable in production");
}

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

const isValidEmail = (value: string | null): value is string => {
  if (!value) return false;
  return EMAIL_REGEX.test(value);
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
      return false;
    }

    const result = await response.json() as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (result.success !== true) {
      console.warn("[contact-submit] CAPTCHA_VERIFY_FAILED", {
        errors: result["error-codes"] ?? [],
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("[contact-submit] CAPTCHA_VERIFY_UNEXPECTED_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

const enforceDbRateLimit = async (
  supabase: any,
  ipHash: string,
) => {
  const { data, error } = await supabase.rpc(CONTACT_SUBMIT_RATE_LIMIT_RPC, {
    p_ip_hash: ipHash,
  });

  if (error) {
    const message = asNonEmptyString(error.message) ?? "";
    const code = asNonEmptyString((error as { code?: unknown })?.code) ?? "";
    const isRateLimit = message.includes("rate_limit_exceeded") || code === "P0001";
    return {
      allowed: false as const,
      status: isRateLimit ? 429 : 500,
      error: isRateLimit ? "Too many requests" : "Rate limit unavailable",
    };
  }

  if (data !== true) {
    return {
      allowed: false as const,
      status: 429,
      error: "Too many requests",
    };
  }

  return { allowed: true as const };
};

const sendAdminEmail = async (params: {
  resendApiKey: string;
  from: string;
  to: string;
  record: {
    submitted_at: string;
    name: string;
    email: string;
    message: string;
    ip_hash: string | null;
    user_agent: string | null;
  };
}) => {
  const resend = new Resend(params.resendApiKey);
  const item = params.record;

  return await resend.emails.send({
    from: params.from,
    to: params.to,
    subject: "[Contact] Nouveau message",
    text: [
      `Submitted at: ${item.submitted_at}`,
      `Name: ${item.name}`,
      `Email: ${item.email}`,
      `IP hash: ${item.ip_hash ?? "-"}`,
      `User-Agent: ${item.user_agent ?? "-"}`,
      "",
      item.message,
    ].join("\n"),
    html: `
      <div lang="fr" style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:24px;color:#111">
        <h1 style="margin:0 0 14px;font-size:22px;">Nouveau message de contact</h1>
        <p style="margin:0 0 6px;"><strong>Soumis le:</strong> ${item.submitted_at}</p>
        <p style="margin:0 0 6px;"><strong>Nom:</strong> ${item.name}</p>
        <p style="margin:0 0 6px;"><strong>Email:</strong> ${item.email}</p>
        <p style="margin:0 0 6px;"><strong>IP hash:</strong> ${item.ip_hash ?? "-"}</p>
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

  const userAgent = asNonEmptyString(req.headers.get("user-agent"));
  const ipAddress = extractIpAddress(req);
  const ipHash = await sha256Hex(ipAddress ?? "unknown");

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

  const rateLimit = await enforceDbRateLimit(supabase, ipHash);
  if (!rateLimit.allowed) {
    console.warn("[contact-submit] RATE_LIMIT_BLOCK", {
      ip_hash: ipHash,
      userAgent,
    });
    return new Response(JSON.stringify({ error: rateLimit.error }), {
      status: rateLimit.status,
      headers: corsHeaders,
    });
  }

  const captchaRequired = IS_PRODUCTION || Boolean(HCAPTCHA_SECRET);
  if (captchaRequired) {
    const captchaToken = asNonEmptyString(req.headers.get("x-hcaptcha-token"));
    if (!captchaToken) {
      console.warn("[contact-submit] CAPTCHA_TOKEN_MISSING", {
        ip_hash: ipHash,
        userAgent,
      });
      return new Response(JSON.stringify({ error: "Captcha token required" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const captchaValid = await verifyCaptcha({
      secret: HCAPTCHA_SECRET as string,
      token: captchaToken,
      remoteIp: ipAddress,
    });

    if (!captchaValid) {
      console.warn("[contact-submit] CAPTCHA_BLOCK", {
        ip_hash: ipHash,
        userAgent,
      });
      return new Response(JSON.stringify({ error: "Captcha verification failed" }), {
        status: 403,
        headers: corsHeaders,
      });
    }
  }

  const payload = await req.json().catch(() => null) as JsonObject | null;
  if (!payload || Array.isArray(payload)) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const unsupportedFields = Object.keys(payload).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unsupportedFields.length > 0) {
    return new Response(
      JSON.stringify({ error: `Unsupported fields: ${unsupportedFields.join(", ")}` }),
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const name = asNonEmptyString(payload.name);
  const email = asNonEmptyString(payload.email)?.toLowerCase() ?? null;
  const message = asNonEmptyString(payload.message);

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

  if (!message || message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return new Response(JSON.stringify({
      error: `Message must be between ${MIN_MESSAGE_LENGTH} and ${MAX_MESSAGE_LENGTH} characters`,
    }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { error: insertError } = await supabase
    .from("contact_messages")
    .insert({
      user_id: null,
      name,
      email,
      subject: DEFAULT_SUBJECT,
      category: "support",
      message,
      origin_page: "/contact",
      user_agent: userAgent,
      ip_address: null,
    });

  if (insertError) {
    console.error("[contact-submit] INSERT_ERROR", { error: insertError.message });
    return new Response(JSON.stringify({ error: "Unable to submit message" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const resendApiKey = asNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  const contactToEmail = asNonEmptyString(Deno.env.get("CONTACT_TO_EMAIL"));
  const emailFrom = asNonEmptyString(Deno.env.get("EMAIL_FROM")) || DEFAULT_EMAIL_FROM;

  if (resendApiKey && contactToEmail) {
    try {
      await sendAdminEmail({
        resendApiKey,
        from: emailFrom,
        to: contactToEmail,
        record: {
          submitted_at: new Date().toISOString(),
          name,
          email,
          message,
          ip_hash: ipHash,
          user_agent: userAgent,
        },
      });
      console.log("[contact-submit] EMAIL_SENT");
    } catch (error) {
      console.error("[contact-submit] EMAIL_SEND_ERROR", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: corsHeaders,
  });
});
