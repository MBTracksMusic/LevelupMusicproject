import type { SupabaseClient } from "@supabase/supabase-js";

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  masterBucket: string;
  legacyMasterBucket: string;
  watermarkedBucket: string;
  watermarkAssetsBucket: string;
  workerId: string;
  batchLimit: number;
  downloadMasterMaxBytes: number;
  watermarkMaxBytes: number;
  pollIntervalMs: number;
  errorBackoffMs: number;
  ffmpegBin: string;
  ffprobeBin: string;
  previewAudioBitrate: string;
  previewAudioSampleRate: number;
  tempRoot: string;
  shutdownGraceMs: number;
}

export interface AudioProcessingJobRow {
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

export interface ProductRow {
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
  processing_status: string | null;
  processing_error: string | null;
  processed_at: string | null;
}

export interface SiteAudioSettingsRow {
  id: string;
  enabled: boolean;
  watermark_audio_path: string | null;
  gain_db: number | null;
  min_interval_sec: number | null;
  max_interval_sec: number | null;
  created_at: string;
  updated_at: string;
}

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

export interface WatermarkAsset {
  ref: StorageObjectRef;
  buffer: Buffer;
}

export interface RenderPreviewParams {
  masterFilePath: string;
  watermarkFilePath: string;
  outputFilePath: string;
  gainDb: number;
  minIntervalSec: number;
  maxIntervalSec: number;
  ffmpegBin: string;
  ffprobeBin: string;
  audioBitrate: string;
  audioSampleRate: number;
}

export interface RenderPreviewResult {
  durationSec: number;
  positionsSec: number[];
  outputPath: string;
}

export type SupabaseAdminClient = SupabaseClient;
