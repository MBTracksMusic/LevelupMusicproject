import { spawn } from "node:child_process";
import { once } from "node:events";
import type {
  LoudnessAnalysis,
  LoudnessTargets,
  RenderPreviewParams,
  RenderPreviewResult,
} from "./types.js";
import { asFfmpegGainDb, generateWatermarkPositions } from "./watermark.js";

const MAX_LOG_LINES = 200;
const MAX_CAPTURE_STDOUT_CHARS = 8_192;
const MAX_CAPTURE_STDERR_CHARS = 64_000;
const MIN_WATERMARK_PITCH = 0.995;
const MAX_WATERMARK_PITCH = 1.005;

const keepTail = (lines: string[], chunk: string) => {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line) continue;
    lines.push(line);
    if (lines.length > MAX_LOG_LINES) {
      lines.shift();
    }
  }
};

const toAbortError = (reason: unknown, fallbackMessage: string) => {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.length > 0) {
    return new Error(reason);
  }
  return new Error(fallbackMessage);
};

interface RunCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  captureStdout?: boolean;
  stdoutMaxChars?: number;
  captureStderr?: boolean;
  stderrMaxChars?: number;
}

const runCommand = async (
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; tail: string[] }> => {
  const {
    timeoutMs,
    signal,
    captureStdout = false,
    stdoutMaxChars = MAX_CAPTURE_STDOUT_CHARS,
    captureStderr = false,
    stderrMaxChars = MAX_CAPTURE_STDERR_CHARS,
  } = options;

  if (signal?.aborted) {
    throw toAbortError(signal.reason, `${command} aborted before start`);
  }

  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const tail: string[] = [];
  let timedOut = false;
  let aborted = false;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk: string) => {
    if (captureStdout) {
      stdout += chunk;
      if (stdout.length > stdoutMaxChars) {
        stdout = stdout.slice(-stdoutMaxChars);
      }
    }
    keepTail(tail, chunk);
  });

  child.stderr?.on("data", (chunk: string) => {
    if (captureStderr) {
      stderr += chunk;
      if (stderr.length > stderrMaxChars) {
        stderr = stderr.slice(-stderrMaxChars);
      }
    }
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
    ])) as [number | null];

    if (timedOut) {
      throw new Error(
        `${command} timed out after ${timeoutMs}ms: ${tail.slice(-10).join(" | ")}`,
      );
    }

    if (aborted) {
      throw toAbortError(signal?.reason, `${command} aborted`);
    }

    if (exitCode !== 0) {
      throw new Error(
        `${command} exited with code ${exitCode ?? "unknown"}: ${tail.slice(-10).join(" | ")}`,
      );
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }

  return { stdout, stderr, tail };
};

