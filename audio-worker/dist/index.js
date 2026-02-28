import { assertFfmpegAvailable } from "./ffmpeg.js";
import { config, publicConfig } from "./config.js";
import { createSupabaseAdminClient } from "./supabaseClient.js";
import { AudioWorkerService } from "./worker.js";
const log = (level, event, meta = {}) => {
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
const main = async () => {
    await assertFfmpegAvailable(config.ffmpegBin, config.ffprobeBin);
    const supabase = createSupabaseAdminClient(config);
    const worker = new AudioWorkerService({ supabase, config });
    log("info", "worker_starting", publicConfig);
    const runPromise = worker.run();
    let shutdownStarted = false;
    const shutdown = async (signal) => {
        if (shutdownStarted)
            return;
        shutdownStarted = true;
        log("warn", "shutdown_requested", {
            signal,
            workerId: config.workerId,
        });
        worker.stop();
        const forceExitTimer = setTimeout(() => {
            log("error", "shutdown_timeout", {
                signal,
                workerId: config.workerId,
                shutdownGraceMs: config.shutdownGraceMs,
            });
            process.exit(1);
        }, config.shutdownGraceMs);
        try {
            await runPromise;
            clearTimeout(forceExitTimer);
            log("info", "worker_stopped", {
                workerId: config.workerId,
            });
            process.exit(0);
        }
        catch (error) {
            clearTimeout(forceExitTimer);
            log("error", "worker_stopped_with_error", {
                workerId: config.workerId,
                error: error instanceof Error ? error.message : String(error),
            });
            process.exit(1);
        }
    };
    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    await runPromise;
};
main().catch((error) => {
    log("error", "worker_boot_failed", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
