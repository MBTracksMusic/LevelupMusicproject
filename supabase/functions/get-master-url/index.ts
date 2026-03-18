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

const MASTER_BUCKET = (Deno.env.get("SUPABASE_MASTER_BUCKET") || "beats-masters").trim() || "beats-masters";
const PREVIEW_BUCKET = (Deno.env.get("SUPABASE_WATERMARKED_BUCKET") || "beats-watermarked").trim() || "beats-watermarked";
const DEFAULT_EXPIRES_SECONDS = 60;
const MIN_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 60;
const GET_MASTER_URL_RATE_LIMIT_RPC = "get_master_url_user";
const DOWNLOAD_ACCESS_LOG_TABLE = "download_access_log";
const DOWNLOAD_ACCESS_PER_PRODUCT_PER_MINUTE = 5;
const DOWNLOAD_ACCESS_PER_USER_PER_TEN_MINUTES = 20;
const DOWNLOAD_ACCESS_PER_PRODUCT_WINDOW_MS = 60 * 1000;
const DOWNLOAD_ACCESS_PER_USER_WINDOW_MS = 10 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractAuthorizationHeader = (req: Request) =>
  req.headers.get("authorization") ?? req.headers.get("Authorization");

const isBearerAuthorizationHeader = (value: string | null): value is string => (
  typeof value === "string" && /^Bearer\s+\S+$/i.test(value.trim())
);

const normalizeExpiresIn = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EXPIRES_SECONDS;
  }

  const rounded = Math.round(value);
  return Math.max(MIN_EXPIRES_SECONDS, Math.min(MAX_EXPIRES_SECONDS, rounded));
};

const isUuid = (value: string) => UUID_RE.test(value);

const extractClientIp = (req: Request) => {
  const forwardedFor = asNonEmptyString(req.headers.get("x-forwarded-for"));
  if (forwardedFor) {
    const firstHop = asNonEmptyString(forwardedFor.split(",")[0]?.trim());
    if (firstHop) return firstHop;
  }

  return asNonEmptyString(req.headers.get("cf-connecting-ip"));
};

const normalizeStoragePath = (value: string) => value.trim().replace(/^\/+/, "");
const CANONICAL_MASTER_BUCKETS = [MASTER_BUCKET, "beats-masters"];
const ALLOWED_MASTER_BUCKETS = [...new Set([...CANONICAL_MASTER_BUCKETS])];
const KNOWN_BUCKETS = [...new Set([...ALLOWED_MASTER_BUCKETS, PREVIEW_BUCKET, "beats-watermarked"])];

const normalizePathCandidate = (
  candidate: string,
  fallbackBucket: string,
): { bucket: string; path: string } | null => {
  const raw = candidate.trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    const cleaned = raw.replace(/^\/+/, "");
    if (!cleaned) return null;

    for (const bucket of KNOWN_BUCKETS) {
      if (cleaned.startsWith(`${bucket}/`)) {
        const path = cleaned.slice(bucket.length + 1);
        if (!path) return null;
        return { bucket, path };
      }
    }

    return { bucket: fallbackBucket, path: cleaned };
  }

  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);

    const objectIndex = segments.findIndex((segment) => segment === "object");
    if (objectIndex >= 0 && objectIndex + 3 < segments.length) {
      const bucket = segments[objectIndex + 2];
      const path = decodeURIComponent(segments.slice(objectIndex + 3).join("/"));
      if (!bucket || !path) return null;
      return { bucket, path };
    }

    const bucketIndex = segments.findIndex((segment) => KNOWN_BUCKETS.includes(segment));
    if (bucketIndex >= 0) {
      const bucket = segments[bucketIndex];
      const path = decodeURIComponent(segments.slice(bucketIndex + 1).join("/"));
      if (!bucket || !path) return null;
      return { bucket, path };
    }
  } catch {
    return null;
  }

  return null;
};

const pathHasTraversal = (value: string) => {
  const normalized = normalizeStoragePath(value);
  return normalized.split("/").some((segment) => segment === "." || segment === "..");
};

const hasStrictMasterPrefix = (path: string, producerId: string, productId: string) => {
  const normalized = normalizeStoragePath(path);
  return normalized.startsWith(`${producerId}/${productId}/`);
};

const buildSigningPathCandidates = (path: string) => {
  const normalized = normalizeStoragePath(path);
  const candidates = [normalized];

  return [...new Set(candidates.filter(Boolean))];
};

function validateMasterPathInvariant(
  productId: string,
  producerId: string,
  path: string,
) {
  if (pathHasTraversal(path)) {
    return { allowed: false as const, reason: "path_traversal" as const };
  }

  if (!hasStrictMasterPrefix(path, producerId, productId)) {
    return { allowed: false as const, reason: "prefix_mismatch" as const };
  }

  return { allowed: true as const };
}

