import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { FFmpeg } from "npm:@ffmpeg/ffmpeg@0.12.6";
import { fetchFile, toBlobURL } from "npm:@ffmpeg/util@0.12.1";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";
import { captureException, type RequestContext } from "../_shared/sentry.ts";

const INTERNAL_SECRET_HEADER = "x-audio-worker-secret";

const corsHeaders = {
  // This endpoint is strictly internal. It should not be callable from arbitrary browser origins.
  "Access-Control-Allow-Origin": "null",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": `Content-Type, ${INTERNAL_SECRET_HEADER}`,
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const MASTER_BUCKET = (Deno.env.get("SUPABASE_MASTER_BUCKET") || "beats-masters").trim() || "beats-masters";
const WATERMARKED_BUCKET = (Deno.env.get("SUPABASE_WATERMARKED_BUCKET") || "beats-watermarked").trim() || "beats-watermarked";
const WATERMARK_ASSETS_BUCKET = (Deno.env.get("SUPABASE_WATERMARK_ASSETS_BUCKET") || "watermark-assets").trim() || "watermark-assets";
const FFMPEG_CORE_BASE_URL = (
  Deno.env.get("FFMPEG_CORE_BASE_URL") || "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd"
).trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i;
const MAX_MASTER_BYTES = 50 * 1024 * 1024;
const MAX_WATERMARK_BYTES = 10 * 1024 * 1024;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const ANALYZE_TIMEOUT_MS = 15_000;
const PROCESS_TIMEOUT_MS = 45_000;
const MAX_RANDOM_POSITIONS = 24;

interface AudioProcessingJobRow {
  id: string;
  product_id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  producer_id: string;
  title: string;
  product_type: string;
  is_published: boolean;
  deleted_at: string | null;
  preview_url: string | null;
  watermarked_path: string | null;
  exclusive_preview_url: string | null;
  master_path: string | null;
  master_url: string | null;
  preview_version: number | null;
  preview_signature: string | null;
  last_watermark_hash: string | null;
  file_format: string | null;
  watermarked_bucket: string | null;
}

interface SiteAudioSettingsRow {
  id: string;
  enabled: boolean;
  watermark_audio_path: string | null;
  gain_db: number | null;
  min_interval_sec: number | null;
  max_interval_sec: number | null;
}

interface WatermarkAsset {
  path: string;
  bytes: Uint8Array;
}

interface InvocationFfmpegContext {
  ffmpeg: FFmpeg;
  coreUrls: string[];
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeLimit = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(value)));
};

const normalizeWorkerName = (value: unknown) => {
  const worker = asNonEmptyString(value);
  return worker ?? `audio-worker-${crypto.randomUUID()}`;
};

