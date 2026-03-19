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

const WATERMARK_BUCKET = "watermark-assets";
const FIXED_WATERMARK_PATH = "admin/global-watermark.wav";
const ALLOWED_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const cleanupLegacyWatermarks = async (supabaseAdmin: any) => {
  const { data, error } = await supabaseAdmin.storage.from(WATERMARK_BUCKET).list("admin", {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) {
    console.error("[admin-upload-watermark] failed to list legacy watermark assets", error);
    return;
  }

  const legacyPaths = (data ?? [])
    .map((entry) => entry.name?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => `admin/${name}`)
    .filter((path) => path !== FIXED_WATERMARK_PATH);

  if (legacyPaths.length === 0) {
    return;
  }

  const { error: deleteError } = await supabaseAdmin.storage.from(WATERMARK_BUCKET).remove(legacyPaths);
  if (deleteError) {
    console.error("[admin-upload-watermark] failed to cleanup legacy watermark assets", {
      deleteError,
      legacyPaths,
    });
  }
};

serveWithErrorHandling("admin-upload-watermark", async (req: Request): Promise<Response> => {
  const requestOriginHeader = req.headers.get("origin");
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (requestOriginHeader && !requestOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: jsonHeaders,
    });
  }

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
    const authResult = await requireAdminUser(req, corsHeaders);
    if ("error" in authResult) return authResult.error;
    const { supabaseAdmin, user } = authResult;
    const userId = user.id;
    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return new Response(JSON.stringify({ error: "Invalid form-data body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing file" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return new Response(JSON.stringify({ error: "Unsupported audio format" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return new Response(JSON.stringify({ error: "File too large" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const filePath = FIXED_WATERMARK_PATH;
    const fileBuffer = await file.arrayBuffer();

    console.log("[admin-upload-watermark] uploading", {
      userId,
      bucket: WATERMARK_BUCKET,
      storagePath: filePath,
      contentType: file.type,
      size: file.size,
    });

    const { error } = await supabaseAdmin.storage.from("watermark-assets").upload(filePath, fileBuffer, {
      contentType: "audio/wav",
      upsert: true,
    });

    if (error) {
      console.error("UPLOAD WATERMARK ERROR:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const { data: activeSettings, error: activeSettingsError } = await supabaseAdmin
      .from("site_audio_settings")
      .select("id")
      .eq("enabled", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSettingsError) {
      console.error("[admin-upload-watermark] failed to load active settings", activeSettingsError);
      return new Response(JSON.stringify({ error: "Failed to load site audio settings" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!activeSettings) {
      return new Response(JSON.stringify({ error: "No active site audio settings found" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const { data: updatedSettings, error: updateError } = await supabaseAdmin
      .from("site_audio_settings")
      .update({
        watermark_audio_path: filePath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeSettings.id)
      .select("id, enabled, watermark_audio_path, gain_db, min_interval_sec, max_interval_sec, updated_at, created_at")
      .maybeSingle();

    if (updateError) {
      console.error("[admin-upload-watermark] failed to persist settings", updateError);
      return new Response(JSON.stringify({ error: "Failed to update site audio settings" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    await cleanupLegacyWatermarks(supabaseAdmin);

    console.log("[admin-upload-watermark] success", {
      userId,
      storagePath: filePath,
      settingsId: updatedSettings?.id ?? null,
    });

    return new Response(JSON.stringify({ path: filePath, settings: updatedSettings ?? null }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[admin-upload-watermark] unexpected error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
