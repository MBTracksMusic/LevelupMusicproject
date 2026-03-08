import os from "node:os";
import path from "node:path";
import type { WorkerConfig } from "./types.js";

const DEFAULT_LEGACY_MASTER_BUCKET = "beats-audio";
const DEFAULT_WATERMARKED_BUCKET = "beats-watermarked";
const DEFAULT_WATERMARK_ASSETS_BUCKET = "watermark-assets";
const DEFAULT_BATCH_LIMIT = 3;
const DEFAULT_DOWNLOAD_MASTER_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_WATERMARK_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 5_000;
const DEFAULT_FFMPEG_TIMEOUT_MS = 120_000;
const DEFAULT_PREVIEW_AUDIO_BITRATE = "192k";
const DEFAULT_PREVIEW_AUDIO_SAMPLE_RATE = 44_100;
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;

const readEnv = (name: string) => process.env[name]?.trim() ?? "";

const requireEnv = (name: string) => {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const resolveServiceRoleKey = () => {
  const value = readEnv("SERVICE_ROLE_KEY") || readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!value) {
    throw new Error("Missing required environment variable: SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }
  return value;
};

const parsePositiveInt = (name: string, fallback: number) => {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${name}: ${raw}`);
  }
  return parsed;
};

const parseNonEmpty = (name: string, fallback: string) => {
  const raw = readEnv(name);
  return raw || fallback;
};

const resolveMasterBucket = () => {
  const masterBucket = readEnv("SUPABASE_MASTER_BUCKET") || readEnv("SUPABASE_AUDIO_BUCKET");
  if (!masterBucket) {
    throw new Error("Missing required environment variable: SUPABASE_MASTER_BUCKET or SUPABASE_AUDIO_BUCKET");
  }
  return masterBucket;
};

const buildDefaultWorkerId = () => {
  const host = os.hostname().replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${host}-${process.pid}`;
};

export const config: WorkerConfig = {
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: resolveServiceRoleKey(),
  masterBucket: resolveMasterBucket(),
  legacyMasterBucket: parseNonEmpty("LEGACY_BUCKET", DEFAULT_LEGACY_MASTER_BUCKET),
  watermarkedBucket: parseNonEmpty("SUPABASE_WATERMARKED_BUCKET", DEFAULT_WATERMARKED_BUCKET),
  watermarkAssetsBucket: parseNonEmpty(
    "SUPABASE_WATERMARK_ASSETS_BUCKET",
    DEFAULT_WATERMARK_ASSETS_BUCKET,
  ),
  workerId: parseNonEmpty("WORKER_ID", buildDefaultWorkerId()),
  batchLimit: parsePositiveInt("BATCH_LIMIT", DEFAULT_BATCH_LIMIT),
  downloadMasterMaxBytes: parsePositiveInt(
    "DOWNLOAD_MASTER_MAX_BYTES",
    DEFAULT_DOWNLOAD_MASTER_MAX_BYTES,
  ),
  watermarkMaxBytes: parsePositiveInt("WATERMARK_MAX_BYTES", DEFAULT_WATERMARK_MAX_BYTES),
  pollIntervalMs: parsePositiveInt("POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS),
  errorBackoffMs: parsePositiveInt("ERROR_BACKOFF_MS", DEFAULT_ERROR_BACKOFF_MS),
  ffmpegBin: parseNonEmpty("FFMPEG_BIN", "ffmpeg"),
  ffprobeBin: parseNonEmpty("FFPROBE_BIN", "ffprobe"),
  ffmpegTimeoutMs: parsePositiveInt("FFMPEG_TIMEOUT_MS", DEFAULT_FFMPEG_TIMEOUT_MS),
  previewAudioBitrate: parseNonEmpty("PREVIEW_AUDIO_BITRATE", DEFAULT_PREVIEW_AUDIO_BITRATE),
  previewAudioSampleRate: parsePositiveInt(
    "PREVIEW_AUDIO_SAMPLE_RATE",
    DEFAULT_PREVIEW_AUDIO_SAMPLE_RATE,
  ),
  jobTimeoutMs: parsePositiveInt("JOB_TIMEOUT_MS", DEFAULT_JOB_TIMEOUT_MS),
  tempRoot: parseNonEmpty("TMP_ROOT", path.join(os.tmpdir(), "levelup-audio-worker")),
  shutdownGraceMs: parsePositiveInt("SHUTDOWN_GRACE_MS", DEFAULT_SHUTDOWN_GRACE_MS),
};

export const publicConfig = {
  supabaseUrl: config.supabaseUrl,
  masterBucket: config.masterBucket,
  legacyMasterBucket: config.legacyMasterBucket,
  watermarkedBucket: config.watermarkedBucket,
  watermarkAssetsBucket: config.watermarkAssetsBucket,
  workerId: config.workerId,
  batchLimit: config.batchLimit,
  downloadMasterMaxBytes: config.downloadMasterMaxBytes,
  watermarkMaxBytes: config.watermarkMaxBytes,
  pollIntervalMs: config.pollIntervalMs,
  errorBackoffMs: config.errorBackoffMs,
  ffmpegBin: config.ffmpegBin,
  ffprobeBin: config.ffprobeBin,
  ffmpegTimeoutMs: config.ffmpegTimeoutMs,
  previewAudioBitrate: config.previewAudioBitrate,
  previewAudioSampleRate: config.previewAudioSampleRate,
  jobTimeoutMs: config.jobTimeoutMs,
  tempRoot: config.tempRoot,
  shutdownGraceMs: config.shutdownGraceMs,
};