const requireInternalSecret = (req: Request): Response | null => {
  const configuredSecret = Deno.env.get("AUDIO_WORKER_SECRET")?.trim();

  if (!configuredSecret) {
    console.error("[process-audio-jobs] missing AUDIO_WORKER_SECRET");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER)?.trim();

  if (!providedSecret || providedSecret !== configuredSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  return null;
};

const createAdminClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const formatGainDb = (value: number) => {
  const normalized = Number.isFinite(value) ? value : -10;
  return `${normalized.toFixed(2).replace(/\.00$/, "") }dB`;
};

const toGainSignatureComponent = (value: number | null | undefined) => {
  const normalized = Number.isFinite(value) ? Number(value) : -10;
  return normalized.toFixed(2);
};

const toIntervalSignatureComponent = (value: number | null | undefined, fallback: number) => {
  const normalized = Number.isFinite(value) ? Number(value) : fallback;
  return String(Math.max(0, Math.round(normalized)));
};

const sha256Hex = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const computeWatermarkHash = async (settings: SiteAudioSettingsRow) => {
  const source = [
    asNonEmptyString(settings.watermark_audio_path) ?? "",
    toGainSignatureComponent(settings.gain_db),
    toIntervalSignatureComponent(settings.min_interval_sec, 20),
    toIntervalSignatureComponent(settings.max_interval_sec, 45),
  ].join("|");

  return await sha256Hex(source);
};

const computePreviewSignature = async (
  masterReference: string,
  settings: SiteAudioSettingsRow,
) => {
  const source = [
    masterReference,
    asNonEmptyString(settings.watermark_audio_path) ?? "",
    toGainSignatureComponent(settings.gain_db),
    toIntervalSignatureComponent(settings.min_interval_sec, 20),
    toIntervalSignatureComponent(settings.max_interval_sec, 45),
  ].join("|");

  return await sha256Hex(source);
};

const randomBetween = (min: number, max: number) => {
  if (max <= min) return min;
  const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff;
  return min + random * (max - min);
};

const parseStorageCandidate = (
  candidate: string,
  fallbackBucket: string,
): { bucket: string; path: string } | null => {
  const raw = candidate.trim();
  if (!raw) return null;

  const knownBuckets = [MASTER_BUCKET, "beats-masters", WATERMARKED_BUCKET, "beats-watermarked", WATERMARK_ASSETS_BUCKET, "watermark-assets"];

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

const getPublicPreviewUrl = (supabaseAdmin: any, bucket: string, path: string) => {
  return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
};

const updateJobStatus = async (
  supabaseAdmin: any,
  jobId: string,
  payload: Record<string, unknown>,
) => {
  const { error } = await supabaseAdmin
    .from("audio_processing_jobs")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) {
    console.error("[process-audio-jobs] failed to update job", { jobId, error });
  }
};

const updateProductProcessingState = async (
  supabaseAdmin: any,
  productId: string,
  payload: Record<string, unknown>,
) => {
  const { error } = await supabaseAdmin
    .from("products")
    .update(payload)
    .eq("id", productId);

  if (error) {
    console.error("[process-audio-jobs] failed to update product", { productId, error });
  }
};

const withLogCapture = async <T>(ffmpeg: FFmpeg, callback: () => Promise<T>) => {
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
  };

  ffmpeg.on("log", onLog);
  try {
    const value = await callback();
    return { value, logs };
  } finally {
    ffmpeg.off("log", onLog);
  }
};

const parseDurationFromLogs = (logs: string[]) => {
  for (const line of logs) {
    const match = DURATION_RE.exec(line);
    if (!match) continue;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if ([hours, minutes, seconds].some((value) => !Number.isFinite(value))) continue;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
};

const safeDeleteFile = async (ffmpeg: FFmpeg, path: string) => {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Ignore cleanup failures on absent temp files.
  }
};

const initFfmpeg = async (): Promise<InvocationFfmpegContext> => {
  const ffmpeg = new FFmpeg();
  const coreJsUrl = await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript");
  const coreWasmUrl = await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm");

  await ffmpeg.load({
    coreURL: coreJsUrl,
    wasmURL: coreWasmUrl,
  });

  return {
    ffmpeg,
    coreUrls: [coreJsUrl, coreWasmUrl],
  };
};

const disposeFfmpeg = (context: InvocationFfmpegContext | null) => {
  if (!context) return;
  try {
    context.ffmpeg.terminate();
  } catch {
    // Ignore terminate errors during shutdown.
  }

  for (const url of context.coreUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore URL cleanup issues.
    }
  }
};

const guessMasterExtension = (product: ProductRow, sourcePath: string) => {
  const fromPath = sourcePath.split(".").pop()?.toLowerCase();
  if (fromPath && /^[a-z0-9]{2,5}$/.test(fromPath)) return fromPath;

  const fromFormat = asNonEmptyString(product.file_format)?.toLowerCase();
  if (!fromFormat) return "mp3";
  if (fromFormat.includes("wav")) return "wav";
  if (fromFormat.includes("mpeg") || fromFormat.includes("mp3")) return "mp3";
  return fromFormat.replace(/[^a-z0-9]/g, "") || "mp3";
};

