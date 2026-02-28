import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const MASTER_BUCKET = (Deno.env.get("SUPABASE_MASTER_BUCKET") || "beats-masters").trim() || "beats-masters";
const DEFAULT_EXPIRES_SECONDS = 90;
const MIN_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 120;
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

const normalizePathCandidate = (
  candidate: string,
  fallbackBucket: string,
): { bucket: string; path: string } | null => {
  const raw = candidate.trim();
  if (!raw) return null;

  const knownBuckets = [MASTER_BUCKET, "beats-masters", "beats-audio", "beats-watermarked"];

  if (!/^https?:\/\//i.test(raw)) {
    const cleaned = raw.replace(/^\/+/, "");
    if (!cleaned) return null;

    for (const bucket of knownBuckets) {
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

    const bucketIndex = segments.findIndex((segment) => knownBuckets.includes(segment));
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
      .select("id, master_path, master_url")
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

    const masterCandidates = [
      asNonEmptyString(productRow.master_path),
      asNonEmptyString(productRow.master_url),
    ].filter((value): value is string => Boolean(value));

    let resolvedMaster: { bucket: string; path: string } | null = null;

    for (const candidate of masterCandidates) {
      const parsed = normalizePathCandidate(candidate, MASTER_BUCKET);
      if (!parsed) continue;
      if (parsed.bucket !== MASTER_BUCKET && parsed.bucket !== "beats-masters") {
        continue;
      }
      resolvedMaster = parsed;
      break;
    }

    if (!resolvedMaster) {
      console.warn("[get-master-url] No master in private bucket", {
        productId,
        userId: authData.user.id,
        candidates: masterCandidates,
        requiredBucket: MASTER_BUCKET,
      });
      return new Response(JSON.stringify({
        error: "Master file not available in private bucket",
        code: "MASTER_NOT_IN_PRIVATE_BUCKET",
      }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(resolvedMaster.bucket)
      .createSignedUrl(resolvedMaster.path, expiresIn, { download: true });

    if (signedError || !signedData?.signedUrl) {
      console.error("[get-master-url] Failed to sign URL", {
        productId,
        userId: authData.user.id,
        resolvedMaster,
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
      bucket: resolvedMaster.bucket,
      path: resolvedMaster.path,
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
