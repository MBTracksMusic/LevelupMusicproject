import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createUserClient,
  extractBearerToken,
  requireAdminUser,
} from "../_shared/auth.ts";
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const asEmail = (value: unknown) => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  return text.toLowerCase();
};

type ResolvedUserRow = {
  id: string;
  username: string | null;
  email: string | null;
};

type UnassignCampaignRpcResult = {
  success: boolean;
  user_id: string;
  message: string;
};

type RpcErrorShape = {
  code?: string;
  message?: string | null;
};

type RpcCallResult<TData> = {
  data: TData | null;
  error: RpcErrorShape | null;
};

async function invokeRpc<TData>(
  client: ReturnType<typeof createUserClient>,
  functionName: string,
  args: Record<string, unknown>,
): Promise<RpcCallResult<TData>> {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<RpcCallResult<TData>>;

  return rpc(functionName, args);
}

serveWithErrorHandling("admin-unassign-campaign", async (req: Request): Promise<Response> => {
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

    const { supabaseAdmin } = authContext;

    const token = extractBearerToken(req);
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseUser = createUserClient(token);

    const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || Array.isArray(payload)) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const userId = asUuid(payload.user_id);
    const email = asEmail(payload.email);

    if (!userId && !email) {
      return new Response(JSON.stringify({ error: "Invalid or missing user_id/email" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    let resolvedUser: ResolvedUserRow | null = null;

    if (userId) {
      const { data: userData, error: userError } = await supabaseAdmin
        .from("user_profiles")
        .select("id, username, email")
        .eq("id", userId)
        .single();

      if (userError) {
        const normalizedMessage = userError.message.toLowerCase();
        if (userError.code === "PGRST116" || normalizedMessage.includes("0 rows")) {
          return new Response(JSON.stringify({ error: "user_not_found", message: "User not found" }), {
            status: 404,
            headers: jsonHeaders,
          });
        }

        console.error("[admin-unassign-campaign]", userError);
        return new Response(JSON.stringify({ error: "user_lookup_failed", message: "Unable to resolve user" }), {
          status: 500,
          headers: jsonHeaders,
        });
      }

      resolvedUser = userData as ResolvedUserRow;
    } else if (email) {
      const { data: userData, error: userError } = await supabaseAdmin
        .from("user_profiles")
        .select("id, username, email")
        .eq("email", email)
        .single();

      if (userError) {
        const normalizedMessage = userError.message.toLowerCase();
        if (userError.code === "PGRST116" || normalizedMessage.includes("0 rows")) {
          return new Response(JSON.stringify({ error: "user_not_found", message: "User not found" }), {
            status: 404,
            headers: jsonHeaders,
          });
        }

        console.error("[admin-unassign-campaign]", userError);
        return new Response(JSON.stringify({ error: "user_lookup_failed", message: "Unable to resolve user" }), {
          status: 500,
          headers: jsonHeaders,
        });
      }

      resolvedUser = userData as ResolvedUserRow;
    }

    if (!resolvedUser) {
      return new Response(JSON.stringify({ error: "user_not_found", message: "User not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const { data: result, error: rpcError } = await invokeRpc<UnassignCampaignRpcResult>(
      supabaseUser,
      "admin_unassign_producer_campaign",
      {
        p_user_id: resolvedUser.id,
      },
    );

    if (rpcError) {
      const message = rpcError.message ?? "RPC call failed";

      if (rpcError.code === "02000") {
        return new Response(JSON.stringify({ error: "user_not_found", message }), {
          status: 404,
          headers: jsonHeaders,
        });
      }

      if (rpcError.code === "42501") {
        return new Response(JSON.stringify({ error: "Forbidden", message }), {
          status: 403,
          headers: jsonHeaders,
        });
      }

      console.error("[admin-unassign-campaign]", rpcError);
      return new Response(JSON.stringify({ error: "rpc_error", message }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      result,
      resolved_user: {
        id: resolvedUser.id,
        username: resolvedUser.username,
        email: resolvedUser.email,
      },
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[admin-unassign-campaign]", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
