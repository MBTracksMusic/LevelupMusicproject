import { createHash } from "node:crypto";
import type { SiteAudioSettingsRow } from "./types.js";

const MAX_RANDOM_POSITIONS = 24;

const asGainSignatureComponent = (value: number | null | undefined) => {
  const normalized = Number.isFinite(value) ? Number(value) : -10;
  return normalized.toFixed(2);
};

const asIntervalSignatureComponent = (value: number | null | undefined, fallback: number) => {
  const normalized = Number.isFinite(value) ? Number(value) : fallback;
  return String(Math.max(0, Math.round(normalized)));
};

export const asFfmpegGainDb = (value: number) => `${value.toFixed(2)}dB`;

export const computeWatermarkHash = (settings: SiteAudioSettingsRow) => {
  const source = [
    settings.watermark_audio_path ?? "",
    asGainSignatureComponent(settings.gain_db),
    asIntervalSignatureComponent(settings.min_interval_sec, 20),
    asIntervalSignatureComponent(settings.max_interval_sec, 45),
  ].join("|");

  return createHash("sha256").update(source).digest("hex");
};

export const computePreviewSignature = (
  masterReference: string,
  settings: SiteAudioSettingsRow,
) => {
  const source = [
    masterReference,
    settings.watermark_audio_path ?? "",
    asGainSignatureComponent(settings.gain_db),
    asIntervalSignatureComponent(settings.min_interval_sec, 20),
    asIntervalSignatureComponent(settings.max_interval_sec, 45),
  ].join("|");

  return createHash("sha256").update(source).digest("hex");
};

const randomBetween = (min: number, max: number) => {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
};

export const generateWatermarkPositions = (
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
