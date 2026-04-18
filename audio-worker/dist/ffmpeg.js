import { spawn } from "node:child_process";
import { once } from "node:events";
import { asFfmpegGainDb, generateWatermarkPositions } from "./watermark.js";
const MAX_LOG_LINES = 200;
const MAX_CAPTURE_STDOUT_CHARS = 8_192;
const MIN_WATERMARK_PITCH = 0.995;
const MAX_WATERMARK_PITCH = 1.005;
const keepTail = (lines, chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
        if (!line)
            continue;
        lines.push(line);
        if (lines.length > MAX_LOG_LINES) {
            lines.shift();
        }
    }
};
const toAbortError = (reason, fallbackMessage) => {
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === "string" && reason.length > 0) {
        return new Error(reason);
    }
    return new Error(fallbackMessage);
};
const runCommand = async (command, args, options = {}) => {
    const { timeoutMs, signal, captureStdout = false, stdoutMaxChars = MAX_CAPTURE_STDOUT_CHARS, } = options;
    if (signal?.aborted) {
        throw toAbortError(signal.reason, `${command} aborted before start`);
    }
    const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const tail = [];
    let timedOut = false;
    let aborted = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
        if (captureStdout) {
            stdout += chunk;
            if (stdout.length > stdoutMaxChars) {
                stdout = stdout.slice(-stdoutMaxChars);
            }
        }
        keepTail(tail, chunk);
    });
    child.stderr?.on("data", (chunk) => {
        keepTail(tail, chunk);
    });
    const onAbort = () => {
        aborted = true;
        child.kill("SIGKILL");
    };
    if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
    }
    const timeoutHandle = timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs)
        : null;
    try {
        const [exitCode] = (await Promise.race([
            once(child, "close"),
            once(child, "error").then(([error]) => {
                throw error;
            }),
        ]));
        if (timedOut) {
            throw new Error(`${command} timed out after ${timeoutMs}ms: ${tail.slice(-10).join(" | ")}`);
        }
        if (aborted) {
            throw toAbortError(signal?.reason, `${command} aborted`);
        }
        if (exitCode !== 0) {
            throw new Error(`${command} exited with code ${exitCode ?? "unknown"}: ${tail.slice(-10).join(" | ")}`);
        }
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        if (signal) {
            signal.removeEventListener("abort", onAbort);
        }
    }
    return { stdout, tail };
};
const buildFilterComplex = (delayPositionsMs, gainDb, durationSec, sampleRate) => {
    const sourceLabels = delayPositionsMs.map((_, index) => `tagsrc${index}`);
    const delayedLabels = delayPositionsMs.map((_, index) => `tagmix${index}`);
    const gainExpr = asFfmpegGainDb(gainDb);
    const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44_100;
    let filter = "";
    if (sourceLabels.length === 1) {
        filter += `[1:a]volume=${gainExpr}[${sourceLabels[0]}];`;
    }
    else {
        filter += `[1:a]volume=${gainExpr},asplit=${sourceLabels.length}${sourceLabels
            .map((label) => `[${label}]`)
            .join("")};`;
    }
    delayPositionsMs.forEach((delayMs, index) => {
        const pitchFactor = (MIN_WATERMARK_PITCH + Math.random() * (MAX_WATERMARK_PITCH - MIN_WATERMARK_PITCH)).toFixed(6);
        filter += `[${sourceLabels[index]}]asetrate=${safeSampleRate}*${pitchFactor},aresample=${safeSampleRate},adelay=${Math.max(0, Math.round(delayMs))}:all=true[${delayedLabels[index]}];`;
    });
    filter += `[0:a]${delayedLabels.map((label) => `[${label}]`).join("")}amix=inputs=${1 + delayedLabels.length}:normalize=0:dropout_transition=0,atrim=duration=${durationSec.toFixed(3)}[outa]`;
    return filter;
};
export const assertFfmpegAvailable = async (ffmpegBin, ffprobeBin) => {
    await runCommand(ffmpegBin, ["-version"]);
    await runCommand(ffprobeBin, ["-version"]);
};
export const probeAudioDurationSec = async (ffprobeBin, filePath, options = {}) => {
    const commandOptions = {
        captureStdout: true,
        stdoutMaxChars: 2_048,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
    };
    const { stdout } = await runCommand(ffprobeBin, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
    ], commandOptions);
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Invalid audio duration for ${filePath}: ${stdout.trim()}`);
    }
    return duration;
};
export const renderWatermarkedPreview = async (params) => {
    const durationSec = await probeAudioDurationSec(params.ffprobeBin, params.masterFilePath, {
        timeoutMs: params.ffmpegTimeoutMs,
        ...(params.signal ? { signal: params.signal } : {}),
    });
    const positionsSec = generateWatermarkPositions(durationSec, params.minIntervalSec, params.maxIntervalSec);
    const positionsMs = positionsSec.map((value) => value * 1000);
    const filterComplex = buildFilterComplex(positionsMs, params.gainDb, durationSec, params.audioSampleRate);
    await runCommand(params.ffmpegBin, [
        "-hide_banner",
        "-y",
        "-i",
        params.masterFilePath,
        "-i",
        params.watermarkFilePath,
        "-filter_complex",
        filterComplex,
        "-map",
        "[outa]",
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-ac",
        "2",
        "-ar",
        String(params.audioSampleRate),
        "-b:a",
        params.audioBitrate,
        params.outputFilePath,
    ], {
        timeoutMs: params.ffmpegTimeoutMs,
        ...(params.signal ? { signal: params.signal } : {}),
    });
    return {
        durationSec: Number(durationSec.toFixed(3)),
        positionsSec,
        outputPath: params.outputFilePath,
    };
};
