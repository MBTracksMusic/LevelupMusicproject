/*
  # Audio loudness normalization

  Adds the columns required to support loudness normalization of beat
  previews (LUFS target + true peak limiter). Master files are never
  modified — these columns describe what was measured/applied on the
  preview rendering pipeline only.

  - public.site_audio_settings gains a feature flag + 3 normalization
    targets, all with safe defaults (flag OFF by default).
  - public.products gains 4 columns tracking what the worker measured
    and whether normalization was applied for the current preview.

  Idempotent: uses IF NOT EXISTS for columns and named constraints.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) site_audio_settings: feature flag + normalization targets
-- ---------------------------------------------------------------------------
ALTER TABLE public.site_audio_settings
  ADD COLUMN IF NOT EXISTS loudnorm_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.site_audio_settings
  ADD COLUMN IF NOT EXISTS target_lufs numeric(5,2) NOT NULL DEFAULT -12.00;

ALTER TABLE public.site_audio_settings
  ADD COLUMN IF NOT EXISTS target_true_peak_db numeric(5,2) NOT NULL DEFAULT -1.00;

ALTER TABLE public.site_audio_settings
  ADD COLUMN IF NOT EXISTS target_lra numeric(5,2) NOT NULL DEFAULT 11.00;

-- Safety bounds. Drop-and-recreate so we can rerun the migration.
ALTER TABLE public.site_audio_settings
  DROP CONSTRAINT IF EXISTS site_audio_settings_target_lufs_bounds;
ALTER TABLE public.site_audio_settings
  ADD CONSTRAINT site_audio_settings_target_lufs_bounds
  CHECK (target_lufs BETWEEN -30.00 AND -8.00);

ALTER TABLE public.site_audio_settings
  DROP CONSTRAINT IF EXISTS site_audio_settings_target_true_peak_bounds;
ALTER TABLE public.site_audio_settings
  ADD CONSTRAINT site_audio_settings_target_true_peak_bounds
  CHECK (target_true_peak_db BETWEEN -9.00 AND -0.10);

ALTER TABLE public.site_audio_settings
  DROP CONSTRAINT IF EXISTS site_audio_settings_target_lra_bounds;
ALTER TABLE public.site_audio_settings
  ADD CONSTRAINT site_audio_settings_target_lra_bounds
  CHECK (target_lra BETWEEN 1.00 AND 20.00);

-- ---------------------------------------------------------------------------
-- 2) products: per-beat normalization metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS measured_lufs numeric(6,2);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS measured_true_peak_db numeric(6,2);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS normalization_applied boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS normalization_error text;

COMMENT ON COLUMN public.site_audio_settings.loudnorm_enabled IS
  'Feature flag: when true, the audio worker normalizes preview loudness before watermarking. Master files are never modified.';
COMMENT ON COLUMN public.site_audio_settings.target_lufs IS
  'Integrated loudness target (LUFS) used by the loudnorm 2-pass pipeline.';
COMMENT ON COLUMN public.site_audio_settings.target_true_peak_db IS
  'True peak ceiling (dBTP) applied by the loudnorm true peak limiter.';
COMMENT ON COLUMN public.site_audio_settings.target_lra IS
  'Loudness range target (LU) used by the loudnorm 2-pass pipeline.';

COMMENT ON COLUMN public.products.measured_lufs IS
  'Integrated loudness measured on the master during the latest preview rendering. Null when normalization is disabled or never ran.';
COMMENT ON COLUMN public.products.measured_true_peak_db IS
  'True peak measured on the master during the latest preview rendering.';
COMMENT ON COLUMN public.products.normalization_applied IS
  'True when the latest preview was rendered from a normalized intermediate file.';
COMMENT ON COLUMN public.products.normalization_error IS
  'Last loudness-normalization failure message, if any. The job itself does NOT fail on normalization error: the watermark falls back to the raw master.';

COMMIT;
