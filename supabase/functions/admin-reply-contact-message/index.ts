import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const DEFAULT_CORS_ORIGIN = DEFAULT_ALLOWED_CORS_ORIGINS[0];

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

const resolveRequestOrigin = (req: Request) => {
  const rawOrigin = req.headers.get("origin");
  if (!rawOrigin) return null;
  const normalized = normalizeOrigin(rawOrigin);
  if (!normalized) return null;
  return ALLOWED_CORS_ORIGINS.has(normalized) ? normalized : null;
};

const buildCorsHeaders = (origin: string | null) => ({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": origin ?? DEFAULT_CORS_ORIGIN,
  "Vary": "Origin",
});

const ADMIN_REPLY_RATE_LIMIT_RPC = "admin_reply_contact_message";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_STATUS = new Set(["new", "in_progress", "closed"]);
const MIN_REPLY_LENGTH = 3;
const MAX_REPLY_LENGTH = 5000;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asUuid = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text || !UUID_RE.test(text)) return null;
  return text;
};

const normalizeEmail = (value: unknown) => {
  const email = asNonEmptyString(value);
  if (!email) return null;
  const lowered = email.toLowerCase();
  return EMAIL_RE.test(lowered) ? lowered : null;
};

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const createAdminClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const createUserClient = (authorizationHeader: string) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase auth env vars");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
  });
};

const requireAdmin = async (req: Request) => {
  const authorizationHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authorizationHeader) {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const supabaseAdmin = createAdminClient();
  const supabaseUser = createUserClient(authorizationHeader);
  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    console.error("[admin-reply-contact-message] invalid auth token", authError);
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[admin-reply-contact-message] failed to load profile", profileError);
    return { error: new Response(JSON.stringify({ error: "Failed to verify admin" }), { status: 500, headers: jsonHeaders }) };
  }

  if (!profile || profile.role !== "admin") {
    return { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders }) };
  }

  return { supabaseAdmin, userId: authData.user.id };
};

serveWithErrorHandling("admin-reply-contact-message", async (req: Request): Promise<Response> => {
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);
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

  try {
    const authContext = await requireAdmin(req);
    if ("error" in authContext) {
      return authContext.error as Response;
    }

    const { supabaseAdmin, userId } = authContext;

    const { data: rateLimitAllowed, error: rateLimitError } = await supabaseAdmin.rpc(
      "check_rpc_rate_limit",
      {
        p_user_id: userId,
        p_rpc_name: ADMIN_REPLY_RATE_LIMIT_RPC,
      },
    );

    if (rateLimitError) {
      console.error("[admin-reply-contact-message] rate limit check failed", { userId, rateLimitError });
      return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!rateLimitAllowed) {
      return new Response(JSON.stringify({ error: "Too many requests", code: "rate_limit_exceeded" }), {
        status: 429,
        headers: jsonHeaders,
      });
    }

    const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || Array.isArray(payload)) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const messageId = asUuid(payload.message_id);
    const reply = asNonEmptyString(payload.reply);
    const requestedStatusRaw = asNonEmptyString(payload.status);
    const requestedStatus = requestedStatusRaw && ALLOWED_STATUS.has(requestedStatusRaw)
      ? requestedStatusRaw
      : null;

    if (!messageId) {
      return new Response(JSON.stringify({ error: "Invalid message_id" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!reply || reply.length < MIN_REPLY_LENGTH || reply.length > MAX_REPLY_LENGTH) {
      return new Response(JSON.stringify({ error: "Reply length is invalid" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const safeReply = escapeHtml(reply);

    if (requestedStatusRaw && !requestedStatus) {
      return new Response(JSON.stringify({ error: "Invalid status" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: messageRow, error: messageError } = await supabaseAdmin
      .from("contact_messages")
      .select("id, email, subject, status, name")
      .eq("id", messageId)
      .maybeSingle();

    if (messageError) {
      console.error("[admin-reply-contact-message] failed to load message", messageError);
      return new Response(JSON.stringify({ error: "Unable to load message" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!messageRow) {
      return new Response(JSON.stringify({ error: "Message not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const recipientEmail = normalizeEmail(messageRow.email);
    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: "Message recipient email is missing or invalid" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: insertedReply, error: insertReplyError } = await supabaseAdmin
      .from("message_replies")
      .insert({
        message_id: messageId,
        admin_id: userId,
        reply: safeReply,
      })
      .select("id, created_at")
      .single();

    if (insertReplyError || !insertedReply?.id) {
      console.error("[admin-reply-contact-message] failed to insert reply", insertReplyError);
      return new Response(JSON.stringify({ error: "Unable to save reply" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const statusToPersist = requestedStatus ?? messageRow.status;

    if (requestedStatus && requestedStatus !== messageRow.status) {
      const { error: updateStatusError } = await supabaseAdmin
        .from("contact_messages")
        .update({
          status: requestedStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId);

      if (updateStatusError) {
        console.error("[admin-reply-contact-message] failed to update status", updateStatusError);
        return new Response(JSON.stringify({ error: "Unable to update message status" }), {
          status: 500,
          headers: jsonHeaders,
        });
      }
    }

    const queuePayload = {
      contact_message_id: messageId,
      message_reply_id: insertedReply.id,
      name: messageRow.name,
      subject: messageRow.subject,
      reply: safeReply,
      status: statusToPersist,
      replied_at: insertedReply.created_at,
      admin_id: userId,
      source: "admin-reply-contact-message",
    };

    const { error: enqueueError } = await supabaseAdmin
      .from("email_queue")
      .insert({
        user_id: null,
        email: recipientEmail,
        template: "contact_reply",
        payload: queuePayload,
        status: "pending",
      });

    if (enqueueError) {
      console.error("[admin-reply-contact-message] failed to enqueue email", enqueueError);

      const { error: rollbackError } = await supabaseAdmin
        .from("message_replies")
        .delete()
        .eq("id", insertedReply.id);

      if (rollbackError) {
        console.error("[admin-reply-contact-message] failed to rollback reply after enqueue error", rollbackError);
      }

      return new Response(JSON.stringify({ error: "Unable to enqueue email reply" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      reply_id: insertedReply.id,
      status: statusToPersist,
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[admin-reply-contact-message] unexpected error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
