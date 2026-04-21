/*
  # Reassert audio preview enqueue path

  - Recreates the preview processing triggers idempotently.
  - Hardens enqueue_audio_processing_job so owner/admin/service_role calls are explicit.
  - Ensures generate_preview jobs are only queued for valid published beats with a master.
*/

BEGIN;

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
     AND coalesce(
       nullif(btrim(COALESCE(NEW.watermarked_path, '')), ''),
       nullif(btrim(COALESCE(NEW.preview_url, '')), ''),
       nullif(btrim(COALESCE(NEW.exclusive_preview_url, '')), '')
     ) IS NULL THEN
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
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_product public.products%ROWTYPE;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_job_type NOT IN ('generate_preview', 'reprocess_all') THEN
    RAISE EXCEPTION 'invalid_job_type';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_job_type = 'reprocess_all' THEN
    IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
      RAISE EXCEPTION 'admin_required';
    END IF;
  ELSIF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
    OR v_product.producer_id = v_actor
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_job_type = 'generate_preview' THEN
    IF v_product.product_type <> 'beat'
       OR v_product.deleted_at IS NOT NULL
       OR v_product.is_published IS DISTINCT FROM true THEN
      RETURN false;
    END IF;

    IF coalesce(
      nullif(btrim(COALESCE(v_product.master_path, '')), ''),
      nullif(btrim(COALESCE(v_product.master_url, '')), '')
    ) IS NULL THEN
      RETURN false;
    END IF;
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

  IF coalesce(
    nullif(btrim(COALESCE(NEW.master_path, '')), ''),
    nullif(btrim(COALESCE(NEW.master_url, '')), '')
  ) IS NULL THEN
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

REVOKE EXECUTE ON FUNCTION public.enqueue_audio_processing_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_audio_processing_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_audio_processing_job(uuid, text) TO service_role;

COMMIT;
