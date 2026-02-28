/*
  # Preview signature deduplication (P3)

  - Adds preview_signature and last_watermark_hash to products.
  - Adds SQL hash helpers aligned with the Edge worker canonicalization.
  - Replaces enqueue_reprocess_all_previews() to skip already up-to-date previews.
*/

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS preview_signature text,
  ADD COLUMN IF NOT EXISTS last_watermark_hash text;

CREATE INDEX IF NOT EXISTS idx_products_preview_signature
  ON public.products (preview_signature)
  WHERE preview_signature IS NOT NULL;

REVOKE SELECT(preview_signature) ON TABLE public.products FROM PUBLIC;
REVOKE SELECT(preview_signature) ON TABLE public.products FROM anon;
REVOKE SELECT(preview_signature) ON TABLE public.products FROM authenticated;

REVOKE SELECT(last_watermark_hash) ON TABLE public.products FROM PUBLIC;
REVOKE SELECT(last_watermark_hash) ON TABLE public.products FROM anon;
REVOKE SELECT(last_watermark_hash) ON TABLE public.products FROM authenticated;

GRANT SELECT(preview_signature, last_watermark_hash) ON TABLE public.products TO service_role;
GRANT UPDATE(preview_signature, last_watermark_hash) ON TABLE public.products TO service_role;

CREATE OR REPLACE FUNCTION public.format_watermark_gain_db(p_gain_db numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT trim(to_char(COALESCE(p_gain_db, 0), 'FM999999999990.00'));
$$;

CREATE OR REPLACE FUNCTION public.compute_watermark_hash(
  p_watermark_audio_path text,
  p_gain_db numeric,
  p_min_interval_sec integer,
  p_max_interval_sec integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(
    extensions.digest(
      concat_ws(
        '|',
        COALESCE(p_watermark_audio_path, ''),
        public.format_watermark_gain_db(p_gain_db),
        COALESCE(p_min_interval_sec, 0)::text,
        COALESCE(p_max_interval_sec, 0)::text
      ),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.compute_preview_signature(
  p_master_reference text,
  p_watermark_audio_path text,
  p_gain_db numeric,
  p_min_interval_sec integer,
  p_max_interval_sec integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(
    extensions.digest(
      concat_ws(
        '|',
        COALESCE(p_master_reference, ''),
        COALESCE(p_watermark_audio_path, ''),
        public.format_watermark_gain_db(p_gain_db),
        COALESCE(p_min_interval_sec, 0)::text,
        COALESCE(p_max_interval_sec, 0)::text
      ),
      'sha256'
    ),
    'hex'
  );
$$;

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
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  WITH current_settings AS (
    SELECT
      COALESCE(NULLIF(btrim(COALESCE(sas.watermark_audio_path, '')), ''), '') AS watermark_audio_path,
      COALESCE(sas.gain_db, -10.00) AS gain_db,
      COALESCE(sas.min_interval_sec, 20) AS min_interval_sec,
      COALESCE(sas.max_interval_sec, 45) AS max_interval_sec,
      public.compute_watermark_hash(
        COALESCE(NULLIF(btrim(COALESCE(sas.watermark_audio_path, '')), ''), ''),
        COALESCE(sas.gain_db, -10.00),
        COALESCE(sas.min_interval_sec, 20),
        COALESCE(sas.max_interval_sec, 45)
      ) AS current_watermark_hash
    FROM public.site_audio_settings sas
    ORDER BY sas.created_at ASC
    LIMIT 1
  ),
  scannable_products AS (
    SELECT
      p.id,
      p.preview_signature,
      p.last_watermark_hash,
      settings.current_watermark_hash,
      public.compute_preview_signature(
        COALESCE(
          NULLIF(btrim(COALESCE(p.master_path, '')), ''),
          NULLIF(btrim(COALESCE(p.master_url, '')), '')
        ),
        settings.watermark_audio_path,
        settings.gain_db,
        settings.min_interval_sec,
        settings.max_interval_sec
      ) AS current_preview_signature
    FROM public.products p
    CROSS JOIN current_settings settings
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
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
  eligible_products AS (
    SELECT sp.id
    FROM scannable_products sp
    WHERE sp.preview_signature IS NULL
      OR sp.last_watermark_hash IS DISTINCT FROM sp.current_watermark_hash
      OR sp.preview_signature IS DISTINCT FROM sp.current_preview_signature
  ),
  updated_products AS (
    UPDATE public.products p
    SET
      preview_version = GREATEST(COALESCE(p.preview_version, 1), 1) + 1,
      processing_status = 'pending',
      processing_error = NULL,
      processed_at = NULL
    FROM eligible_products eligible
    WHERE p.id = eligible.id
    RETURNING p.id
  ),
  inserted_jobs AS (
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    SELECT updated_products.id, 'generate_preview', 'queued'
    FROM updated_products
    RETURNING id
  )
  SELECT COUNT(*) INTO v_enqueued_count
  FROM inserted_jobs;

  WITH current_settings AS (
    SELECT
      COALESCE(NULLIF(btrim(COALESCE(sas.watermark_audio_path, '')), ''), '') AS watermark_audio_path,
      COALESCE(sas.gain_db, -10.00) AS gain_db,
      COALESCE(sas.min_interval_sec, 20) AS min_interval_sec,
      COALESCE(sas.max_interval_sec, 45) AS max_interval_sec,
      public.compute_watermark_hash(
        COALESCE(NULLIF(btrim(COALESCE(sas.watermark_audio_path, '')), ''), ''),
        COALESCE(sas.gain_db, -10.00),
        COALESCE(sas.min_interval_sec, 20),
        COALESCE(sas.max_interval_sec, 45)
      ) AS current_watermark_hash
    FROM public.site_audio_settings sas
    ORDER BY sas.created_at ASC
    LIMIT 1
  ),
  scannable_products AS (
    SELECT
      p.id,
      p.preview_signature,
      p.last_watermark_hash,
      settings.current_watermark_hash,
      public.compute_preview_signature(
        COALESCE(
          NULLIF(btrim(COALESCE(p.master_path, '')), ''),
          NULLIF(btrim(COALESCE(p.master_url, '')), '')
        ),
        settings.watermark_audio_path,
        settings.gain_db,
        settings.min_interval_sec,
        settings.max_interval_sec
      ) AS current_preview_signature
    FROM public.products p
    CROSS JOIN current_settings settings
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
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
  )
  SELECT COUNT(*) INTO v_skipped_count
  FROM scannable_products sp
  WHERE sp.preview_signature IS NOT NULL
    AND sp.last_watermark_hash IS NOT DISTINCT FROM sp.current_watermark_hash
    AND sp.preview_signature IS NOT DISTINCT FROM sp.current_preview_signature;

  RETURN jsonb_build_object(
    'enqueued_count', v_enqueued_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.format_watermark_gain_db(numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_watermark_hash(text, numeric, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_preview_signature(text, text, numeric, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.format_watermark_gain_db(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_watermark_hash(text, numeric, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_preview_signature(text, text, numeric, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() TO service_role;

COMMIT;
