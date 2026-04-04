import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupabaseAdmin = ReturnType<typeof createClient>;

export type JwtClaims = Record<string, unknown> & {
  sub: string;
  email?: string | null;
};

export type AuthUser = {
  id: string;
  email: string | null;
  claims: JwtClaims;
};

export type AuthSuccess = {
  user: AuthUser;
  supabaseAdmin: SupabaseAdmin;
};

export type OptionalAuthSuccess = {
  user: AuthUser | null;
  supabaseAdmin: SupabaseAdmin;
};

export type AuthError = {
  error: Response;
};

export type AuthResult = AuthSuccess | AuthError;
export type OptionalAuthResult = OptionalAuthSuccess | AuthError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function createAdminClient(): SupabaseAdmin {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(token: string): SupabaseAdmin {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  // RLS is enforced from the Authorization header, not the apikey header.
  // Using the service role key as apikey while overriding Authorization with
  // the caller JWT preserves auth.uid() / policies for PostgREST requests.
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

/**
 * Extracts the raw JWT from an "Authorization: Bearer <token>" header.
 * Returns null if the header is absent or does not match the pattern.
 * Case-insensitive "Bearer" prefix per RFC 6750.
 */
export function extractBearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function makeErrorResponse(
  corsHeaders: Record<string, string>,
  payload: unknown,
  status: number,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractEmailClaim(claims: Record<string, unknown>): string | null {
  return asNonEmptyString(claims.email);
}

async function loadAuthUserFromToken(
  token: string,
  supabaseAdmin: SupabaseAdmin,
): Promise<AuthUser | null> {
  const { data, error } = await supabaseAdmin.auth.getClaims(token);
  const claims = data?.claims as JwtClaims | undefined;
  const userId = claims?.sub;

  if (error || !claims || typeof userId !== "string" || userId.trim().length === 0) {
    return null;
  }

  return {
    id: userId,
    email: extractEmailClaim(claims),
    claims,
  };
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

  const user = await loadAuthUserFromToken(token, supabaseAdmin);
  if (!user) {
    return { error: makeErrorResponse(corsHeaders, { error: "Unauthorized" }, 401) };
  }

  return {
    user,
    supabaseAdmin,
  };
}

export async function getAuthUserIfPresent(
  req: Request,
  corsHeaders: Record<string, string>,
  options: { rejectInvalidToken?: boolean } = {},
): Promise<OptionalAuthResult> {
  let supabaseAdmin: SupabaseAdmin;
  try {
    supabaseAdmin = createAdminClient();
  } catch {
    return { error: makeErrorResponse(corsHeaders, { error: "Server not configured" }, 500) };
  }

  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, supabaseAdmin };
  }

  const user = await loadAuthUserFromToken(token, supabaseAdmin);
  if (!user) {
    if (options.rejectInvalidToken !== false) {
      return { error: makeErrorResponse(corsHeaders, { error: "Unauthorized" }, 401) };
    }

    return { user: null, supabaseAdmin };
  }

  return { user, supabaseAdmin };
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
