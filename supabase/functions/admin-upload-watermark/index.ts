import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-supabase-auth",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const WATERMARK_BUCKET = (Deno.env.get("SUPABASE_WATERMARK_ASSETS_BUCKET") || "watermark-assets").trim() || "watermark-assets";
const FIXED_WATERMARK_PATH = "global-watermark.mp3";
const ALLOWED_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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

const requireAdmin = async (req: Request) => {
  const rawAuthHeader = req.headers.get("x-supabase-auth") || req.headers.get("Authorization");
  const jwt = rawAuthHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const supabaseAdmin = createAdminClient();
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(jwt);
  if (authError || !authData.user) {
    console.error("[admin-upload-watermark] invalid auth token", authError);
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders }) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[admin-upload-watermark] failed to load profile", profileError);
    return { error: new Response(JSON.stringify({ error: "Failed to verify admin" }), { status: 500, headers: jsonHeaders }) };
  }

  if (!profile || profile.role !== "admin") {
    return { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders }) };
  }

  return { supabaseAdmin, userId: authData.user.id };
};

const cleanupLegacyWatermarks = async (supabaseAdmin: ReturnType<typeof createAdminClient>) => {
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
    .map((name) => `admin/${name}`);

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

Deno.serve(async (req: Request): Promise<Response> => {
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

    const storagePath = FIXED_WATERMARK_PATH;

    console.log("[admin-upload-watermark] uploading", {
      userId,
      bucket: WATERMARK_BUCKET,
      storagePath,
      contentType: file.type,
      size: file.size,
    });

    const { error: uploadError } = await supabaseAdmin.storage.from(WATERMARK_BUCKET).upload(storagePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: "audio/mpeg",
    });

    if (uploadError) {
      console.error("[admin-upload-watermark] upload failed", uploadError);
      return new Response(JSON.stringify({ error: "Failed to upload watermark asset" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const { data: existingSettings, error: existingSettingsError } = await supabaseAdmin
      .from("site_audio_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (existingSettingsError) {
      console.error("[admin-upload-watermark] failed to load settings", existingSettingsError);
      return new Response(JSON.stringify({ error: "Failed to load site audio settings" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const payload = {
      watermark_audio_path: FIXED_WATERMARK_PATH,
      updated_at: new Date().toISOString(),
    };

    const settingsQuery = existingSettings
      ? supabaseAdmin
          .from("site_audio_settings")
          .update(payload)
          .eq("id", existingSettings.id)
      : supabaseAdmin
          .from("site_audio_settings")
          .insert({ ...payload, enabled: true, gain_db: -10, min_interval_sec: 20, max_interval_sec: 45 });

    const { data: updatedSettings, error: updateError } = await settingsQuery
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
      storagePath: FIXED_WATERMARK_PATH,
      settingsId: updatedSettings?.id ?? null,
    });

    return new Response(JSON.stringify({ path: FIXED_WATERMARK_PATH, settings: updatedSettings ?? null }), {
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
