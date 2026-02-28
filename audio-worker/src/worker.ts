import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderWatermarkedPreview } from "./ffmpeg.js";
import {
  claimAudioProcessingJobs,
  loadProductForProcessing,
  loadSiteAudioSettings,
  updateAudioProcessingJob,
  updateProductProcessingState,
} from "./queue.js";
import {
  downloadObjectBuffer,
  getPublicObjectUrl,
  guessMasterExtension,
  loadWatermarkAsset,
  objectExists,
  resolveMasterDownloadSource,
  resolveMasterReference,
  resolvePreviewReference,
  storageRefToString,
  uploadPreviewBuffer,
} from "./storage.js";
import type {
  AudioProcessingJobRow,
  SiteAudioSettingsRow,
  StorageObjectRef,
  SupabaseAdminClient,
  WatermarkAsset,
  WorkerConfig,
} from "./types.js";
import { computePreviewSignature, computeWatermarkHash } from "./watermark.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (level: "info" | "warn" | "error", event: string, meta: Record<string, unknown> = {}) => {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...meta,
  };
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
};

export class AudioWorkerService {
  private readonly supabase: SupabaseAdminClient;
  private readonly config: WorkerConfig;
  private stopRequested = false;
  private cachedWatermarkAsset:
    | {
        cacheKey: string;
        asset: WatermarkAsset;
      }
    | null = null;

  constructor(params: { supabase: SupabaseAdminClient; config: WorkerConfig }) {
    this.supabase = params.supabase;
    this.config = params.config;
  }

  stop() {
    this.stopRequested = true;
  }

