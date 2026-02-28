import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-supabase-auth",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

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
    console.log("[enqueue-preview-reprocess] enqueue requested", { userId });

    const { data, error } = await supabaseAdmin.rpc("enqueue_reprocess_all_previews");
    if (error) {
      console.error("[enqueue-preview-reprocess] rpc failed", error);
      return new Response(JSON.stringify({ error: "Failed to enqueue preview reprocess jobs" }), {
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
