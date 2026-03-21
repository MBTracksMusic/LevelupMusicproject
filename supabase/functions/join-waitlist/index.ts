import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCorsHeaders } from "../_shared/cors.ts";

type JoinWaitlistBody = {
  email?: unknown;
};

type JoinWaitlistResponse =
  | { message: "success" }
  | { message: "already_registered" }
  | { error: "invalid_email" | "method_not_allowed" | "server_error" };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "Beatelion <noreply@beatelion.com>";

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

const sendResendEmail = async (email: string): Promise<boolean> => {
  const resendApiKey = asNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  if (!resendApiKey) {
    return false;
  }

  const from = asNonEmptyString(Deno.env.get("RESEND_FROM_EMAIL")) || DEFAULT_FROM_EMAIL;
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "🎧 Tu es sur la waitlist",
      html: "<h1>Bienvenue 🚀</h1><p>Tu seras informé du lancement.</p>",
    }),
  });

  return response.ok;
};

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = resolveCorsHeaders(req.headers.get("origin"));

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

    if (!email || !email.includes("@") || !EMAIL_REGEX.test(email)) {
      return jsonResponse({ error: "invalid_email" }, 400, corsHeaders);
    }

    // TODO: integrate shared rate limiting / CAPTCHA before public launch.

    const { error: insertError } = await adminClient
      .from("waitlist")
      .insert({ email });

    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse({ message: "already_registered" }, 200, corsHeaders);
      }

      return jsonResponse({ error: "server_error" }, 500, corsHeaders);
    }

    try {
      const emailSent = await sendResendEmail(email);
      if (!emailSent) {
        // TODO: report waitlist confirmation email failures to monitoring.
      }
    } catch {
      // TODO: report waitlist confirmation email failures to monitoring.
    }

    return jsonResponse({ message: "success" }, 200, corsHeaders);
  } catch {
    return jsonResponse({ error: "server_error" }, 500, corsHeaders);
  }
});
