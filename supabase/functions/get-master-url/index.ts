import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const MASTER_BUCKET = (Deno.env.get("SUPABASE_MASTER_BUCKET") || "beats-masters").trim() || "beats-masters";
const LEGACY_MASTER_BUCKET = (Deno.env.get("SUPABASE_AUDIO_BUCKET") || "beats-audio").trim() || "beats-audio";
const PREVIEW_BUCKET = (Deno.env.get("SUPABASE_WATERMARKED_BUCKET") || "beats-watermarked").trim() || "beats-watermarked";
const DEFAULT_EXPIRES_SECONDS = 90;
const MIN_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 120;
const GET_MASTER_URL_RATE_LIMIT_RPC = "get_master_url_user";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeExpiresIn = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EXPIRES_SECONDS;
  }

  const rounded = Math.round(value);
  return Math.max(MIN_EXPIRES_SECONDS, Math.min(MAX_EXPIRES_SECONDS, rounded));
};

const isUuid = (value: string) => UUID_RE.test(value);

const normalizeStoragePath = (value: string) => value.trim().replace(/^\/+/, "");
const CANONICAL_MASTER_BUCKETS = [MASTER_BUCKET, "beats-masters"];
const LEGACY_MASTER_BUCKETS = [LEGACY_MASTER_BUCKET, "beats-audio"];
const ALLOWED_MASTER_BUCKETS = [...new Set([...CANONICAL_MASTER_BUCKETS, ...LEGACY_MASTER_BUCKETS])];
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

const hasLegacyMasterPrefix = (path: string, producerId: string) => {
  const normalized = normalizeStoragePath(path);
  return normalized.startsWith(`${producerId}/`);
};

const hasLegacyAudioPrefix = (path: string, producerId: string) => {
  const normalized = normalizeStoragePath(path);
  return normalized.startsWith(`${producerId}/audio/`);
};

const getPathFileName = (path: string) => {
  const normalized = normalizeStoragePath(path);
  if (!normalized) return null;
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
};

const buildSigningPathCandidates = (
  path: string,
  producerId: string,
  productId: string,
) => {
  const normalized = normalizeStoragePath(path);
  const fileName = getPathFileName(normalized);
  const candidates = [normalized];

  if (fileName && hasLegacyAudioPrefix(normalized, producerId)) {
    candidates.push(`${producerId}/${productId}/${fileName}`);
  }

  if (fileName && hasStrictMasterPrefix(normalized, producerId, productId)) {
    candidates.push(`${producerId}/audio/${fileName}`);
  }

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
    if (!strictInvariant.allowed) {
      // Compatibility for legacy rows left in `producer_id/audio/...` format.
      // This pattern existed before strict `producer_id/product_id/...` enforcement.
      if (strictInvariant.reason === "prefix_mismatch" && hasLegacyAudioPrefix(resolvedMaster.path, producerId)) {
        return { allowed: true as const };
      }
      return { allowed: false as const, reason: strictInvariant.reason };
    }
    return { allowed: true as const };
  }

  if (LEGACY_MASTER_BUCKETS.includes(resolvedMaster.bucket)) {
    if (!hasLegacyMasterPrefix(resolvedMaster.path, producerId)) {
      return { allowed: false as const, reason: "legacy_prefix_mismatch" as const };
    }
    return { allowed: true as const };
  }

  return { allowed: false as const, reason: "wrong_bucket" as const };
}

async function userHasAccessToProduct(
  supabaseAdmin: any,
  userId: string,
  productId: string,
) {
  const { data: entitlementData, error: entitlementError } = await supabaseAdmin
    .from("entitlements")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("is_active", true)
    .limit(5);

  if (entitlementError) {
    throw new Error(`Failed to check entitlements: ${entitlementError.message}`);
  }

  const entitlementRows = (entitlementData ?? []) as Array<{ expires_at: string | null }>;
  const now = Date.now();
  const hasValidEntitlement = entitlementRows.some((row) => {
    if (!row.expires_at) return true;
    const expiresAtMs = new Date(row.expires_at).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > now;
  });

  if (hasValidEntitlement) return true;

  // Explicitly deny if a refunded row exists for this user/product pair.
  const { data: refundedData, error: refundedError } = await supabaseAdmin
    .from("purchases")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("status", "refunded")
    .order("created_at", { ascending: false })
    .limit(1);

  if (refundedError) {
    throw new Error(`Failed to check refunded purchases: ${refundedError.message}`);
  }

  const refundedRows = (refundedData ?? []) as Array<{ id: string }>;
  if (refundedRows.length > 0) return false;

  // Legacy compatibility: fallback to completed purchase rows.
  const { data: purchaseData, error: purchaseError } = await supabaseAdmin
    .from("purchases")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (purchaseError) {
    throw new Error(`Failed to check purchases: ${purchaseError.message}`);
  }

  const purchaseRows = (purchaseData ?? []) as Array<{ id: string }>;
  return purchaseRows.length > 0;
}

Deno.serve(async (req: Request) => {
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

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[get-master-url] Missing Supabase env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authData.user) {
      console.warn("[get-master-url] Invalid auth token", { authError });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = (await req.json().catch(() => null)) as {
      product_id?: unknown;
      expires_in?: unknown;
    } | null;

    const productId = asNonEmptyString(body?.product_id);
    if (!productId || !isUuid(productId)) {
      return new Response(JSON.stringify({ error: "Invalid product_id" }), {
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

    const hasAccess = await userHasAccessToProduct(supabaseAdmin, authData.user.id, productId);
    if (!hasAccess) {
      console.warn("[get-master-url] Forbidden: no entitlement", {
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

    const signingPathCandidates = buildSigningPathCandidates(
      resolvedMaster.path,
      producerId,
      productId,
    );

    const signingBuckets = [...new Set([
      MASTER_BUCKET,
      "beats-masters",
      LEGACY_MASTER_BUCKET,
      "beats-audio",
      resolvedMaster.bucket,
    ].filter(Boolean))];

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

    return new Response(JSON.stringify({
      url: signedData.signedUrl,
      expires_in: expiresIn,
      bucket: signedFrom.bucket,
      path: signedFrom.path,
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
