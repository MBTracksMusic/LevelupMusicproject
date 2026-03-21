import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import { resolveCorsHeaders } from "../_shared/cors.ts";

const PREVIEW_BUCKET = (Deno.env.get("SUPABASE_WATERMARKED_BUCKET") || "beats-watermarked").trim() || "beats-watermarked";
const SIGNED_URL_TTL_SECONDS = 60;
const RATE_LIMIT_MAX_AUTHENTICATED = 120;
const RATE_LIMIT_MAX_ANON = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStoragePath = (value: string) => value.trim().replace(/^\/+/, "");

const pathHasTraversal = (value: string) => {
  const normalized = normalizeStoragePath(value);
  return normalized.split("/").some((segment) => segment === "." || segment === "..");
};

const getRequesterIp = (req: Request) => {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  const candidate = cfIp || realIp || forwardedFor?.split(",")[0];
  const normalized = asNonEmptyString(candidate);
  return normalized ?? "unknown";
};

const normalizePathCandidate = (
  candidate: string,
  fallbackBucket: string,
): { bucket: string; path: string } | null => {
  const raw = candidate.trim();
  if (!raw) return null;

  const knownBuckets = [PREVIEW_BUCKET, "beats-watermarked"];

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

const resolvePreviewObject = (row: {
  preview_url: string | null;
  watermarked_path: string | null;
  exclusive_preview_url: string | null;
  watermarked_bucket: string | null;
}) => {
  const fallbackBucket = asNonEmptyString(row.watermarked_bucket) || PREVIEW_BUCKET;
  const candidates = [
    asNonEmptyString(row.watermarked_path),
    asNonEmptyString(row.preview_url),
    asNonEmptyString(row.exclusive_preview_url),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const resolved = normalizePathCandidate(candidate, fallbackBucket);
    if (!resolved) continue;

    if (resolved.bucket !== PREVIEW_BUCKET && resolved.bucket !== "beats-watermarked") {
      continue;
    }

    if (pathHasTraversal(resolved.path)) {
      continue;
    }

    return resolved;
  }

  return null;
};

const extractProductId = (url: URL) => {
  const fromQuery = asNonEmptyString(url.searchParams.get("product_id"));
  if (fromQuery) return fromQuery;

  const segments = url.pathname.split("/").filter(Boolean);
  const previewIndex = segments.lastIndexOf("preview");
  if (previewIndex >= 0 && previewIndex + 1 < segments.length) {
    return decodeURIComponent(segments[previewIndex + 1]);
  }

  const lastSegment = segments.at(-1);
  if (!lastSegment || lastSegment === "preview-audio" || lastSegment === "preview") {
    return null;
  }

  return decodeURIComponent(lastSegment);
};

serveWithErrorHandling("preview-audio", async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = resolveCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[preview-audio] Missing Supabase env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const url = new URL(req.url);
  const productId = extractProductId(url);
  if (!productId || !UUID_RE.test(productId)) {
    return new Response(JSON.stringify({ error: "Invalid product id" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const authHeader = req.headers.get("Authorization");
  let authenticatedUserId: string | null = null;
  if (authHeader) {
    if (!anonKey) {
      console.error("[preview-audio] Missing SUPABASE_ANON_KEY for auth validation");
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    authenticatedUserId = authData.user.id;
  }

  const requesterIp = getRequesterIp(req);
  const rateLimitKey = authenticatedUserId ? `user:${authenticatedUserId}` : `ip:${requesterIp}`;
  const maxRequests = authenticatedUserId ? RATE_LIMIT_MAX_AUTHENTICATED : RATE_LIMIT_MAX_ANON;
  const { data: allowed, error: rateLimitError } = await supabaseAdmin.rpc("check_rate_limit", {
    p_key: rateLimitKey,
    p_limit: maxRequests,
  });

  if (rateLimitError) {
    console.error("[preview-audio] Rate limit RPC failed", {
      rateLimitKey,
      message: rateLimitError.message,
    });
    return new Response(JSON.stringify({ error: "Rate limit unavailable" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: jsonHeaders,
    });
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select(
      "id, deleted_at, status, is_published, preview_url, watermarked_path, exclusive_preview_url, watermarked_bucket",
    )
    .eq("id", productId)
    .maybeSingle();

  if (productError) {
    console.error("[preview-audio] Failed to load product", { productId, productError });
    return new Response(JSON.stringify({ error: "Failed to load product" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (!product) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  if (product.deleted_at !== null || product.status !== "active" || product.is_published === false) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const previewObject = resolvePreviewObject(product);
  if (!previewObject) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const { data: signedData, error: signedError } = await supabaseAdmin.storage
    .from(previewObject.bucket)
    .createSignedUrl(previewObject.path, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    console.error("[preview-audio] Failed to sign preview URL", {
      productId,
      bucket: previewObject.bucket,
      signedError,
    });
    return new Response(JSON.stringify({ error: "Preview unavailable" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "Vary": "Authorization, X-Forwarded-For",
      "Location": signedData.signedUrl,
    },
  });
});
