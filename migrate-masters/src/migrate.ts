import type { SupabaseClient } from "@supabase/supabase-js";

export interface MigrationConfig {
  legacyBucket: string;
  canonicalBucket: string;
  pageSize: number;
  signedUrlTtlSeconds: number;
}

interface ProductRow {
  id: string;
  title: string;
  product_type: string;
  is_published: boolean;
  deleted_at: string | null;
  master_path: string | null;
}

interface ProductBatchResult {
  data: ProductRow[];
  hasMore: boolean;
}

interface Counters {
  totalProducts: number;
  migrated: number;
  alreadyOk: number;
  missingEverywhere: number;
  failed: number;
}

type OutcomeEvent = "migrated" | "already_ok" | "missing_everywhere";

const STORAGE_URL_SEGMENTS = [
  "/storage/v1/object/sign/",
  "/storage/v1/object/authenticated/",
  "/storage/v1/object/public/",
  "/storage/v1/object/",
];

const logJson = (level: "info" | "error", event: string, fields: Record<string, unknown>) => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...fields,
    }),
  );
};

const trimSlashes = (value: string) => value.replace(/^\/+/, "").replace(/\/+$/, "");

const tryParseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const extractStoragePathFromUrl = (value: string, bucketNames: string[]): string | null => {
  const parsed = tryParseUrl(value);
  if (!parsed) {
    return null;
  }

  const pathname = decodeURIComponent(parsed.pathname);
  for (const segment of STORAGE_URL_SEGMENTS) {
    const index = pathname.indexOf(segment);
    if (index === -1) {
      continue;
    }

    const remainder = trimSlashes(pathname.slice(index + segment.length));
    for (const bucketName of bucketNames) {
      if (remainder.startsWith(`${bucketName}/`)) {
        return trimSlashes(remainder.slice(bucketName.length + 1));
      }
    }
  }

  return trimSlashes(pathname);
};

