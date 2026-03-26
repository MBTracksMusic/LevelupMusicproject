import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireAdminUser } from "../_shared/auth.ts";
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
    const authContext = await requireAdminUser(req, corsHeaders);
    if ("error" in authContext) {
      return authContext.error;
    }

    const { supabaseAdmin, user } = authContext;
    const adminClient = supabaseAdmin as any;
    const userId = user.id;

    const { data: rateLimitAllowed, error: rateLimitError } = await adminClient.rpc(
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

    const { data: activeSettingsData, error: settingsError } = await adminClient
      .from("site_audio_settings")
      .select("id, watermark_audio_path")
      .eq("enabled", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const activeSettings = (activeSettingsData ?? null) as {
      id: string;
      watermark_audio_path: string | null;
    } | null;

    if (settingsError) {
      console.error("[enqueue-preview-reprocess] failed to load active site audio settings", {
        userId,
        settingsError,
      });
      return new Response(JSON.stringify({ error: "Failed to validate site audio settings" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const watermarkAudioPath = typeof activeSettings?.watermark_audio_path === "string"
      ? activeSettings.watermark_audio_path.trim()
      : "";

    if (!activeSettings?.id || watermarkAudioPath.length === 0) {
      return new Response(JSON.stringify({
        error: "Active watermark settings are required before preview reprocessing can be enqueued",
        code: "active_watermark_required",
      }), {
        status: 409,
        headers: jsonHeaders,
      });
    }

    console.log("[enqueue-preview-reprocess] enqueue requested", { userId });

    const { data, error } = await adminClient.rpc("enqueue_reprocess_all_previews");
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
