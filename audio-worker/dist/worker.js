import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeLoudness, applyLoudnorm, renderWatermarkedPreview } from "./ffmpeg.js";
import { claimAudioProcessingJobs, loadProductForProcessing, loadSiteAudioSettings, updateAudioProcessingJob, updateProductProcessingState, } from "./queue.js";
import { downloadObjectToFile, getPublicObjectUrl, guessMasterExtension, loadWatermarkAsset, objectExists, resolveMasterDownloadSource, storageRefToString, uploadPreviewFile, } from "./storage.js";
import { captureWorkerException } from "./sentry.js";
import { computePreviewSignature, computeWatermarkHash } from "./watermark.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (level, event, meta = {}) => {
    const payload = {
        level,
        event,
        ts: new Date().toISOString(),
        ...meta,
    };
    const line = JSON.stringify(payload);
    if (level === "error") {
        captureWorkerException(meta.error ?? new Error(event), {
            serviceName: "audio-worker",
            event,
            ...meta,
        });
        console.error(line);
        return;
    }
    if (level === "warn") {
        console.warn(line);
        return;
    }
    console.info(line);
};
const toErrorMessage = (error) => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
};
const isWatermarkPausedError = (error) => {
    const message = toErrorMessage(error);
    return (message.includes("watermark_disabled") ||
        message.includes("watermark_audio_path_missing") ||
        message.includes("active site_audio_settings row not found") ||
        message.includes("Failed to load site_audio_settings"));
};
const toAbortError = (signal, fallbackMessage) => {
    const reason = signal?.reason;
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === "string" && reason.length > 0) {
        return new Error(reason);
    }
    return new Error(fallbackMessage);
};
const throwIfAborted = (signal) => {
    if (signal?.aborted) {
        throw toAbortError(signal, "job_aborted");
    }
};
export class AudioWorkerService {
    supabase;
    config;
    stopRequested = false;
    cachedWatermarkAsset = null;
    constructor(params) {
        this.supabase = params.supabase;
        this.config = params.config;
    }
    stop() {
        this.stopRequested = true;
    }
    async run() {
        await fs.mkdir(this.config.tempRoot, { recursive: true });
        await this.cleanupTempRootOnStartup();
        while (!this.stopRequested) {
            try {
                const processedCount = await this.processBatch();
                if (!this.stopRequested) {
                    // Always wait between cycles — avoids tight loop when jobs arrive in batches
                    const delay = processedCount === 0 ? this.config.pollIntervalMs : Math.floor(this.config.pollIntervalMs / 3);
                    await sleep(delay);
                }
            }
            catch (error) {
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
    async processBatch() {
        const jobs = await claimAudioProcessingJobs(this.supabase, this.config.batchLimit, this.config.workerId);
        log("info", "claimed_jobs", {
            workerId: this.config.workerId,
            count: jobs.length,
            jobIds: jobs.map((job) => job.id),
        });
        if (jobs.length === 0) {
            return 0;
        }
        let settings;
        let currentWatermarkHash;
        let watermarkAsset;
        try {
            settings = await loadSiteAudioSettings(this.supabase);
            currentWatermarkHash = computeWatermarkHash(settings);
            watermarkAsset = await this.getWatermarkAsset(settings, currentWatermarkHash);
        }
        catch (error) {
            if (isWatermarkPausedError(error)) {
                await this.pauseClaimedJobs(jobs, error);
                return 0;
            }
            for (const job of jobs) {
                await this.failClaimedJob(job, error);
            }
            return jobs.length;
        }
        for (let index = 0; index < jobs.length; index += 1) {
            const job = jobs[index];
            if (this.stopRequested) {
                await this.requeueClaimedJobs(jobs.slice(index));
                break;
            }
            try {
                await this.processClaimedJobWithTimeout(job, settings, currentWatermarkHash, watermarkAsset);
            }
            catch (error) {
                await this.failClaimedJob(job, error);
            }
        }
        return jobs.length;
    }
    async cleanupTempRootOnStartup() {
        const entries = await fs.readdir(this.config.tempRoot, { withFileTypes: true });
        if (entries.length === 0) {
            return;
        }
        for (const entry of entries) {
            const entryPath = path.join(this.config.tempRoot, entry.name);
            await fs.rm(entryPath, { recursive: true, force: true });
        }
        log("info", "startup_temp_root_cleaned", {
            workerId: this.config.workerId,
            tempRoot: this.config.tempRoot,
            removedEntries: entries.length,
        });
    }
    async requeueClaimedJobs(jobs) {
        for (const job of jobs) {
            try {
                await updateAudioProcessingJob(this.supabase, job.id, {
                    status: "queued",
                    last_error: null,
                    locked_at: null,
                    locked_by: null,
                });
                log("warn", "job_requeued_on_shutdown", {
                    workerId: this.config.workerId,
                    jobId: job.id,
                    productId: job.product_id,
                });
            }
            catch (error) {
                log("error", "job_requeue_failed_on_shutdown", {
                    workerId: this.config.workerId,
                    jobId: job.id,
                    productId: job.product_id,
                    error: toErrorMessage(error),
                });
            }
        }
    }
    async processClaimedJobWithTimeout(job, settings, currentWatermarkHash, watermarkAsset) {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => {
            controller.abort(new Error(`job_timeout_exceeded_after_${this.config.jobTimeoutMs}ms`));
        }, this.config.jobTimeoutMs);
        try {
            await this.processClaimedJob(job, settings, currentWatermarkHash, watermarkAsset, controller.signal);
        }
        finally {
            clearTimeout(timeoutHandle);
        }
    }
    async pauseClaimedJobs(jobs, error) {
        const message = toErrorMessage(error);
        for (const job of jobs) {
            try {
                await updateAudioProcessingJob(this.supabase, job.id, {
                    status: "queued",
                    attempts: Math.max((job.attempts ?? 1) - 1, 0),
                    last_error: message,
                    locked_at: null,
                    locked_by: null,
                });
            }
            catch (pauseError) {
                log("error", "job_pause_requeue_failed", {
                    workerId: this.config.workerId,
                    jobId: job.id,
                    productId: job.product_id,
                    originalError: message,
                    error: toErrorMessage(pauseError),
                });
            }
        }
        log("warn", "watermark_queue_paused", {
            workerId: this.config.workerId,
            reason: message,
            jobCount: jobs.length,
            jobIds: jobs.map((job) => job.id),
        });
    }
    async getWatermarkAsset(settings, currentWatermarkHash) {
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
        const asset = await loadWatermarkAsset(this.supabase, this.config, settings.watermark_audio_path);
        this.cachedWatermarkAsset = {
            cacheKey,
            asset,
        };
        return asset;
    }
    async processClaimedJob(job, settings, currentWatermarkHash, watermarkAsset, signal) {
        throwIfAborted(signal);
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
        const isWatermarkableProduct = product.product_type === "beat" || product.product_type === "exclusive";
        if (!isWatermarkableProduct || !product.is_published || product.deleted_at) {
            await updateProductProcessingState(this.supabase, product.id, {
                processing_status: "done",
                processing_error: null,
                processed_at: null,
            });
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
        throwIfAborted(signal);
        const targetVersion = Math.max(product.preview_version ?? 1, 1);
        const targetRef = {
            bucket: product.watermarked_bucket?.trim() || this.config.watermarkedBucket,
            path: `${product.id}/preview_v${targetVersion}.mp3`,
        };
        const masterReference = storageRefToString(masterRef);
        const previewSignature = computePreviewSignature(masterReference, settings);
        if (product.preview_signature === previewSignature &&
            product.last_watermark_hash === currentWatermarkHash) {
            const targetExists = await objectExists(this.supabase, targetRef).catch(() => false);
            if (targetExists) {
                const previewPublicUrl = getPublicObjectUrl(this.supabase, targetRef);
                await updateProductProcessingState(this.supabase, product.id, {
                    watermarked_path: storageRefToString(targetRef),
                    preview_url: previewPublicUrl,
                    ...(product.product_type === "exclusive" ? { exclusive_preview_url: previewPublicUrl } : {}),
                    watermarked_bucket: targetRef.bucket,
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
                    previewRef: storageRefToString(targetRef),
                    previewVersion: targetVersion,
                });
                return;
            }
        }
        await updateProductProcessingState(this.supabase, product.id, {
            processing_status: "processing",
            processing_error: null,
        });
        throwIfAborted(signal);
        const tempDir = await fs.mkdtemp(path.join(this.config.tempRoot, `${product.id}-${job.id}-${randomUUID()}-`));
        const masterExt = guessMasterExtension(product, masterRef.path);
        const masterFilePath = path.join(tempDir, `master.${masterExt}`);
        const watermarkFilePath = path.join(tempDir, "watermark.mp3");
        const normalizedFilePath = path.join(tempDir, `normalized_${job.id}.wav`);
        const firstLayerOutputFilePath = path.join(tempDir, "preview-layer1.mp3");
        const outputFilePath = path.join(tempDir, "preview.mp3");
        try {
            await downloadObjectToFile(this.supabase, downloadMasterRef, this.config.downloadMasterMaxBytes, masterFilePath, signal);
            throwIfAborted(signal);
            // ----- Loudness normalization (feature-flagged, master never touched) -----
            const loudnormState = await this.maybeNormalizeMaster({
                job,
                product,
                settings,
                masterFilePath,
                normalizedFilePath,
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            await fs.writeFile(watermarkFilePath, watermarkAsset.buffer);
            throwIfAborted(signal);
            const primaryGainDb = Number.isFinite(settings.gain_db) ? Number(settings.gain_db) : -10;
            const subtleGainDb = Math.max(primaryGainDb - 18, -60);
            const minIntervalSec = Number.isFinite(settings.min_interval_sec)
                ? Number(settings.min_interval_sec)
                : 20;
            const maxIntervalSec = Number.isFinite(settings.max_interval_sec)
                ? Number(settings.max_interval_sec)
                : 45;
            const primaryRenderResult = await renderWatermarkedPreview({
                masterFilePath: loudnormState.inputForWatermark,
                watermarkFilePath,
                outputFilePath: firstLayerOutputFilePath,
                gainDb: primaryGainDb,
                minIntervalSec,
                maxIntervalSec,
                ffmpegBin: this.config.ffmpegBin,
                ffprobeBin: this.config.ffprobeBin,
                ffmpegTimeoutMs: Math.min(this.config.ffmpegTimeoutMs, this.config.jobTimeoutMs),
                audioBitrate: this.config.previewAudioBitrate,
                audioSampleRate: this.config.previewAudioSampleRate,
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            const secondaryRenderResult = await renderWatermarkedPreview({
                masterFilePath: firstLayerOutputFilePath,
                watermarkFilePath,
                outputFilePath,
                gainDb: subtleGainDb,
                minIntervalSec,
                maxIntervalSec,
                ffmpegBin: this.config.ffmpegBin,
                ffprobeBin: this.config.ffprobeBin,
                ffmpegTimeoutMs: Math.min(this.config.ffmpegTimeoutMs, this.config.jobTimeoutMs),
                audioBitrate: this.config.previewAudioBitrate,
                audioSampleRate: this.config.previewAudioSampleRate,
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            const outputStat = await fs.stat(outputFilePath);
            if (!outputStat.isFile() || outputStat.size === 0) {
                throw new Error("ffmpeg_output_empty");
            }
            throwIfAborted(signal);
            await uploadPreviewFile(this.supabase, targetRef, outputFilePath);
            throwIfAborted(signal);
            const previewPublicUrl = getPublicObjectUrl(this.supabase, targetRef);
            await updateProductProcessingState(this.supabase, product.id, {
                watermarked_path: storageRefToString(targetRef),
                preview_url: previewPublicUrl,
                ...(product.product_type === "exclusive" ? { exclusive_preview_url: previewPublicUrl } : {}),
                processing_status: "done",
                processing_error: null,
                processed_at: new Date().toISOString(),
                watermarked_bucket: targetRef.bucket,
                preview_version: targetVersion,
                preview_signature: previewSignature,
                last_watermark_hash: currentWatermarkHash,
                ...loudnormState.productPatch,
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
                previewVersion: targetVersion,
                outputBytes: outputStat.size,
                durationSec: secondaryRenderResult.durationSec,
                positionsSec: secondaryRenderResult.positionsSec,
                primaryWatermarkPositionsSec: primaryRenderResult.positionsSec,
                secondaryWatermarkGainDb: subtleGainDb,
                loudnormApplied: loudnormState.applied,
                loudnormError: loudnormState.errorMessage,
                measuredLufs: loudnormState.measurement?.input_i ?? null,
                measuredTruePeakDb: loudnormState.measurement?.input_tp ?? null,
            });
        }
        finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }
    /**
     * Optionally normalize the master to a temp WAV before watermarking.
     *
     * Critical guarantees:
     *   - Reads the feature flag and targets from site_audio_settings ONLY
     *     (with config-level env var fallbacks if the row is missing them).
     *   - Returns `inputForWatermark = masterFilePath` whenever loudnorm is
     *     disabled OR fails, so the watermark pipeline always has something
     *     to chew on.
     *   - Never throws on loudnorm errors — they are surfaced via
     *     `errorMessage` and persisted to `products.normalization_error`,
     *     but the surrounding job continues.
     *   - The master file on Supabase Storage is never read-back, modified,
     *     or re-uploaded by this method.
     */
    async maybeNormalizeMaster(params) {
        const { job, product, settings, masterFilePath, normalizedFilePath, signal } = params;
        // site_audio_settings is the source of truth; env-derived defaults
        // (from config) are only consulted when the column is null/undefined.
        const enabled = settings.loudnorm_enabled === null || settings.loudnorm_enabled === undefined
            ? this.config.loudnormEnabledDefault
            : settings.loudnorm_enabled === true;
        if (!enabled) {
            // Feature flag OFF — pipeline behaves exactly as before this change.
            // We DO NOT overwrite the existing measured_* / normalization_* columns,
            // so prior measurements survive a flag toggle.
            return {
                inputForWatermark: masterFilePath,
                applied: false,
                measurement: null,
                errorMessage: null,
                productPatch: {},
            };
        }
        const targets = {
            targetLufs: Number.isFinite(settings.target_lufs)
                ? Number(settings.target_lufs)
                : this.config.loudnormTargetLufsDefault,
            targetTruePeakDb: Number.isFinite(settings.target_true_peak_db)
                ? Number(settings.target_true_peak_db)
                : this.config.loudnormTargetTruePeakDbDefault,
            targetLra: Number.isFinite(settings.target_lra)
                ? Number(settings.target_lra)
                : this.config.loudnormTargetLraDefault,
        };
        try {
            const analysis = await analyzeLoudness(masterFilePath, targets, {
                ffmpegBin: this.config.ffmpegBin,
                ffmpegTimeoutMs: Math.min(this.config.ffmpegTimeoutMs, this.config.jobTimeoutMs),
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            await applyLoudnorm(masterFilePath, normalizedFilePath, analysis, targets, {
                ffmpegBin: this.config.ffmpegBin,
                ffmpegTimeoutMs: Math.min(this.config.ffmpegTimeoutMs, this.config.jobTimeoutMs),
                sampleRate: this.config.previewAudioSampleRate,
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            log("info", "loudnorm_applied", {
                workerId: this.config.workerId,
                jobId: job.id,
                productId: product.id,
                measured: analysis,
                targets,
            });
            return {
                inputForWatermark: normalizedFilePath,
                applied: true,
                measurement: analysis,
                errorMessage: null,
                productPatch: {
                    measured_lufs: Number(analysis.input_i.toFixed(2)),
                    measured_true_peak_db: Number(analysis.input_tp.toFixed(2)),
                    normalization_applied: true,
                    normalization_error: null,
                },
            };
        }
        catch (error) {
            // If the abort signal fired, re-throw — the surrounding job loop
            // expects the abort error to bubble. Anything else is contained.
            if (signal?.aborted) {
                throw error;
            }
            const message = toErrorMessage(error);
            log("warn", "loudnorm_failed_falling_back_to_master", {
                workerId: this.config.workerId,
                jobId: job.id,
                productId: product.id,
                error: message,
            });
            return {
                inputForWatermark: masterFilePath,
                applied: false,
                measurement: null,
                errorMessage: message,
                productPatch: {
                    normalization_applied: false,
                    normalization_error: message,
                },
            };
        }
    }
    async failClaimedJob(job, error) {
        const message = toErrorMessage(error);
        const nextStatus = job.attempts >= job.max_attempts ? "dead" : "error";
        try {
            await updateAudioProcessingJob(this.supabase, job.id, {
                status: nextStatus,
                last_error: message,
                locked_at: null,
                locked_by: null,
            });
        }
        catch (jobUpdateError) {
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
        }
        catch (productUpdateError) {
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
