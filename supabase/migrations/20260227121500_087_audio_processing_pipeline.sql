/*
  # Audio processing pipeline infrastructure (P1)

  - Adds singleton global watermark settings for admin.
  - Adds preview processing state to products.
  - Creates an idempotent audio processing jobs queue.
  - Adds helper RPCs/triggers for enqueue + worker locking.
  - Adds private watermark-assets storage bucket and policies.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Global site audio settings (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_audio_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  watermark_audio_path text,
  gain_db numeric(5,2) NOT NULL DEFAULT -10.00,
  min_interval_sec integer NOT NULL DEFAULT 20,
  max_interval_sec integer NOT NULL DEFAULT 45,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_audio_settings_gain_bounds CHECK (gain_db >= -60.00 AND gain_db <= 12.00),
  CONSTRAINT site_audio_settings_interval_bounds CHECK (
    min_interval_sec >= 1 AND max_interval_sec >= min_interval_sec
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_audio_settings_singleton
  ON public.site_audio_settings ((true));

ALTER TABLE public.site_audio_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view site audio settings" ON public.site_audio_settings;
DROP POLICY IF EXISTS "Admins can insert site audio settings" ON public.site_audio_settings;
DROP POLICY IF EXISTS "Admins can update site audio settings" ON public.site_audio_settings;
DROP POLICY IF EXISTS "Admins can delete site audio settings" ON public.site_audio_settings;

CREATE POLICY "Admins can view site audio settings"
  ON public.site_audio_settings
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert site audio settings"
  ON public.site_audio_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update site audio settings" ON public.site_audio_settings;
CREATE POLICY "Admins can update site audio settings"
  ON public.site_audio_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete site audio settings" ON public.site_audio_settings;
CREATE POLICY "Admins can delete site audio settings"
  ON public.site_audio_settings
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

REVOKE ALL ON TABLE public.site_audio_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.site_audio_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_audio_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_audio_settings TO service_role;

DO $$
BEGIN
  IF to_regproc('public.update_updated_at_column()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'update_site_audio_settings_updated_at'
         AND tgrelid = 'public.site_audio_settings'::regclass
         AND NOT tgisinternal
     ) THEN
    DROP TRIGGER IF EXISTS update_site_audio_settings_updated_at ON public.site_audio_settings;
    CREATE TRIGGER update_site_audio_settings_updated_at
      BEFORE UPDATE ON public.site_audio_settings
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

INSERT INTO public.site_audio_settings (
  enabled,
  watermark_audio_path,
  gain_db,
  min_interval_sec,
  max_interval_sec
)
SELECT
  true,
  NULL,
  -10.00,
  20,
  45
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_audio_settings
);

-- ---------------------------------------------------------------------------
-- 2) Products: processing state for previews
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS preview_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS watermarked_bucket text DEFAULT 'beats-watermarked';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_processing_status_check;
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_preview_version_positive_check;
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_watermarked_bucket_not_blank_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'done', 'error')),
  ADD CONSTRAINT products_preview_version_positive_check
    CHECK (preview_version >= 1),
  ADD CONSTRAINT products_watermarked_bucket_not_blank_check
    CHECK (watermarked_bucket IS NULL OR btrim(watermarked_bucket) <> '');

CREATE INDEX IF NOT EXISTS idx_products_processing_status
  ON public.products (processing_status, updated_at DESC);

GRANT SELECT (processing_status, processing_error, preview_version, processed_at, watermarked_bucket)
  ON TABLE public.products TO authenticated;
GRANT SELECT (processing_status, processing_error, preview_version, processed_at, watermarked_bucket)
  ON TABLE public.products TO service_role;

UPDATE public.products
SET
  processing_status = CASE
    WHEN coalesce(nullif(btrim(coalesce(watermarked_path, '')), ''), nullif(btrim(coalesce(preview_url, '')), ''), nullif(btrim(coalesce(exclusive_preview_url, '')), '')) IS NOT NULL
      THEN 'done'
    ELSE 'pending'
  END,
  processing_error = CASE
    WHEN coalesce(nullif(btrim(coalesce(watermarked_path, '')), ''), nullif(btrim(coalesce(preview_url, '')), ''), nullif(btrim(coalesce(exclusive_preview_url, '')), '')) IS NOT NULL
      THEN NULL
    ELSE processing_error
  END,
  preview_version = GREATEST(COALESCE(preview_version, 1), 1),
  processed_at = CASE
    WHEN processed_at IS NULL
      AND coalesce(nullif(btrim(coalesce(watermarked_path, '')), ''), nullif(btrim(coalesce(preview_url, '')), ''), nullif(btrim(coalesce(exclusive_preview_url, '')), '')) IS NOT NULL
      THEN updated_at
    ELSE processed_at
  END,
  watermarked_bucket = COALESCE(NULLIF(btrim(COALESCE(watermarked_bucket, '')), ''), 'beats-watermarked');

-- ---------------------------------------------------------------------------
-- 3) Queue table for preview generation/reprocessing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audio_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audio_processing_jobs_job_type_check CHECK (job_type IN ('generate_preview', 'reprocess_all')),
  CONSTRAINT audio_processing_jobs_status_check CHECK (status IN ('queued', 'processing', 'done', 'error', 'dead')),
  CONSTRAINT audio_processing_jobs_attempts_check CHECK (attempts >= 0),
  CONSTRAINT audio_processing_jobs_max_attempts_check CHECK (max_attempts >= 1)
);

CREATE INDEX IF NOT EXISTS idx_audio_processing_jobs_status_created_at
  ON public.audio_processing_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_audio_processing_jobs_product_created_at
  ON public.audio_processing_jobs (product_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_processing_jobs_active_unique
  ON public.audio_processing_jobs (product_id, job_type)
  WHERE status IN ('queued', 'processing');

ALTER TABLE public.audio_processing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view audio processing jobs" ON public.audio_processing_jobs;

CREATE POLICY "Admins can view audio processing jobs"
  ON public.audio_processing_jobs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

REVOKE ALL ON TABLE public.audio_processing_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.audio_processing_jobs FROM anon;
REVOKE ALL ON TABLE public.audio_processing_jobs FROM authenticated;
GRANT SELECT ON TABLE public.audio_processing_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audio_processing_jobs TO service_role;

DO $$
BEGIN
  IF to_regproc('public.update_updated_at_column()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'update_audio_processing_jobs_updated_at'
         AND tgrelid = 'public.audio_processing_jobs'::regclass
         AND NOT tgisinternal
     ) THEN
    DROP TRIGGER IF EXISTS update_audio_processing_jobs_updated_at ON public.audio_processing_jobs;
    CREATE TRIGGER update_audio_processing_jobs_updated_at
      BEFORE UPDATE ON public.audio_processing_jobs
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.prepare_product_preview_processing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.product_type <> 'beat' THEN
    RETURN NEW;
  END IF;

  NEW.watermarked_bucket := COALESCE(NULLIF(btrim(COALESCE(NEW.watermarked_bucket, '')), ''), 'beats-watermarked');
  NEW.preview_version := GREATEST(COALESCE(NEW.preview_version, 1), 1);

  IF TG_OP = 'INSERT' THEN
    NEW.processing_status := COALESCE(NULLIF(btrim(COALESCE(NEW.processing_status, '')), ''), 'pending');
    NEW.processing_error := NULL;
    IF NEW.processing_status <> 'done' THEN
      NEW.processed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.master_path IS DISTINCT FROM OLD.master_path
     OR NEW.master_url IS DISTINCT FROM OLD.master_url THEN
    NEW.preview_version := GREATEST(COALESCE(OLD.preview_version, 1), 1) + 1;
    NEW.processing_status := 'pending';
    NEW.processing_error := NULL;
    NEW.processed_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.is_published = false
     AND NEW.is_published = true
     AND NEW.deleted_at IS NULL
     AND coalesce(nullif(btrim(COALESCE(NEW.watermarked_path, '')), ''), nullif(btrim(COALESCE(NEW.preview_url, '')), ''), nullif(btrim(COALESCE(NEW.exclusive_preview_url, '')), '')) IS NULL THEN
    NEW.processing_status := 'pending';
    NEW.processing_error := NULL;
    NEW.processed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_audio_processing_job(
  p_product_id uuid,
  p_job_type text DEFAULT 'generate_preview'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_product_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_job_type NOT IN ('generate_preview', 'reprocess_all') THEN
    RAISE EXCEPTION 'invalid_job_type';
  END IF;

  BEGIN
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    VALUES (p_product_id, p_job_type, 'queued');
    RETURN true;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN false;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_product_preview_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.product_type <> 'beat'
     OR NEW.deleted_at IS NOT NULL
     OR NEW.is_published IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF coalesce(nullif(btrim(COALESCE(NEW.master_path, '')), ''), nullif(btrim(COALESCE(NEW.master_url, '')), '')) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.master_path IS DISTINCT FROM OLD.master_path
     OR NEW.master_url IS DISTINCT FROM OLD.master_url
     OR (OLD.is_published = false AND NEW.is_published = true)
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
    PERFORM public.enqueue_audio_processing_job(NEW.id, 'generate_preview');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_product_preview_processing_trigger ON public.products;
CREATE TRIGGER prepare_product_preview_processing_trigger
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_product_preview_processing();

DROP TRIGGER IF EXISTS enqueue_product_preview_job_trigger ON public.products;
CREATE TRIGGER enqueue_product_preview_job_trigger
  AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_product_preview_job();

CREATE OR REPLACE FUNCTION public.claim_audio_processing_jobs(
  p_limit integer DEFAULT 20,
  p_worker text DEFAULT NULL
)
RETURNS SETOF public.audio_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_worker text := COALESCE(NULLIF(btrim(COALESCE(p_worker, '')), ''), 'audio-worker');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_or_service_role_required';
  END IF;

  RETURN QUERY
  WITH reclaimed AS (
    UPDATE public.audio_processing_jobs AS stale
    SET
      status = 'queued',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
    WHERE stale.status = 'processing'
      AND stale.locked_at IS NOT NULL
      AND stale.locked_at < now() - interval '15 minutes'
    RETURNING stale.id
  ),
  candidates AS (
    SELECT job.id
    FROM public.audio_processing_jobs AS job
    WHERE job.status IN ('queued', 'error')
      AND job.attempts < job.max_attempts
    ORDER BY job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.audio_processing_jobs AS job
    SET
      status = 'processing',
      attempts = job.attempts + 1,
      locked_at = now(),
      locked_by = v_worker,
      updated_at = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  )
  SELECT * FROM claimed;
END;
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
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  WITH eligible_products AS (
    SELECT p.id
    FROM public.products AS p
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND coalesce(
        nullif(btrim(COALESCE(p.master_path, '')), ''),
        nullif(btrim(COALESCE(p.master_url, '')), ''),
        nullif(btrim(COALESCE(p.watermarked_path, '')), ''),
        nullif(btrim(COALESCE(p.preview_url, '')), ''),
        nullif(btrim(COALESCE(p.exclusive_preview_url, '')), '')
      ) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.audio_processing_jobs AS job
        WHERE job.product_id = p.id
          AND job.job_type = 'generate_preview'
          AND job.status IN ('queued', 'processing')
      )
  ),
  updated_products AS (
    UPDATE public.products AS p
    SET
      preview_version = GREATEST(COALESCE(p.preview_version, 1), 1) + 1,
      processing_status = 'pending',
      processing_error = NULL,
      processed_at = NULL
    FROM eligible_products AS eligible
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

  RETURN jsonb_build_object('enqueued_count', v_enqueued_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_audio_processing_job(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_audio_processing_jobs(integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enqueue_audio_processing_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_audio_processing_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_audio_processing_jobs(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_processing_jobs(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_reprocess_all_previews() TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Storage buckets and policies
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping watermark-assets setup.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'watermark-assets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'watermark-assets',
      'Global watermark assets (private)',
      false,
      10485760,
      '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    );
  ELSE
    UPDATE storage.buckets
    SET
      public = false,
      file_size_limit = 10485760,
      allowed_mime_types = '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    WHERE id = 'watermark-assets';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'beats-watermarked') THEN
    UPDATE storage.buckets
    SET public = true
    WHERE id = 'beats-watermarked';
  END IF;
END
$$;

DO $$
DECLARE
  objects_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping watermark-assets policies.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Admins can read watermark assets" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can upload watermark assets" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can update watermark assets" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can delete watermark assets" ON storage.objects;

  CREATE POLICY "Admins can read watermark assets"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'watermark-assets'
      AND public.is_admin(auth.uid())
    );

  DROP POLICY IF EXISTS "Admins can upload watermark assets" ON storage.objects;
  CREATE POLICY "Admins can upload watermark assets"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'watermark-assets'
      AND public.is_admin(auth.uid())
      AND name LIKE 'admin/%'
    );

  DROP POLICY IF EXISTS "Admins can update watermark assets" ON storage.objects;
  CREATE POLICY "Admins can update watermark assets"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'watermark-assets'
      AND public.is_admin(auth.uid())
      AND name LIKE 'admin/%'
    )
    WITH CHECK (
      bucket_id = 'watermark-assets'
      AND public.is_admin(auth.uid())
      AND name LIKE 'admin/%'
    );

  DROP POLICY IF EXISTS "Admins can delete watermark assets" ON storage.objects;
  CREATE POLICY "Admins can delete watermark assets"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'watermark-assets'
      AND public.is_admin(auth.uid())
      AND name LIKE 'admin/%'
    );
END
$$;

COMMIT;
