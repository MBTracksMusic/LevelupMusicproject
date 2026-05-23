/*
  # Loudness normalization backfill RPC

  Sister function to enqueue_reprocess_all_previews(), dedicated to
  re-rendering existing beats so they go through the loudnorm pipeline.

  Differences vs enqueue_reprocess_all_previews:
   - Refuses if loudnorm_enabled is false (no point reprocessing without it).
   - Targets beats where normalization_applied is null/false (skip already
     normalized beats — but include beats whose previous normalization
     attempt failed, so they get retried).
   - Resets preview_signature / last_watermark_hash so the worker doesn't
     short-circuit via its "signature match" fast path.

  Same guarantees:
   - SECURITY DEFINER + service_role / is_admin check
   - Does NOT enqueue a beat that already has a queued/processing job
   - Does NOT touch master files
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_loudness_normalization_backfill()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_settings record;
  v_candidate_count integer := 0;
  v_enqueued_count integer := 0;
  v_skipped_count integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- Refuse to enqueue if loudnorm is not actually enabled — backfilling
  -- without the flag would re-render previews using the legacy path and
  -- waste CPU for no gain.
  SELECT
    sas.id,
    sas.loudnorm_enabled,
    NULLIF(btrim(COALESCE(sas.watermark_audio_path, '')), '') AS watermark_audio_path
  INTO v_settings
  FROM public.site_audio_settings sas
  WHERE sas.enabled = true
  ORDER BY sas.updated_at DESC, sas.created_at DESC, sas.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active_site_audio_settings_required';
  END IF;

  IF v_settings.loudnorm_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'loudnorm_disabled';
  END IF;

  IF v_settings.watermark_audio_path IS NULL THEN
    RAISE EXCEPTION 'active_watermark_required';
  END IF;

  -- Count candidates first (so we can compute skipped_count even when nothing
  -- ends up being enqueued).
  WITH candidate_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type IN ('beat'::public.product_type, 'exclusive'::public.product_type)
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(p.normalization_applied, false) = false
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
  )
  SELECT COUNT(*) INTO v_candidate_count
  FROM candidate_products;

  -- Pre-flight: reset signature & last_watermark_hash for the chosen beats
  -- so the worker's fast-path skip (signature match) does not short-circuit
  -- the new render. We only update rows that pass the "not already in queue"
  -- filter to avoid touching beats that have an in-flight job.
  WITH eligible AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type IN ('beat'::public.product_type, 'exclusive'::public.product_type)
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(p.normalization_applied, false) = false
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.audio_processing_jobs job
        WHERE job.product_id = p.id
          AND job.job_type = 'generate_preview'
          AND job.status IN ('queued', 'processing')
      )
  ),
  inserted_jobs AS (
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    SELECT e.id, 'generate_preview', 'queued'
    FROM eligible e
    ON CONFLICT DO NOTHING
    RETURNING product_id
  ),
  updated_products AS (
    UPDATE public.products p
    SET
      preview_signature = NULL,
      last_watermark_hash = NULL,
      preview_version = GREATEST(COALESCE(p.preview_version, 1), 1) + 1,
      processing_status = 'pending',
      processing_error = NULL,
      processed_at = NULL
    FROM inserted_jobs ij
    WHERE p.id = ij.product_id
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_enqueued_count
  FROM updated_products;

  v_skipped_count := GREATEST(v_candidate_count - v_enqueued_count, 0);

  RETURN jsonb_build_object(
    'enqueued_count', v_enqueued_count,
    'skipped_count', v_skipped_count,
    'candidate_count', v_candidate_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_loudness_normalization_backfill() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_loudness_normalization_backfill() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_loudness_normalization_backfill() TO service_role;

COMMIT;