  async run() {
    await fs.mkdir(this.config.tempRoot, { recursive: true });

    while (!this.stopRequested) {
      try {
        const processedCount = await this.processBatch();
        if (processedCount === 0 && !this.stopRequested) {
          await sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        log("error", "worker_loop_failed", {
          workerId: this.config.workerId,
          error: toErrorMessage(error),
        });

        if (!this.stopRequested) {
          await sleep(this.config.errorBackoffMs);
        }
      }
    }
  }

  private async processBatch() {
    const jobs = await claimAudioProcessingJobs(
      this.supabase,
      this.config.batchLimit,
      this.config.workerId,
    );

    log("info", "claimed_jobs", {
      workerId: this.config.workerId,
      count: jobs.length,
      jobIds: jobs.map((job) => job.id),
    });

    if (jobs.length === 0) {
      return 0;
    }

    let settings: SiteAudioSettingsRow;
    let currentWatermarkHash: string;
    let watermarkAsset: WatermarkAsset;

    try {
      settings = await loadSiteAudioSettings(this.supabase);
      currentWatermarkHash = computeWatermarkHash(settings);
      watermarkAsset = await this.getWatermarkAsset(settings, currentWatermarkHash);
    } catch (error) {
      for (const job of jobs) {
        await this.failClaimedJob(job, error);
      }
      return jobs.length;
    }

    for (const job of jobs) {
      if (this.stopRequested) break;

      try {
        await this.processClaimedJob(job, settings, currentWatermarkHash, watermarkAsset);
      } catch (error) {
        await this.failClaimedJob(job, error);
      }
    }

    return jobs.length;
  }

  private async getWatermarkAsset(
    settings: SiteAudioSettingsRow,
    currentWatermarkHash: string,
  ) {
    if (!settings.enabled) {
      throw new Error("watermark_disabled");
    }

    if (!settings.watermark_audio_path) {
      throw new Error("watermark_audio_path_missing");
    }

    const cacheKey = `${currentWatermarkHash}:${settings.watermark_audio_path}`;
    if (this.cachedWatermarkAsset?.cacheKey === cacheKey) {
      return this.cachedWatermarkAsset.asset;
    }

    const asset = await loadWatermarkAsset(
      this.supabase,
      this.config,
      settings.watermark_audio_path,
    );

    this.cachedWatermarkAsset = {
      cacheKey,
      asset,
    };

    return asset;
  }

  private async processClaimedJob(
    job: AudioProcessingJobRow,
    settings: SiteAudioSettingsRow,
    currentWatermarkHash: string,
    watermarkAsset: WatermarkAsset,
  ) {
    log("info", "job_started", {
      workerId: this.config.workerId,
      jobId: job.id,
      productId: job.product_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
    });

    const product = await loadProductForProcessing(this.supabase, job.product_id);
    if (!product) {
      await updateAudioProcessingJob(this.supabase, job.id, {
        status: "dead",
        last_error: "product_not_found",
        locked_at: null,
        locked_by: null,
      });

      log("warn", "job_dead_product_not_found", {
        workerId: this.config.workerId,
        jobId: job.id,
        productId: job.product_id,
      });
      return;
    }

    if (product.product_type !== "beat" || !product.is_published || product.deleted_at) {
      await updateAudioProcessingJob(this.supabase, job.id, {
        status: "done",
        last_error: null,
        locked_at: null,
        locked_by: null,
      });

      log("info", "job_skipped_ineligible_product", {
        workerId: this.config.workerId,
        jobId: job.id,
        productId: product.id,
        productType: product.product_type,
        isPublished: product.is_published,
        deletedAt: product.deleted_at,
      });
      return;
    }

    const masterSource = await resolveMasterDownloadSource(this.supabase, product, this.config);
    if (!masterSource) {
      throw new Error("master_source_missing_or_not_private");
    }

    const masterRef = masterSource.canonicalRef;
    const downloadMasterRef = masterSource.downloadRef;

    if (masterSource.usedLegacyFallback) {
      log("info", "legacy_master_fallback", {
        productId: product.id,
        path: downloadMasterRef.path,
      });
    }

    const nextVersion = Math.max(product.preview_version ?? 1, 1);
    const targetRef: StorageObjectRef = {
      bucket: product.watermarked_bucket?.trim() || this.config.watermarkedBucket,
      path: `${product.id}/preview_v${nextVersion}.mp3`,
    };
    const masterReference = storageRefToString(masterRef);
    const previewSignature = computePreviewSignature(masterReference, settings);
    const existingPreviewRef = resolvePreviewReference(product, this.config);

    if (
      product.preview_signature === previewSignature &&
      product.last_watermark_hash === currentWatermarkHash
    ) {
      const targetExists = await objectExists(this.supabase, targetRef).catch(() => false);
      const existingPreviewExists = existingPreviewRef
        ? await objectExists(this.supabase, existingPreviewRef).catch(() => false)
        : false;

      const skipRef = targetExists
        ? targetRef
        : existingPreviewExists &&
            existingPreviewRef &&
            existingPreviewRef.bucket === targetRef.bucket
          ? existingPreviewRef
          : null;
      if (skipRef) {
        await updateProductProcessingState(this.supabase, product.id, {
          watermarked_path: storageRefToString(skipRef),
          preview_url: getPublicObjectUrl(this.supabase, skipRef),
          watermarked_bucket: skipRef.bucket,
          preview_version: nextVersion,
          processing_status: "done",
          processing_error: null,
          processed_at: new Date().toISOString(),
          preview_signature: previewSignature,
          last_watermark_hash: currentWatermarkHash,
        });

        await updateAudioProcessingJob(this.supabase, job.id, {
          status: "done",
          last_error: null,
          locked_at: null,
          locked_by: null,
        });

        log("info", "job_skipped_signature_match", {
          workerId: this.config.workerId,
          jobId: job.id,
          productId: product.id,
          previewRef: storageRefToString(skipRef),
          previewVersion: nextVersion,
        });
        return;
      }
    }

    await updateProductProcessingState(this.supabase, product.id, {
      processing_status: "processing",
      processing_error: null,
    });

    const masterBuffer = await downloadObjectBuffer(
      this.supabase,
      downloadMasterRef,
      this.config.downloadMasterMaxBytes,
    );

    const tempDir = await fs.mkdtemp(
      path.join(this.config.tempRoot, `${product.id}-${job.id}-${randomUUID()}-`),
    );
    const masterExt = guessMasterExtension(product, masterRef.path);
    const masterFilePath = path.join(tempDir, `master.${masterExt}`);
    const watermarkFilePath = path.join(tempDir, "watermark.mp3");
    const outputFilePath = path.join(tempDir, "preview.mp3");

    try {
      await fs.writeFile(masterFilePath, masterBuffer);
      await fs.writeFile(watermarkFilePath, watermarkAsset.buffer);

      const renderResult = await renderWatermarkedPreview({
        masterFilePath,
        watermarkFilePath,
        outputFilePath,
        gainDb: Number.isFinite(settings.gain_db) ? Number(settings.gain_db) : -10,
        minIntervalSec: Number.isFinite(settings.min_interval_sec)
          ? Number(settings.min_interval_sec)
          : 20,
        maxIntervalSec: Number.isFinite(settings.max_interval_sec)
          ? Number(settings.max_interval_sec)
          : 45,
        ffmpegBin: this.config.ffmpegBin,
        ffprobeBin: this.config.ffprobeBin,
        audioBitrate: this.config.previewAudioBitrate,
        audioSampleRate: this.config.previewAudioSampleRate,
      });

      const outputBuffer = await fs.readFile(outputFilePath);
      if (outputBuffer.byteLength === 0) {
        throw new Error("ffmpeg_output_empty");
      }

      await uploadPreviewBuffer(this.supabase, targetRef, outputBuffer);

      await updateProductProcessingState(this.supabase, product.id, {
        watermarked_path: storageRefToString(targetRef),
        preview_url: getPublicObjectUrl(this.supabase, targetRef),
        processing_status: "done",
        processing_error: null,
        processed_at: new Date().toISOString(),
        watermarked_bucket: targetRef.bucket,
        preview_version: nextVersion,
        preview_signature: previewSignature,
        last_watermark_hash: currentWatermarkHash,
      });

      await updateAudioProcessingJob(this.supabase, job.id, {
        status: "done",
        last_error: null,
        locked_at: null,
        locked_by: null,
      });

      log("info", "job_succeeded", {
        workerId: this.config.workerId,
        jobId: job.id,
        productId: product.id,
        masterRef: storageRefToString(downloadMasterRef),
        previewRef: storageRefToString(targetRef),
        previewVersion: nextVersion,
        outputBytes: outputBuffer.byteLength,
        durationSec: renderResult.durationSec,
        positionsSec: renderResult.positionsSec,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async failClaimedJob(job: AudioProcessingJobRow, error: unknown) {
    const message = toErrorMessage(error);
    const nextStatus = job.attempts >= job.max_attempts ? "dead" : "error";

    try {
      await updateAudioProcessingJob(this.supabase, job.id, {
        status: nextStatus,
        last_error: message,
        locked_at: null,
        locked_by: null,
      });
    } catch (jobUpdateError) {
      log("error", "job_update_failed_after_error", {
        workerId: this.config.workerId,
        jobId: job.id,
        originalError: message,
        updateError: toErrorMessage(jobUpdateError),
      });
    }

    try {
      await updateProductProcessingState(this.supabase, job.product_id, {
        processing_status: "error",
        processing_error: message,
        processed_at: null,
      });
    } catch (productUpdateError) {
      log("error", "product_update_failed_after_error", {
        workerId: this.config.workerId,
        jobId: job.id,
        productId: job.product_id,
        originalError: message,
        updateError: toErrorMessage(productUpdateError),
      });
    }

    log("error", "job_failed", {
      workerId: this.config.workerId,
      jobId: job.id,
      productId: job.product_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      nextStatus,
      error: message,
    });
  }
}
