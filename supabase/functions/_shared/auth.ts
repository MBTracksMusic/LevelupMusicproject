import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupabaseAdmin = ReturnType<typeof createClient>;

export type AuthUser = { id: string; email: string | null };

export type AuthSuccess = {
  user: AuthUser;
  supabaseAdmin: SupabaseAdmin;
};

export type AuthError = {
  error: Response;
};

export type AuthResult = AuthSuccess | AuthError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createAdminClient(): SupabaseAdmin {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Extracts the raw JWT from an "Authorization: Bearer <token>" header.
 * Returns null if the header is absent or does not match the pattern.
 * Case-insensitive "Bearer" prefix per RFC 6750.
 */
function extractBearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function makeErrorResponse(
  corsHeaders: Record<string, string>,
  payload: unknown,
  status: number,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates the Bearer JWT and returns the authenticated user + a service-role
 * admin client for use in the calling handler.
 *
 * Error responses are built with the provided corsHeaders so they carry the
 * correct Access-Control-Allow-Origin for the calling request.
 */
export async function requireAuthUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthResult> {
  const token = extractBearerToken(req);
  if (!token) {
    return { error: makeErrorResponse(corsHeaders, { error: "Unauthorized" }, 401) };
  }

  let supabaseAdmin: SupabaseAdmin;
  try {
    supabaseAdmin = createAdminClient();
  } catch {
    return { error: makeErrorResponse(corsHeaders, { error: "Server not configured" }, 500) };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { error: makeErrorResponse(corsHeaders, { error: "Unauthorized" }, 401) };
  }

  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    supabaseAdmin,
  };
}

/**
 * Same as requireAuthUser but also asserts user_profiles.role = 'admin'.
 * Returns 403 Forbidden if the role check fails.
 */
export async function requireAdminUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthResult> {
  const authResult = await requireAuthUser(req, corsHeaders);
  if ("error" in authResult) return authResult;

  const { user, supabaseAdmin } = authResult;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  const typedProfile = profile as { id: string; role: string } | null;

  if (profileError) {
    console.error("[auth] requireAdminUser: failed to load profile", {
      userId: user.id,
      message: profileError.message,
    });
    return {
      error: makeErrorResponse(corsHeaders, { error: "Failed to verify role" }, 500),
    };
  }

  if (!typedProfile || typedProfile.role !== "admin") {
    return { error: makeErrorResponse(corsHeaders, { error: "Forbidden" }, 403) };
  }

  return { user, supabaseAdmin };
}