function validateResolvedMasterPath(
  productId: string,
  producerId: string,
  resolvedMaster: { bucket: string; path: string },
) {
  if (pathHasTraversal(resolvedMaster.path)) {
    return { allowed: false as const, reason: "path_traversal" as const };
  }

  if (CANONICAL_MASTER_BUCKETS.includes(resolvedMaster.bucket)) {
    const strictInvariant = validateMasterPathInvariant(productId, producerId, resolvedMaster.path);
    if (!strictInvariant.allowed) return { allowed: false as const, reason: strictInvariant.reason };
    return { allowed: true as const };
  }

  return { allowed: false as const, reason: "wrong_bucket" as const };
}

async function userHasCompletedPurchase(
  supabaseAdmin: any,
  userId: string,
  productId: string,
) {
  // Strict security rule:
  // master access requires a paid purchase completed for this user/product pair.
  const { data: terminalPurchases, error: purchaseError } = await supabaseAdmin
    .from("purchases")
    .select("status, created_at")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .in("status", ["completed", "refunded"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (purchaseError) {
    throw new Error(`Failed to check purchases: ${purchaseError.message}`);
  }

  const latestTerminalPurchase = ((terminalPurchases ?? []) as Array<{ status: string | null }>)
    .find((row) => row.status === "completed" || row.status === "refunded");
  if (!latestTerminalPurchase) {
    return false;
  }

  return latestTerminalPurchase.status === "completed";
}

async function checkSuccessfulGrantRateLimits(
  supabaseAdmin: any,
  userId: string,
  productId: string,
) {
  const nowMs = Date.now();
  const oneMinuteAgoIso = new Date(nowMs - DOWNLOAD_ACCESS_PER_PRODUCT_WINDOW_MS).toISOString();
  const tenMinutesAgoIso = new Date(nowMs - DOWNLOAD_ACCESS_PER_USER_WINDOW_MS).toISOString();

  const { count: recentProductCount, error: recentProductError } = await supabaseAdmin
    .from(DOWNLOAD_ACCESS_LOG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("product_id", productId)
    .gte("created_at", oneMinuteAgoIso);

  if (recentProductError) {
    throw new Error(`Failed to check product scoped download rate limit: ${recentProductError.message}`);
  }

  if ((recentProductCount ?? 0) >= DOWNLOAD_ACCESS_PER_PRODUCT_PER_MINUTE) {
    return { allowed: false as const, status: 429 as const, error: "Rate limit exceeded" };
  }

  const { count: recentUserCount, error: recentUserError } = await supabaseAdmin
    .from(DOWNLOAD_ACCESS_LOG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", tenMinutesAgoIso);

  if (recentUserError) {
    throw new Error(`Failed to check user scoped download rate limit: ${recentUserError.message}`);
  }

  if ((recentUserCount ?? 0) >= DOWNLOAD_ACCESS_PER_USER_PER_TEN_MINUTES) {
    return { allowed: false as const, status: 429 as const, error: "Rate limit exceeded" };
  }

  return { allowed: true as const };
}

async function logSuccessfulGrant(
  supabaseAdmin: any,
  params: {
    userId: string;
    productId: string;
    ipAddress: string | null;
    userAgent: string | null;
  },
) {
  const { error } = await supabaseAdmin.from(DOWNLOAD_ACCESS_LOG_TABLE).insert({
    user_id: params.userId,
    product_id: params.productId,
    ip_address: params.ipAddress,
    user_agent: params.userAgent,
  });

  if (error) {
    throw new Error(`Failed to persist successful download grant: ${error.message}`);
  }
}

serveWithErrorHandling("get-master-url", async (req: Request) => {
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("[get-master-url] Missing Supabase env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const authHeader = extractAuthorizationHeader(req);
    if (!isBearerAuthorizationHeader(authHeader)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: authData, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !authData.user) {
      console.warn("[get-master-url] Invalid auth token", { authError });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = (await req.json().catch(() => null)) as {
      beatId?: unknown;
      beat_id?: unknown;
      product_id?: unknown;
      expires_in?: unknown;
    } | null;

    const productId = (
      asNonEmptyString(body?.beatId) ??
      asNonEmptyString(body?.beat_id) ??
      asNonEmptyString(body?.product_id)
    );
    if (!productId || !isUuid(productId)) {
      return new Response(JSON.stringify({ error: "Invalid beatId" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: rateLimitAllowed, error: rateLimitError } = await supabaseAdmin.rpc(
      "check_rpc_rate_limit",
      {
        p_user_id: authData.user.id,
        p_rpc_name: GET_MASTER_URL_RATE_LIMIT_RPC,
      },
    );

    if (rateLimitError) {
      console.error("[get-master-url] Rate limit check failed", {
        userId: authData.user.id,
        productId,
        rateLimitError,
      });
      return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!rateLimitAllowed) {
      return new Response(JSON.stringify({
        error: "Too many requests",
        code: "rate_limit_exceeded",
      }), {
        status: 429,
        headers: jsonHeaders,
      });
    }

    const expiresIn = normalizeExpiresIn(body?.expires_in);

    console.log("[get-master-url] Request", {
      userId: authData.user.id,
      productId,
      expiresIn,
      bucket: MASTER_BUCKET,
    });

    const hasCompletedPurchase = await userHasCompletedPurchase(supabaseAdmin, authData.user.id, productId);
    if (!hasCompletedPurchase) {
      console.warn("[get-master-url] Forbidden: no completed purchase", {
        userId: authData.user.id,
        productId,
      });
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const { data: productRow, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, producer_id, master_path, master_url")
      .eq("id", productId)
      .maybeSingle();

    if (productError) {
      console.error("[get-master-url] Failed to load product", {
        productId,
        productError,
      });
      return new Response(JSON.stringify({ error: "Failed to load product" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!productRow) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const producerId = asNonEmptyString(productRow.producer_id);
    if (!producerId || !isUuid(producerId)) {
      console.error("[get-master-url] Invalid product producer_id", {
        productId,
        producerId: productRow.producer_id,
      });
      return new Response(JSON.stringify({ error: "Invalid product owner metadata" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const masterPathCandidates = [
      asNonEmptyString(productRow.master_path),
      asNonEmptyString(productRow.master_url),
    ].filter((value): value is string => Boolean(value));

    if (masterPathCandidates.length === 0) {
      console.warn("[get-master-url] Invalid master path: both master_path and master_url empty", {
        productId,
        userId: authData.user.id,
      });
      return new Response(JSON.stringify({
        error: "Invalid master path",
        code: "invalid_master_path",
      }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    let resolvedMaster: { bucket: string; path: string } | null = null;
    let lastValidationReason: string | null = null;

    for (const candidate of masterPathCandidates) {
      const parsedCandidate = normalizePathCandidate(candidate, MASTER_BUCKET);
      if (!parsedCandidate) {
        lastValidationReason = "parse_failed";
        continue;
      }

      const validation = validateResolvedMasterPath(productId, producerId, parsedCandidate);
      if (validation.allowed) {
        resolvedMaster = parsedCandidate;
        break;
      }

      lastValidationReason = validation.reason;
    }

    if (!resolvedMaster) {
      console.warn("[get-master-url] Invalid master path: no candidate passed validation", {
        userId: authData.user.id,
        productId,
        producerId,
        candidatesTried: masterPathCandidates.length,
        lastValidationReason,
      });
      return new Response(JSON.stringify({
        error: "Invalid master path",
        code: "invalid_master_path",
      }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const successfulGrantRateLimit = await checkSuccessfulGrantRateLimits(
      supabaseAdmin,
      authData.user.id,
      productId,
    );
    if (!successfulGrantRateLimit.allowed) {
      return new Response(JSON.stringify({ error: successfulGrantRateLimit.error }), {
        status: successfulGrantRateLimit.status,
        headers: jsonHeaders,
      });
    }

    const signingPathCandidates = buildSigningPathCandidates(resolvedMaster.path);

    const signingBuckets = [...new Set([MASTER_BUCKET, "beats-masters", resolvedMaster.bucket].filter(Boolean))];

    const signingCandidates: Array<{ bucket: string; path: string }> = [];
    for (const bucket of signingBuckets) {
      for (const path of signingPathCandidates) {
        signingCandidates.push({ bucket, path });
      }
    }

    const uniqueSigningCandidates = signingCandidates.filter((candidate, index, source) =>
      source.findIndex((entry) => entry.bucket === candidate.bucket && entry.path === candidate.path) === index
    );

    let signedData: { signedUrl: string } | null = null;
    let signedError: unknown = null;
    let signedFrom: { bucket: string; path: string } | null = null;

    for (const candidate of uniqueSigningCandidates) {
      const { data, error } = await supabaseAdmin.storage
        .from(candidate.bucket)
        .createSignedUrl(candidate.path, expiresIn, { download: true });

      if (!error && data?.signedUrl) {
        signedData = { signedUrl: data.signedUrl };
        signedError = null;
        signedFrom = candidate;
        break;
      }

      signedError = error ?? new Error("signed_url_missing");
    }

    if (!signedData?.signedUrl || !signedFrom) {
      console.error("[get-master-url] Failed to sign URL", {
        productId,
        userId: authData.user.id,
        resolvedMaster,
        signingCandidates: uniqueSigningCandidates,
        signedError,
      });
      return new Response(JSON.stringify({ error: "Master file unavailable" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    await logSuccessfulGrant(supabaseAdmin, {
      userId: authData.user.id,
      productId,
      ipAddress: extractClientIp(req),
      userAgent: asNonEmptyString(req.headers.get("user-agent")),
    });

    return new Response(JSON.stringify({
      url: signedData.signedUrl,
      expiresIn,
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[get-master-url] Unexpected error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