const generateWatermarkPositions = (
  durationSec: number,
  minIntervalSec: number,
  maxIntervalSec: number,
) => {
  const safeDuration = Math.max(durationSec, 0);
  const safeMin = Math.max(1, Math.floor(minIntervalSec));
  const safeMax = Math.max(safeMin, Math.floor(maxIntervalSec));
  const lastStart = Math.max(0, safeDuration - 0.5);

  if (lastStart <= 0.5) {
    return [0];
  }

  const positions: number[] = [];
  let cursor = Math.min(randomBetween(safeMin, safeMax), lastStart);
  while (cursor <= lastStart && positions.length < MAX_RANDOM_POSITIONS) {
    positions.push(Number(cursor.toFixed(3)));
    cursor += randomBetween(safeMin, safeMax);
  }

  if (positions.length === 0) {
    positions.push(Number(Math.min(lastStart, safeDuration / 3).toFixed(3)));
  }

  return positions;
};

const buildFilterComplex = (
  delayPositionsMs: number[],
  gainDb: number,
  durationSec: number,
) => {
  const splitLabels = delayPositionsMs.map((_, index) => `tagsrc${index}`);
  const delayedLabels = delayPositionsMs.map((_, index) => `tagmix${index}`);
  const gainExpr = formatGainDb(gainDb);

  let filter = "";
  if (splitLabels.length === 1) {
    filter += `[1:a]volume=${gainExpr}[${splitLabels[0]}];`;
  } else {
    filter += `[1:a]volume=${gainExpr},asplit=${splitLabels.length}${splitLabels.map((label) => `[${label}]`).join("")};`;
  }

  delayPositionsMs.forEach((delayMs, index) => {
    filter += `[${splitLabels[index]}]adelay=${Math.max(0, Math.round(delayMs))}:all=true[${delayedLabels[index]}];`;
  });

  filter += `[0:a]${delayedLabels.map((label) => `[${label}]`).join("")}amix=inputs=${1 + delayedLabels.length}:normalize=0:dropout_transition=0,atrim=duration=${durationSec.toFixed(3)}[outa]`;
  return filter;
};

const getWatermarkAssetLoader = (
  supabaseAdmin: any,
  settings: SiteAudioSettingsRow,
) => {
  let watermarkPromise: Promise<WatermarkAsset> | null = null;

  return async () => {
    if (watermarkPromise) return await watermarkPromise;

    watermarkPromise = (async () => {
      const watermarkPath = asNonEmptyString(settings.watermark_audio_path);
      if (!settings.enabled) {
        throw new Error("watermark_disabled");
      }
      if (!watermarkPath) {
        throw new Error("watermark_asset_missing");
      }

      const { data: watermarkBlob, error: watermarkDownloadError } = await supabaseAdmin.storage
        .from(WATERMARK_ASSETS_BUCKET)
        .download(watermarkPath);

      if (watermarkDownloadError || !watermarkBlob) {
        throw new Error(`download_watermark_failed:${watermarkDownloadError?.message ?? "unknown"}`);
      }

      if (watermarkBlob.size > MAX_WATERMARK_BYTES) {
        throw new Error("watermark_asset_too_large");
      }

      return {
        path: watermarkPath,
        bytes: await fetchFile(watermarkBlob),
      };
    })();

    return await watermarkPromise;
  };
};

const resolveMasterSource = (product: ProductRow) => {
  const candidates = [
    asNonEmptyString(product.master_path),
    asNonEmptyString(product.master_url),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const parsed = parseStorageCandidate(candidate, MASTER_BUCKET);
    if (!parsed) continue;
    if (parsed.bucket === MASTER_BUCKET || parsed.bucket === "beats-masters") {
      return parsed;
    }
  }

  return null;
};

