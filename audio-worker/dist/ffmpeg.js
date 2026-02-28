import { spawn } from "node:child_process";
import { once } from "node:events";
import { asFfmpegGainDb, generateWatermarkPositions } from "./watermark.js";
const MAX_LOG_LINES = 200;
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
const runCommand = async (command, args) => {
    const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const tail = [];
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
        stdout += chunk;
        keepTail(tail, chunk);
    });
    child.stderr?.on("data", (chunk) => {
        stderr += chunk;
        keepTail(tail, chunk);
    });
    const [exitCode] = (await Promise.race([
        once(child, "close"),
        once(child, "error").then(([error]) => {
            throw error;
        }),
    ]));
    if (exitCode !== 0) {
        throw new Error(`${command} exited with code ${exitCode ?? "unknown"}: ${tail.slice(-10).join(" | ")}`);
    }
    return { stdout, stderr, tail };
};
const buildFilterComplex = (delayPositionsMs, gainDb, durationSec) => {
    const sourceLabels = delayPositionsMs.map((_, index) => `tagsrc${index}`);
    const delayedLabels = delayPositionsMs.map((_, index) => `tagmix${index}`);
    const gainExpr = asFfmpegGainDb(gainDb);
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
        filter += `[${sourceLabels[index]}]adelay=${Math.max(0, Math.round(delayMs))}:all=true[${delayedLabels[index]}];`;
    });
    filter += `[0:a]${delayedLabels.map((label) => `[${label}]`).join("")}amix=inputs=${1 + delayedLabels.length}:normalize=0:dropout_transition=0,atrim=duration=${durationSec.toFixed(3)}[outa]`;
    return filter;
};
export const assertFfmpegAvailable = async (ffmpegBin, ffprobeBin) => {
    await runCommand(ffmpegBin, ["-version"]);
    await runCommand(ffprobeBin, ["-version"]);
};
export const probeAudioDurationSec = async (ffprobeBin, filePath) => {
    const { stdout } = await runCommand(ffprobeBin, [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Invalid audio duration for ${filePath}: ${stdout.trim()}`);
    }
    return duration;
};
export const renderWatermarkedPreview = async (params) => {
    const durationSec = await probeAudioDurationSec(params.ffprobeBin, params.masterFilePath);
    const positionsSec = generateWatermarkPositions(durationSec, params.minIntervalSec, params.maxIntervalSec);
    const positionsMs = positionsSec.map((value) => value * 1000);
    const filterComplex = buildFilterComplex(positionsMs, params.gainDb, durationSec);
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
    ]);
    return {
        durationSec: Number(durationSec.toFixed(3)),
        positionsSec,
        outputPath: params.outputFilePath,
    };
};
