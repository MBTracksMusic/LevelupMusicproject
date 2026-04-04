import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireAdminUser } from "../_shared/auth.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_CORS_ORIGIN = "https://www.beatelion.com";

const resolveAllowedCorsOrigins = () => {
  const allowed = new Set<string>([
    "https://beatelion.com",
    "https://www.beatelion.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const trimmed = token.trim();
      if (trimmed) allowed.add(trimmed);
    }
  }

  return allowed;
};

const ALLOWED_CORS_ORIGINS = resolveAllowedCorsOrigins();

const buildCorsHeaders = (origin: string | null) => ({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": origin && ALLOWED_CORS_ORIGINS.has(origin)
    ? origin
    : DEFAULT_CORS_ORIGIN,
  "Vary": "Origin",
});

// Seul bucket autorisé : les previews watermarkées.
// Les masters, contrats et avatars ne sont JAMAIS touchés.
const ALLOWED_BUCKETS = ["beats-watermarked"] as const;

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 1000;

type BucketResult = {
  deleted: number;
  error?: string;
};

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

async function listAllFilePaths(
  supabaseAdmin: SupabaseClient,
  bucket: string,
): Promise<string[]> {
  const filePaths: string[] = [];
  const prefixes: string[] = [""];

  while (prefixes.length > 0) {
    const prefix = prefixes.pop() ?? "";
    let offset = 0;

    while (true) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(
        prefix,
        {
          limit: LIST_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        },
      );

      if (error) {
        throw new Error(
          `Failed to list "${bucket}"${prefix ? ` at "${prefix}"` : ""}: ${error.message}`,
        );
      }

      if (!data || data.length === 0) break;

      for (const entry of data) {
        const name = entry.name?.trim();
        if (!name) continue;

        const fullPath = joinPath(prefix, name);
        if (entry.id === null) {
          prefixes.push(fullPath);
          continue;
        }
        filePaths.push(fullPath);
      }

      if (data.length < LIST_PAGE_SIZE) break;
      offset += LIST_PAGE_SIZE;
    }
  }

  return filePaths;
}

async function emptyBucket(
  supabaseAdmin: SupabaseClient,
  bucket: string,
): Promise<BucketResult> {
  const filePaths = await listAllFilePaths(supabaseAdmin, bucket);
  let deleted = 0;

  for (let index = 0; index < filePaths.length; index += REMOVE_BATCH_SIZE) {
    const batch = filePaths.slice(index, index + REMOVE_BATCH_SIZE);
    const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);

    if (error) {
      throw new Error(`Failed to remove files from "${bucket}": ${error.message}`);
    }

    deleted += batch.length;
  }

  return { deleted };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth admin obligatoire
  const authResult = await requireAdminUser(req, corsHeaders);
  if ("error" in authResult) return authResult.error;

  const { supabaseAdmin, user } = authResult;

  console.log("[empty-storage-buckets] requested by admin", { userId: user.id });

  const results: Record<string, BucketResult> = {};
  let hasErrors = false;

  for (const bucket of ALLOWED_BUCKETS) {
    try {
      const result = await emptyBucket(supabaseAdmin, bucket);
      results[bucket] = result;
      console.log("[empty-storage-buckets] bucket emptied", {
        bucket,
        deleted: result.deleted,
        adminId: user.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[bucket] = { deleted: 0, error: message };
      hasErrors = true;
      console.error("[empty-storage-buckets] bucket failed", { bucket, error: message });
    }
  }

  return new Response(JSON.stringify({ ok: !hasErrors, results }), {
    status: hasErrors ? 500 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