const processJob = async (
  supabaseAdmin: any,
  getFfmpeg: () => Promise<FFmpeg>,
  job: AudioProcessingJobRow,
  settings: SiteAudioSettingsRow,
  loadWatermarkAsset: () => Promise<WatermarkAsset>,
) => {
  if (!UUID_RE.test(job.product_id)) {
    throw new Error("invalid_product_id");
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select([
      "id",
      "producer_id",
      "title",
      "product_type",
      "is_published",
      "deleted_at",
      "preview_url",
      "watermarked_path",
      "exclusive_preview_url",
      "master_path",
      "master_url",
      "preview_version",
      "preview_signature",
      "last_watermark_hash",
      "file_format",
      "watermarked_bucket",
    ].join(", "))
    .eq("id", job.product_id)
    .maybeSingle();

  if (productError) {
    throw new Error(`load_product_failed:${productError.message}`);
  }

  if (!product) {
    await updateJobStatus(supabaseAdmin, job.id, {
      status: "dead",
      last_error: "product_not_found",
      locked_at: null,
      locked_by: null,
    });
    return { status: "dead", reason: "product_not_found" };
  }

  const typedProduct = product as ProductRow;
  if (typedProduct.product_type !== "beat" || !typedProduct.is_published || typedProduct.deleted_at) {
    await updateJobStatus(supabaseAdmin, job.id, {
      status: "done",
      last_error: null,
      locked_at: null,
      locked_by: null,
    });
    return { status: "done", reason: "skipped_ineligible_product", productId: typedProduct.id };
  }

  const resolvedMaster = resolveMasterSource(typedProduct);
  if (!resolvedMaster) {
    throw new Error("master_source_missing_or_not_private");
  }

  const masterReference = `${resolvedMaster.bucket}/${resolvedMaster.path}`;
  const currentWatermarkHash = await computeWatermarkHash(settings);
  const currentPreviewSignature = await computePreviewSignature(masterReference, settings);

  if (typedProduct.preview_signature === currentPreviewSignature) {
    const processedAt = new Date().toISOString();

    console.log("[process-audio-jobs] skip - signature identical", {
      jobId: job.id,
      productId: typedProduct.id,
      previewSignature: currentPreviewSignature,
    });

    await updateProductProcessingState(supabaseAdmin, typedProduct.id, {
      processing_status: "done",
      processing_error: null,
      processed_at: processedAt,
      preview_signature: currentPreviewSignature,
      last_watermark_hash: currentWatermarkHash,
    });

    await updateJobStatus(supabaseAdmin, job.id, {
      status: "done",
      last_error: null,
      locked_at: null,
      locked_by: null,
    });

    return {
      status: "done",
      productId: typedProduct.id,
      skipped: true,
      reason: "signature_identical",
      previewSignature: currentPreviewSignature,
    };
  }

  const { data: masterBlob, error: masterDownloadError } = await supabaseAdmin.storage
    .from(resolvedMaster.bucket)
    .download(resolvedMaster.path);

  if (masterDownloadError || !masterBlob) {
    throw new Error(`download_master_failed:${masterDownloadError?.message ?? "unknown"}`);
  }

  if (masterBlob.size > MAX_MASTER_BYTES) {
    throw new Error("master_file_too_large");
  }

  const watermarkAsset = await loadWatermarkAsset();
  const targetVersion = Math.max(typedProduct.preview_version ?? 1, 1);
  const targetBucket = asNonEmptyString(typedProduct.watermarked_bucket) || WATERMARKED_BUCKET;
  const targetPath = `${typedProduct.id}/preview_v${targetVersion}.mp3`;
  const tempPrefix = `${typedProduct.id}-${job.id}`;
  const masterInputName = `${tempPrefix}-master.${guessMasterExtension(typedProduct, resolvedMaster.path)}`;
  const tagInputName = `${tempPrefix}-tag.mp3`;
  const outputName = `${tempPrefix}-output.mp3`;
  let ffmpeg: FFmpeg | null = null;

  try {
    ffmpeg = await getFfmpeg();
    const activeFfmpeg = ffmpeg;
    const masterBytes = await fetchFile(masterBlob);
    await activeFfmpeg.writeFile(masterInputName, masterBytes);
    await activeFfmpeg.writeFile(tagInputName, watermarkAsset.bytes);

    const { value: analyzeExitCode, logs: analyzeLogs } = await withLogCapture(activeFfmpeg, () =>
      activeFfmpeg.exec(["-i", masterInputName, "-f", "null", "-"], ANALYZE_TIMEOUT_MS)
    );

    const durationSec = parseDurationFromLogs(analyzeLogs);
    if (analyzeExitCode !== 0 || durationSec === null || durationSec <= 0) {
      throw new Error(`extract_duration_failed:${analyzeExitCode}`);
    }

    const positionsSec = generateWatermarkPositions(
      durationSec,
      Number.isFinite(settings.min_interval_sec) ? Number(settings.min_interval_sec) : 20,
      Number.isFinite(settings.max_interval_sec) ? Number(settings.max_interval_sec) : 45,
    );
    const positionsMs = positionsSec.map((value) => value * 1000);
    const filterComplex = buildFilterComplex(
      positionsMs,
      Number.isFinite(settings.gain_db) ? Number(settings.gain_db) : -10,
      durationSec,
    );

    console.log("[process-audio-jobs] job claimed", {
      jobId: job.id,
      productId: typedProduct.id,
      title: typedProduct.title,
      targetVersion,
      masterBytes: masterBlob.size,
      watermarkPath: watermarkAsset.path,
    });

    console.log("[process-audio-jobs] duration", {
      jobId: job.id,
      productId: typedProduct.id,
      durationSec: Number(durationSec.toFixed(3)),
    });

    console.log("[process-audio-jobs] watermark positions", {
      jobId: job.id,
      productId: typedProduct.id,
      positionsSec,
    });

    const { value: processExitCode, logs: processLogs } = await withLogCapture(activeFfmpeg, () =>
      activeFfmpeg.exec([
        "-i",
        masterInputName,
        "-i",
        tagInputName,
        "-filter_complex",
        filterComplex,
        "-map",
        "[outa]",
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-b:a",
        "192k",
        outputName,
      ], PROCESS_TIMEOUT_MS)
    );

    if (processExitCode !== 0) {
      const lastLogLine = processLogs.slice(-5).join(" | ");
      throw new Error(`ffmpeg_exec_failed:${processExitCode}:${lastLogLine}`);
    }

    const outputData = await activeFfmpeg.readFile(outputName);
    if (!(outputData instanceof Uint8Array)) {
      throw new Error("ffmpeg_output_invalid");
    }

    const outputBuffer = outputData.buffer.slice(
      outputData.byteOffset,
      outputData.byteOffset + outputData.byteLength,
    ) as ArrayBuffer;
    const outputBlob = new Blob([outputBuffer], { type: "audio/mpeg" });
    const { error: uploadError } = await supabaseAdmin.storage.from(targetBucket).upload(targetPath, outputBlob, {
      contentType: "audio/mpeg",
      cacheControl: "3600",
      upsert: true,
    });

    if (uploadError) {
      throw new Error(`upload_preview_failed:${uploadError.message}`);
    }

    const publicUrl = getPublicPreviewUrl(supabaseAdmin, targetBucket, targetPath);
    const storageReference = `${targetBucket}/${targetPath}`;
    const processedAt = new Date().toISOString();

    await updateProductProcessingState(supabaseAdmin, typedProduct.id, {
      watermarked_path: storageReference,
      preview_url: publicUrl,
      processing_status: "done",
      processing_error: null,
      processed_at: processedAt,
      watermarked_bucket: targetBucket,
      preview_version: targetVersion,
      preview_signature: currentPreviewSignature,
      last_watermark_hash: currentWatermarkHash,
    });

    await updateJobStatus(supabaseAdmin, job.id, {
      status: "done",
      last_error: null,
      locked_at: null,
      locked_by: null,
    });

    console.log("[process-audio-jobs] upload success", {
      jobId: job.id,
      productId: typedProduct.id,
      targetBucket,
      targetPath,
      outputBytes: outputBlob.size,
      previewVersion: targetVersion,
    });

    return {
      status: "done",
      productId: typedProduct.id,
      targetBucket,
      targetPath,
      previewSignature: currentPreviewSignature,
      watermarkHash: currentWatermarkHash,
      previewVersion: targetVersion,
      durationSec: Number(durationSec.toFixed(3)),
      positionsSec,
      outputBytes: outputBlob.size,
    };
  } finally {
    if (ffmpeg) {
      await safeDeleteFile(ffmpeg, masterInputName);
      await safeDeleteFile(ffmpeg, tagInputName);
      await safeDeleteFile(ffmpeg, outputName);
    }
  }
};

serveWithErrorHandling("process-audio-jobs", async (req: Request, context: RequestContext): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  // This function drives private storage and DB updates with service_role privileges.
  // Require a dedicated internal secret before any business logic is executed.
  const authError = requireInternalSecret(req);
  if (authError) {
    return authError;
  }

  let ffmpegContext: InvocationFfmpegContext | null = null;

  try {
    const supabaseAdmin = createAdminClient();
    const actor = "service-role";
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const limit = normalizeLimit(body.limit);
    const worker = normalizeWorkerName(body.worker);

    console.log("[process-audio-jobs] claim request", { actor, limit, worker });

    const { data: claimedJobs, error: claimError } = await supabaseAdmin.rpc("claim_audio_processing_jobs", {
      p_limit: limit,
      p_worker: worker,
    });

    if (claimError) {
      console.error("[process-audio-jobs] claim rpc failed", claimError);
      return new Response(JSON.stringify({ error: "Failed to claim audio processing jobs" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const jobs = (claimedJobs ?? []) as AudioProcessingJobRow[];
    const results: Array<Record<string, unknown>> = [];
    let processedCount = 0;
    let errorCount = 0;
    let deadCount = 0;

    const { data: settingsRow, error: settingsError } = await supabaseAdmin
      .from("site_audio_settings")
      .select("id, enabled, watermark_audio_path, gain_db, min_interval_sec, max_interval_sec")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settingsRow) {
      console.error("[process-audio-jobs] failed to load site audio settings", settingsError);
      return new Response(JSON.stringify({ error: "Failed to load site audio settings" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const typedSettings = settingsRow as SiteAudioSettingsRow;
    const loadWatermarkAsset = getWatermarkAssetLoader(supabaseAdmin, typedSettings);

    console.log("[process-audio-jobs] claimed jobs", {
      actor,
      claimed: jobs.length,
      worker,
      watermarkEnabled: typedSettings.enabled,
      hasWatermarkAsset: Boolean(asNonEmptyString(typedSettings.watermark_audio_path)),
    });

    for (const job of jobs) {
      try {
        const result = await processJob(
          supabaseAdmin,
          async () => {
            if (!ffmpegContext) {
              ffmpegContext = await initFfmpeg();
            }
            return ffmpegContext.ffmpeg;
          },
          job,
          typedSettings,
          loadWatermarkAsset,
        );

        if (result.status === "dead") {
          deadCount += 1;
        } else {
          processedCount += 1;
        }
        results.push({ job_id: job.id, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_processing_error";
        const nextStatus = job.attempts >= job.max_attempts ? "dead" : "error";

        console.error("[process-audio-jobs] job failed", {
          jobId: job.id,
          productId: job.product_id,
          message,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          nextStatus,
        });

        await updateJobStatus(supabaseAdmin, job.id, {
          status: nextStatus,
          last_error: message,
          locked_at: null,
          locked_by: null,
        });

        await updateProductProcessingState(supabaseAdmin, job.product_id, {
          processing_status: "error",
          processing_error: message,
          processed_at: null,
        });

        if (nextStatus === "dead") {
          deadCount += 1;
        } else {
          errorCount += 1;
        }

        results.push({
          job_id: job.id,
          product_id: job.product_id,
          status: nextStatus,
          error: message,
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      actor,
      worker,
      claimed: jobs.length,
      processed: processedCount,
      errors: errorCount,
      dead: deadCount,
      results,
      mode: "ffmpeg-wasm-watermark",
      notes: "FFmpeg.wasm processes private masters and publishes only watermarked previews.",
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[process-audio-jobs] unexpected error", error);
    captureException(error, context);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  } finally {
    disposeFfmpeg(ffmpegContext);
  }
});
