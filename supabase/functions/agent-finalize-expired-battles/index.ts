import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const ALLOWED_CORS_ORIGINS = (() => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);
  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const n = normalizeOrigin(token.trim());
      if (n) allowed.add(n);
    }
  }
  return allowed;
})();

const buildCorsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? DEFAULT_ALLOWED_CORS_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret, x-agent-secret",
  "Vary": "Origin",
});

const resolveRequestCorsOrigin = (req: Request): string | null => {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  const n = normalizeOrigin(raw);
  return n && ALLOWED_CORS_ORIGINS.has(n) ? n : null;
};

function logInfo(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    function: "agent-finalize-expired-battles",
    level: "info",
    event,
    ...details,
  }));
}

function logError(event: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({
    function: "agent-finalize-expired-battles",
    level: "error",
    event,
    ...details,
  }));
}

serveWithErrorHandling("agent-finalize-expired-battles", async (req: Request) => {
  const corsHeaders = buildCorsHeaders(resolveRequestCorsOrigin(req));
  const jsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("AGENT_CRON_SECRET")?.trim() ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    logError("missing_supabase_runtime_config", {
      has_supabase_url: Boolean(supabaseUrl),
      has_service_role_key: Boolean(serviceRoleKey),
    });
    return jsonResponse({ error: "Server not configured" }, 500);
  }

  if (!cronSecret) {
    logError("missing_agent_cron_secret");
    return jsonResponse({ error: "AGENT_CRON_SECRET not configured" }, 500);
  }

  const providedSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || req.headers.get("x-cron-secret")?.trim()
    || req.headers.get("x-agent-secret")?.trim()
    || "";

  if (providedSecret !== cronSecret) {
    logError("unauthorized_request", {
      has_authorization_header: Boolean(req.headers.get("authorization")),
      has_x_cron_secret_header: Boolean(req.headers.get("x-cron-secret")),
      has_x_agent_secret_header: Boolean(req.headers.get("x-agent-secret")),
    });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Number.isFinite(body.limit) ? Number(body.limit) : 100;
  const normalizedLimit = Math.max(1, Math.min(500, limit));
  logInfo("request_validated", { limit: normalizedLimit });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("agent_finalize_expired_battles", {
    p_limit: normalizedLimit,
  });

  if (error) {
    logError("rpc_failed", { message: error.message, limit: normalizedLimit });
    return jsonResponse({ error: error.message }, 500);
  }

  logInfo("rpc_succeeded", { finalized: data ?? 0, limit: normalizedLimit });

  return jsonResponse({
    ok: true,
    finalized: data ?? 0,
    limit: normalizedLimit,
    model: "rule-based",
    supported_battle_types: ["user", "admin"],
  });
});
