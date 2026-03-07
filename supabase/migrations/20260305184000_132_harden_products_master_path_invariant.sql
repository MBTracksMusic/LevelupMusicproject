/*
  # Harden products master path invariants

  Goals:
  - Ensure master references stay bound to producer/product identity.
  - Keep legacy `producer_id/audio/...` paths temporarily valid for backward compatibility.
  - Enforce constraints for new writes without breaking existing rows.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_master_storage_path(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v_value = '' THEN
    RETURN NULL;
  END IF;

  -- Strip host from absolute URLs.
  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://[^/]+', '');
  END IF;

  -- Normalize common Supabase storage URL formats.
  v_value := regexp_replace(v_value, '^/storage/v1/object/(public|sign|authenticated)/', '', 'i');
  v_value := regexp_replace(v_value, '^/storage/v1/object/', '', 'i');

  -- If bucket prefix is included, keep only object key.
  v_value := regexp_replace(v_value, '^/+', '', 'g');
  IF v_value ILIKE 'beats-masters/%' THEN
    v_value := substring(v_value FROM char_length('beats-masters/') + 1);
  END IF;

  v_value := regexp_replace(v_value, '^/+', '', 'g');
  RETURN NULLIF(v_value, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_product_master_path(
  p_producer_id uuid,
  p_product_id uuid,
  p_path text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_path text;
BEGIN
  IF p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN true;
  END IF;

  IF p_producer_id IS NULL OR p_product_id IS NULL THEN
    RETURN false;
  END IF;

  v_path := public.normalize_master_storage_path(p_path);

  IF v_path IS NULL THEN
    RETURN false;
  END IF;

  RETURN (
    -- Strict invariant.
    v_path LIKE p_producer_id::text || '/' || p_product_id::text || '/%'
    -- Temporary compatibility for legacy uploads.
    OR v_path LIKE p_producer_id::text || '/audio/%'
  );
END;
$$;

DO $$
DECLARE
  v_has_master_path boolean;
  v_has_master_url boolean;
  v_invalid_master_path bigint := 0;
  v_invalid_master_url bigint := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'master_path'
  ) INTO v_has_master_path;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'master_url'
  ) INTO v_has_master_url;

  IF v_has_master_path THEN
    EXECUTE '
      SELECT count(*)
      FROM public.products
      WHERE master_path IS NOT NULL
        AND NOT public.is_valid_product_master_path(producer_id, id, master_path)
    '
    INTO v_invalid_master_path;

    RAISE NOTICE 'products.master_path invalid rows before hardening: %', v_invalid_master_path;

    EXECUTE 'ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_master_path_invariant';
    EXECUTE '
      ALTER TABLE public.products
      ADD CONSTRAINT products_master_path_invariant
      CHECK (public.is_valid_product_master_path(producer_id, id, master_path))
      NOT VALID
    ';
  END IF;

  IF v_has_master_url THEN
    EXECUTE '
      SELECT count(*)
      FROM public.products
      WHERE master_url IS NOT NULL
        AND NOT public.is_valid_product_master_path(producer_id, id, master_url)
    '
    INTO v_invalid_master_url;

    RAISE NOTICE 'products.master_url invalid rows before hardening: %', v_invalid_master_url;

    EXECUTE 'ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_master_url_invariant';
    EXECUTE '
      ALTER TABLE public.products
      ADD CONSTRAINT products_master_url_invariant
      CHECK (public.is_valid_product_master_path(producer_id, id, master_url))
      NOT VALID
    ';
  END IF;
END
$$;

COMMIT;
