import os from "node:os";
import path from "node:path";
const DEFAULT_MASTER_BUCKET = "beats-masters";
const DEFAULT_LEGACY_MASTER_BUCKET = "beats-audio";
const DEFAULT_WATERMARKED_BUCKET = "beats-watermarked";
const DEFAULT_WATERMARK_ASSETS_BUCKET = "watermark-assets";
const DEFAULT_BATCH_LIMIT = 3;
const DEFAULT_DOWNLOAD_MASTER_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_WATERMARK_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 5_000;
const DEFAULT_PREVIEW_AUDIO_BITRATE = "192k";
const DEFAULT_PREVIEW_AUDIO_SAMPLE_RATE = 44_100;
const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;
const readEnv = (name) => process.env[name]?.trim() ?? "";
const requireEnv = (name) => {
    const value = readEnv(name);
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};
const parsePositiveInt = (name, fallback) => {
    const raw = readEnv(name);
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid positive integer for ${name}: ${raw}`);
    }
    return parsed;
};
const parseNonEmpty = (name, fallback) => {
    const raw = readEnv(name);
    return raw || fallback;
};
const buildDefaultWorkerId = () => {
    const host = os.hostname().replace(/[^a-zA-Z0-9._-]/g, "-");
    return `${host}-${process.pid}`;
};
export const config = {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    masterBucket: parseNonEmpty("SUPABASE_AUDIO_BUCKET", DEFAULT_MASTER_BUCKET),
    legacyMasterBucket: parseNonEmpty("LEGACY_BUCKET", DEFAULT_LEGACY_MASTER_BUCKET),
    watermarkedBucket: parseNonEmpty("SUPABASE_WATERMARKED_BUCKET", DEFAULT_WATERMARKED_BUCKET),
    watermarkAssetsBucket: parseNonEmpty("SUPABASE_WATERMARK_ASSETS_BUCKET", DEFAULT_WATERMARK_ASSETS_BUCKET),
    workerId: parseNonEmpty("WORKER_ID", buildDefaultWorkerId()),
    batchLimit: parsePositiveInt("BATCH_LIMIT", DEFAULT_BATCH_LIMIT),
    downloadMasterMaxBytes: parsePositiveInt("DOWNLOAD_MASTER_MAX_BYTES", DEFAULT_DOWNLOAD_MASTER_MAX_BYTES),
    watermarkMaxBytes: parsePositiveInt("WATERMARK_MAX_BYTES", DEFAULT_WATERMARK_MAX_BYTES),
    pollIntervalMs: parsePositiveInt("POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS),
    errorBackoffMs: parsePositiveInt("ERROR_BACKOFF_MS", DEFAULT_ERROR_BACKOFF_MS),
    ffmpegBin: parseNonEmpty("FFMPEG_BIN", "ffmpeg"),
    ffprobeBin: parseNonEmpty("FFPROBE_BIN", "ffprobe"),
    previewAudioBitrate: parseNonEmpty("PREVIEW_AUDIO_BITRATE", DEFAULT_PREVIEW_AUDIO_BITRATE),
    previewAudioSampleRate: parsePositiveInt("PREVIEW_AUDIO_SAMPLE_RATE", DEFAULT_PREVIEW_AUDIO_SAMPLE_RATE),
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
    previewAudioBitrate: config.previewAudioBitrate,
    previewAudioSampleRate: config.previewAudioSampleRate,
    tempRoot: config.tempRoot,
    shutdownGraceMs: config.shutdownGraceMs,
};
