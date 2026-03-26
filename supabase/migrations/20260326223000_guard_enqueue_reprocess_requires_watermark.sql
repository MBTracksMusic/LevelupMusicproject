/*
  # Guard preview reprocess enqueue behind active watermark settings

  - Prevents queued jobs from being created before the worker has a usable
    `site_audio_settings` row and watermark asset path.
  - Keeps the forced reprocess scope limited to published beats while
    preserving the dedup/skipped counters introduced later.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_reprocess_all_previews()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_enqueued_count integer := 0;
  v_skipped_count integer := 0;
  v_active_watermark_path text;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT NULLIF(btrim(sas.watermark_audio_path), '')
  INTO v_active_watermark_path
  FROM public.site_audio_settings sas
  WHERE sas.enabled = true
  ORDER BY sas.updated_at DESC, sas.created_at DESC, sas.id DESC
  LIMIT 1;

  IF v_active_watermark_path IS NULL THEN
    RAISE EXCEPTION 'active_watermark_required';
  END IF;

  WITH candidate_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
  ),
  inserted_jobs AS (
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    SELECT cp.id, 'generate_preview', 'queued'
    FROM candidate_products cp
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.audio_processing_jobs job
      WHERE job.product_id = cp.id
        AND job.job_type = 'generate_preview'
        AND job.status IN ('queued', 'processing')
    )
    ON CONFLICT DO NOTHING
    RETURNING product_id
  ),
  updated_products AS (
    UPDATE public.products p
    SET
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

  WITH candidate_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
  )
  SELECT GREATEST(COUNT(*) - v_enqueued_count, 0)::integer
  INTO v_skipped_count
  FROM candidate_products;

  RETURN jsonb_build_object(
    'enqueued_count', v_enqueued_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() TO service_role;

COMMIT;
