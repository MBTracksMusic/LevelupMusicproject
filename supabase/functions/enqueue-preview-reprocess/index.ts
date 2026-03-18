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

const ENQUEUE_PREVIEW_REPROCESS_RATE_LIMIT_RPC = "enqueue_preview_reprocess";

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
  const authorizationHeader = req.headers.get("Authorization");
  if (!authorizationHeader) {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const supabaseAdmin = createAdminClient();
  const supabaseUser = createUserClient(authorizationHeader);
  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !authData.user) {
    console.error("[enqueue-preview-reprocess] invalid auth token", authError);
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[enqueue-preview-reprocess] failed to load profile", profileError);
    return { error: new Response(JSON.stringify({ error: "Failed to verify admin" }), { status: 500, headers: jsonHeaders }) };
  }

  if (!profile || profile.role !== "admin") {
    return { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders }) };
  }

  return { supabaseAdmin, userId: authData.user.id };
};

serveWithErrorHandling("enqueue-preview-reprocess", async (req: Request): Promise<Response> => {
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
        p_rpc_name: ENQUEUE_PREVIEW_REPROCESS_RATE_LIMIT_RPC,
      },
    );

    if (rateLimitError) {
      console.error("[enqueue-preview-reprocess] rate limit check failed", { userId, rateLimitError });
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

    console.log("[enqueue-preview-reprocess] enqueue requested", { userId });

    const { data, error } = await supabaseAdmin.rpc("enqueue_reprocess_all_previews");
    if (error) {
      console.error("[enqueue-preview-reprocess] rpc failed", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return new Response(JSON.stringify({
        error: "Failed to enqueue preview reprocess jobs",
        details: error.message,
      }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const { error: workerError } = await supabaseAdmin.functions.invoke("process-audio-jobs");
    if (workerError) {
      console.error("[enqueue-preview-reprocess] worker invoke failed", workerError);
    }

    const payload = (data ?? {}) as { enqueued_count?: number; skipped_count?: number };
    const enqueuedCount = Number.isFinite(payload.enqueued_count) ? Number(payload.enqueued_count) : 0;
    const skippedCount = Number.isFinite(payload.skipped_count) ? Number(payload.skipped_count) : 0;

    console.log("[enqueue-preview-reprocess] enqueue success", {
      userId,
      enqueuedCount,
      skippedCount,
    });

    return new Response(JSON.stringify({ enqueued_count: enqueuedCount, skipped_count: skippedCount }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[enqueue-preview-reprocess] unexpected error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