const normalizeMasterPath = (rawPath: string | null, canonicalBucket: string, legacyBucket: string): string | null => {
  if (!rawPath) {
    return null;
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const buckets = [canonicalBucket, legacyBucket];
  const fromUrl = extractStoragePathFromUrl(trimmed, buckets);
  if (fromUrl) {
    return fromUrl;
  }

  let normalized = trimSlashes(trimmed);
  for (const bucket of buckets) {
    if (normalized.startsWith(`${bucket}/`)) {
      normalized = trimSlashes(normalized.slice(bucket.length + 1));
      break;
    }
  }

  return normalized || null;
};

const withTimeout = async <T>(promiseFactory: () => PromiseLike<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout_after_${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promiseFactory()), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const tryDownloadProbe = async (
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
  timeoutMs: number,
): Promise<boolean> => {
  // `list()` is not a reliable existence check for a private bucket because it enumerates a prefix,
  // not an exact object lookup. Here we probe the exact path via `download()`, then cancel the body.
  const { data, error } = await withTimeout(
    () => supabase.storage.from(bucket).download(objectPath),
    timeoutMs,
    `probe_download_${bucket}`,
  );

  if (error) {
    logJson("info", "download_probe_miss", {
      bucket,
      path: objectPath,
      error: error.message,
    });
    return false;
  }

  if (data) {
    try {
      const stream = typeof data.stream === "function" ? data.stream() : null;
      if (stream) {
        const reader = stream.getReader();
        await reader.cancel();
        reader.releaseLock();
      }
    } catch {
      // Best effort cleanup only. This is only a probe before the streaming copy.
    }
  }

  return true;
};

const fetchActiveProductsPage = async (
  supabase: SupabaseClient,
  page: number,
  pageSize: number,
  timeoutMs: number,
): Promise<ProductBatchResult> => {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const query = supabase
    .from("products")
    .select("id, title, product_type, is_published, deleted_at, master_path")
    .eq("product_type", "beat")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .range(from, to);

  const { data, error } = await withTimeout(() => query, timeoutMs, "select_products_page");

  if (error) {
    throw new Error(`select_products_failed:${error.message}`);
  }

  const rows = (data ?? []) as ProductRow[];
  return {
    data: rows,
    hasMore: rows.length === pageSize,
  };
};

const fetchActiveProductsCount = async (supabase: SupabaseClient, timeoutMs: number): Promise<number | null> => {
  const query = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("product_type", "beat")
    .eq("is_published", true)
    .is("deleted_at", null);

  const { count, error } = await withTimeout(() => query, timeoutMs, "count_products");

  if (error) {
    throw new Error(`count_products_failed:${error.message}`);
  }

  return typeof count === "number" ? count : null;
};

const createLegacySignedUrl = async (
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
  ttlSeconds: number,
  timeoutMs: number,
) => {
  const { data, error } = await withTimeout(
    () => supabase.storage.from(bucket).createSignedUrl(objectPath, ttlSeconds),
    timeoutMs,
    `create_signed_url_${bucket}`,
  );

  if (error || !data?.signedUrl) {
    throw new Error(`create_signed_url_failed:${bucket}:${objectPath}:${error?.message ?? "missing_signed_url"}`);
  }

  return data.signedUrl;
};

const fetchLegacyStream = async (
  signedUrl: string,
  timeoutMs: number,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string | null; contentLength: number | null }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`download_timeout_after_${timeoutMs}ms`)), timeoutMs);

  try {
    const response = await fetch(signedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`legacy_download_failed:http_${response.status}`);
    }

    if (!response.body) {
      throw new Error("legacy_download_failed:missing_response_body");
    }

    const contentLengthHeader = response.headers.get("content-length");
    return {
      body: response.body,
      contentType: response.headers.get("content-type"),
      contentLength: contentLengthHeader ? Number(contentLengthHeader) : null,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const uploadCanonicalObject = async (
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
  body: ReadableStream<Uint8Array>,
  contentType: string | null,
  timeoutMs: number,
) => {
  const uploadPromise = supabase.storage.from(bucket).upload(objectPath, body, {
    upsert: false,
    contentType: contentType ?? "application/octet-stream",
    duplex: "half",
  });

  const { error } = await withTimeout(() => uploadPromise, timeoutMs, `upload_${bucket}`);
  if (!error) {
    return;
  }

  if (error.message.includes("Duplicate") || error.message.includes("already exists")) {
    return;
  }

  throw new Error(`canonical_upload_failed:${bucket}:${objectPath}:${error.message}`);
};

const logOutcome = (
  event: OutcomeEvent,
  product: ProductRow,
  objectPath: string | null,
  extra: Record<string, unknown> = {},
) => {
  logJson("info", event, {
    product_id: product.id,
    title: product.title,
    master_path: product.master_path,
    normalized_path: objectPath,
    ...extra,
  });
};

const processProduct = async (
  supabase: SupabaseClient,
  product: ProductRow,
  config: MigrationConfig,
  requestTimeoutMs: number,
  counters: Counters,
) => {
  const objectPath = normalizeMasterPath(product.master_path, config.canonicalBucket, config.legacyBucket);
  if (!objectPath) {
    counters.missingEverywhere += 1;
    logOutcome("missing_everywhere", product, null, {
      reason: "master_path_missing_or_invalid",
    });
    return;
  }

  const canonicalDownloadOk = await tryDownloadProbe(
    supabase,
    config.canonicalBucket,
    objectPath,
    requestTimeoutMs,
  );
  if (canonicalDownloadOk) {
    counters.alreadyOk += 1;
    logOutcome("already_ok", product, objectPath, {
      bucket: config.canonicalBucket,
    });
    return;
  }

  const legacyDownloadOk = await tryDownloadProbe(
    supabase,
    config.legacyBucket,
    objectPath,
    requestTimeoutMs,
  );
  if (!legacyDownloadOk) {
    counters.missingEverywhere += 1;
    logOutcome("missing_everywhere", product, objectPath, {
      canonical_bucket: config.canonicalBucket,
      legacy_bucket: config.legacyBucket,
    });
    return;
  }

  const signedUrl = await createLegacySignedUrl(
    supabase,
    config.legacyBucket,
    objectPath,
    config.signedUrlTtlSeconds,
    requestTimeoutMs,
  );

  const { body, contentType, contentLength } = await fetchLegacyStream(signedUrl, requestTimeoutMs);
  await uploadCanonicalObject(supabase, config.canonicalBucket, objectPath, body, contentType, requestTimeoutMs);

  counters.migrated += 1;
  logOutcome("migrated", product, objectPath, {
    from_bucket: config.legacyBucket,
    to_bucket: config.canonicalBucket,
    content_type: contentType,
    content_length: contentLength,
  });
};

export const runMigration = async (
  supabase: SupabaseClient,
  config: MigrationConfig,
  requestTimeoutMs: number,
) => {
  const counters: Counters = {
    totalProducts: 0,
    migrated: 0,
    alreadyOk: 0,
    missingEverywhere: 0,
    failed: 0,
  };

  const countedProducts = await fetchActiveProductsCount(supabase, requestTimeoutMs);
  logJson("info", "migration_started", {
    legacy_bucket: config.legacyBucket,
    canonical_bucket: config.canonicalBucket,
    page_size: config.pageSize,
    signed_url_ttl_seconds: config.signedUrlTtlSeconds,
    estimated_total_products: countedProducts,
  });

  let page = 0;
  while (true) {
    const { data: products, hasMore } = await fetchActiveProductsPage(supabase, page, config.pageSize, requestTimeoutMs);
    if (products.length === 0) {
      break;
    }

    logJson("info", "page_loaded", {
      page,
      batch_size: products.length,
    });

    for (const product of products) {
      counters.totalProducts += 1;

      try {
        await processProduct(supabase, product, config, requestTimeoutMs, counters);
      } catch (error) {
        counters.failed += 1;
        logJson("error", "product_failed", {
          product_id: product.id,
          title: product.title,
          master_path: product.master_path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!hasMore) {
      break;
    }

    page += 1;
  }

  logJson("info", "summary", {
    total_products: counters.totalProducts,
    migrated: counters.migrated,
    already_ok: counters.alreadyOk,
    missing_everywhere: counters.missingEverywhere,
    failed: counters.failed,
  });

  return counters;
};