const buildFilterComplex = (
  delayPositionsMs: number[],
  gainDb: number,
  durationSec: number,
  sampleRate: number,
) => {
  const sourceLabels = delayPositionsMs.map((_, index) => `tagsrc${index}`);
  const delayedLabels = delayPositionsMs.map((_, index) => `tagmix${index}`);
  const gainExpr = asFfmpegGainDb(gainDb);
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44_100;

  let filter = "";

  if (sourceLabels.length === 1) {
    filter += `[1:a]volume=${gainExpr}[${sourceLabels[0]}];`;
  } else {
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

export const assertFfmpegAvailable = async (ffmpegBin: string, ffprobeBin: string) => {
  await runCommand(ffmpegBin, ["-version"]);
  await runCommand(ffprobeBin, ["-version"]);
};

export const probeAudioDurationSec = async (
  ffprobeBin: string,
  filePath: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<number> => {
  const commandOptions: RunCommandOptions = {
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

export const renderWatermarkedPreview = async (
  params: RenderPreviewParams,
): Promise<RenderPreviewResult> => {
  const durationSec = await probeAudioDurationSec(params.ffprobeBin, params.masterFilePath, {
    timeoutMs: params.ffmpegTimeoutMs,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  const positionsSec = generateWatermarkPositions(
    durationSec,
    params.minIntervalSec,
    params.maxIntervalSec,
  );
  const positionsMs = positionsSec.map((value) => value * 1000);
  const filterComplex = buildFilterComplex(
    positionsMs,
    params.gainDb,
    durationSec,
    params.audioSampleRate,
  );

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

// ---------------------------------------------------------------------------
// Loudness normalization (EBU R128 / ITU BS.1770)
//
// Two-pass loudnorm pipeline:
//   1. analyzeLoudness() runs ffmpeg with print_format=json to measure
//      integrated loudness (I), true peak (TP), loudness range (LRA) and
//      derived offset/threshold on the input master.
//   2. applyLoudnorm() feeds the measurements back into ffmpeg with
//      linear=true so the second pass applies a single linear gain plus a
//      true peak limiter — preserving dynamics far better than the single-
//      pass dynamic mode.
//
// Output is intentionally written as 44.1 kHz / stereo / 16-bit PCM WAV so
// the existing watermark pipeline (which re-encodes to MP3 anyway) does
// not eat a double MP3 generation loss.
// ---------------------------------------------------------------------------

interface LoudnormCommandOptions {
  ffmpegBin: string;
  ffmpegTimeoutMs: number;
  signal?: AbortSignal;
}

const formatNumber = (value: number, fractionDigits = 2): string => {
  if (!Number.isFinite(value)) {
    throw new Error(`loudnorm: non-finite numeric value: ${value}`);
  }
  return value.toFixed(fractionDigits);
};

const parseLoudnormJson = (raw: string): LoudnessAnalysis => {
  if (!raw) {
    throw new Error("loudnorm: empty ffmpeg stderr — could not locate measurement JSON");
  }

  // The loudnorm filter prints a JSON object at (or very near) the end of
  // stderr. Slice from the last `{` to the matching closing `}` so we don't
  // confuse ourselves with progress lines.
  const lastOpen = raw.lastIndexOf("{");
  const lastClose = raw.lastIndexOf("}");
  if (lastOpen < 0 || lastClose < 0 || lastClose < lastOpen) {
    throw new Error("loudnorm: could not locate JSON measurement block in ffmpeg output");
  }

  const jsonText = raw.slice(lastOpen, lastClose + 1);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`loudnorm: failed to parse JSON measurements: ${message}`);
  }

  const pickNumber = (key: string): number => {
    const raw = parsed[key];
    if (raw === undefined || raw === null) {
      throw new Error(`loudnorm: missing key '${key}' in measurement JSON`);
    }
    const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    if (!Number.isFinite(value)) {
      throw new Error(`loudnorm: non-numeric value for key '${key}': ${String(raw)}`);
    }
    return value;
  };

  return {
    input_i: pickNumber("input_i"),
    input_tp: pickNumber("input_tp"),
    input_lra: pickNumber("input_lra"),
    input_thresh: pickNumber("input_thresh"),
    target_offset: pickNumber("target_offset"),
  };
};

export const analyzeLoudness = async (
  inputPath: string,
  targets: LoudnessTargets,
  options: LoudnormCommandOptions,
): Promise<LoudnessAnalysis> => {
  const I = formatNumber(targets.targetLufs);
  const TP = formatNumber(targets.targetTruePeakDb);
  const LRA = formatNumber(targets.targetLra);

  const { stderr } = await runCommand(
    options.ffmpegBin,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      inputPath,
      "-af",
      `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    {
      timeoutMs: options.ffmpegTimeoutMs,
      captureStderr: true,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  return parseLoudnormJson(stderr);
};

export const applyLoudnorm = async (
  inputPath: string,
  outputPath: string,
  analysis: LoudnessAnalysis,
  targets: LoudnessTargets,
  options: LoudnormCommandOptions & { sampleRate?: number },
): Promise<void> => {
  const I = formatNumber(targets.targetLufs);
  const TP = formatNumber(targets.targetTruePeakDb);
  const LRA = formatNumber(targets.targetLra);

  const measuredI = formatNumber(analysis.input_i);
  const measuredLra = formatNumber(analysis.input_lra);
  const measuredTp = formatNumber(analysis.input_tp);
  const measuredThresh = formatNumber(analysis.input_thresh);
  const offset = formatNumber(analysis.target_offset);

  const sampleRate = options.sampleRate && options.sampleRate > 0
    ? Math.round(options.sampleRate)
    : 44_100;

  const filter =
    `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}` +
    `:measured_I=${measuredI}:measured_LRA=${measuredLra}` +
    `:measured_TP=${measuredTp}:measured_thresh=${measuredThresh}` +
    `:offset=${offset}:linear=true:print_format=summary`;

  await runCommand(
    options.ffmpegBin,
    [
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      inputPath,
      "-af",
      filter,
      "-ar",
      String(sampleRate),
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      outputPath,
    ],
    {
      timeoutMs: options.ffmpegTimeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
};
