import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-agent-secret",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("AGENT_CRON_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }

  if (cronSecret) {
    const providedSecret = req.headers.get("x-agent-secret")
      || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
      || "";

    if (providedSecret !== cronSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  let body: { limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Number.isFinite(body.limit) ? Number(body.limit) : 100;
  const normalizedLimit = Math.max(1, Math.min(500, limit));

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("agent_finalize_expired_battles", {
    p_limit: normalizedLimit,
  });

  if (error) {
    console.error("agent_finalize_expired_battles failed", error);
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({
    ok: true,
    finalized: data ?? 0,
    limit: normalizedLimit,
    model: "rule-based",
  });
});
