/*
  # Cleanup legacy master_path format and enforce strict invariant

  Goal:
  - Remove legacy `producer_id/audio/...` paths.
  - Enforce strict format: `producer_id/product_id/<filename>`.
  - Validate products_master_path_invariant.
*/

BEGIN;

-- Keep helper available even when running this migration on partially-synced databases.
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

  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://[^/]+', '');
  END IF;

  v_value := regexp_replace(v_value, '^/storage/v1/object/(public|sign|authenticated)/', '', 'i');
  v_value := regexp_replace(v_value, '^/storage/v1/object/', '', 'i');

  v_value := regexp_replace(v_value, '^/+', '', 'g');
  IF v_value ILIKE 'beats-masters/%' THEN
    v_value := substring(v_value FROM char_length('beats-masters/') + 1);
  END IF;

  v_value := regexp_replace(v_value, '^/+', '', 'g');
  RETURN NULLIF(v_value, '');
END;
$$;

DO $$
DECLARE
  v_legacy_master_path_count bigint := 0;
  v_legacy_master_url_count bigint := 0;
  v_locked_products bigint := 0;
  v_invalid_strict_count bigint := 0;
  v_locked_condition text;
  v_guard_trigger_disabled boolean := false;
BEGIN
  IF to_regclass('public.battle_products') IS NOT NULL THEN
    v_locked_condition := '
      EXISTS (
        SELECT 1
        FROM public.battle_products bp
        JOIN public.battles b ON b.id = bp.battle_id
        WHERE bp.product_id = p.id
          AND b.status = ''active''
      )
      OR EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.status = ''active''
          AND (b.product1_id = p.id OR b.product2_id = p.id)
      )
    ';
  ELSE
    v_locked_condition := '
      EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.status = ''active''
          AND (b.product1_id = p.id OR b.product2_id = p.id)
      )
    ';
  END IF;

  EXECUTE '
    SELECT count(*)
    FROM public.products p
    WHERE p.master_path IS NOT NULL
      AND public.normalize_master_storage_path(p.master_path) LIKE p.producer_id::text || ''/audio/%''
      AND ' || v_locked_condition
  INTO v_locked_products;

  RAISE NOTICE 'Skipping % products locked by active battles', v_locked_products;

  SELECT count(*)
  INTO v_legacy_master_path_count
  FROM public.products p
  WHERE p.master_path IS NOT NULL
    AND public.normalize_master_storage_path(p.master_path) LIKE p.producer_id::text || '/audio/%';

  RAISE NOTICE 'Legacy master_path rows before migration: %', v_legacy_master_path_count;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.products'::regclass
      AND t.tgname = 'guard_product_editability_trigger'
      AND NOT t.tgisinternal
  ) THEN
    ALTER TABLE public.products DISABLE TRIGGER guard_product_editability_trigger;
    v_guard_trigger_disabled := true;
    RAISE NOTICE 'Temporarily disabled trigger guard_product_editability_trigger';
  END IF;

  EXECUTE '
    WITH legacy_path AS (
      SELECT
        p.id,
        p.producer_id,
        NULLIF(
          regexp_replace(public.normalize_master_storage_path(p.master_path), ''^.*/'', ''''),
          ''''
        ) AS file_name
      FROM public.products p
      WHERE p.master_path IS NOT NULL
        AND public.normalize_master_storage_path(p.master_path) LIKE p.producer_id::text || ''/audio/%''
        AND NOT (' || v_locked_condition || ')
    )
    UPDATE public.products p
    SET master_path = legacy_path.producer_id::text || ''/'' || legacy_path.id::text || ''/'' || legacy_path.file_name
    FROM legacy_path
    WHERE p.id = legacy_path.id
      AND legacy_path.file_name IS NOT NULL
  ';

  SELECT count(*)
  INTO v_legacy_master_url_count
  FROM public.products p
  WHERE p.master_url IS NOT NULL
    AND public.normalize_master_storage_path(p.master_url) LIKE p.producer_id::text || '/audio/%';

  RAISE NOTICE 'Legacy master_url rows before migration: %', v_legacy_master_url_count;

  EXECUTE '
    WITH legacy_url AS (
      SELECT
        p.id,
        p.producer_id,
        NULLIF(
          regexp_replace(public.normalize_master_storage_path(p.master_url), ''^.*/'', ''''),
          ''''
        ) AS file_name
      FROM public.products p
      WHERE p.master_url IS NOT NULL
        AND public.normalize_master_storage_path(p.master_url) LIKE p.producer_id::text || ''/audio/%''
        AND NOT (' || v_locked_condition || ')
    )
    UPDATE public.products p
    SET master_url = legacy_url.producer_id::text || ''/'' || legacy_url.id::text || ''/'' || legacy_url.file_name
    FROM legacy_url
    WHERE p.id = legacy_url.id
      AND legacy_url.file_name IS NOT NULL
  ';

  IF v_guard_trigger_disabled THEN
    ALTER TABLE public.products ENABLE TRIGGER guard_product_editability_trigger;
    RAISE NOTICE 'Re-enabled trigger guard_product_editability_trigger';
  END IF;

  EXECUTE '
    SELECT count(*)
    FROM public.products p
    WHERE p.master_path IS NOT NULL
      AND NOT (
        public.normalize_master_storage_path(p.master_path)
        LIKE p.producer_id::text || ''/'' || p.id::text || ''/%''
      )
      AND NOT (' || v_locked_condition || ')'
  INTO v_invalid_strict_count;

  IF v_invalid_strict_count > 0 THEN
    RAISE NOTICE 'Strict invariant still has % non-locked invalid rows after migration', v_invalid_strict_count;
  END IF;
END
$$;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_master_path_invariant;

ALTER TABLE public.products
  ADD CONSTRAINT products_master_path_invariant
  CHECK (
    master_path IS NULL
    OR public.normalize_master_storage_path(master_path) LIKE producer_id::text || '/' || id::text || '/%'
  )
  NOT VALID;

DO $$
DECLARE
  v_locked_legacy_count bigint := 0;
  v_unlocked_invalid_count bigint := 0;
  v_locked_condition text;
BEGIN
  IF to_regclass('public.battle_products') IS NOT NULL THEN
    v_locked_condition := '
      EXISTS (
        SELECT 1
        FROM public.battle_products bp
        JOIN public.battles b ON b.id = bp.battle_id
        WHERE bp.product_id = p.id
          AND b.status = ''active''
      )
      OR EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.status = ''active''
          AND (b.product1_id = p.id OR b.product2_id = p.id)
      )
    ';
  ELSE
    v_locked_condition := '
      EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.status = ''active''
          AND (b.product1_id = p.id OR b.product2_id = p.id)
      )
    ';
  END IF;

  EXECUTE '
    SELECT count(*)
    FROM public.products p
    WHERE p.master_path IS NOT NULL
      AND public.normalize_master_storage_path(p.master_path) LIKE p.producer_id::text || ''/audio/%''
      AND ' || v_locked_condition
  INTO v_locked_legacy_count;

  EXECUTE '
    SELECT count(*)
    FROM public.products p
    WHERE p.master_path IS NOT NULL
      AND NOT (
        public.normalize_master_storage_path(p.master_path)
        LIKE p.producer_id::text || ''/'' || p.id::text || ''/%''
      )
      AND NOT (' || v_locked_condition || ')'
  INTO v_unlocked_invalid_count;

  IF v_locked_legacy_count = 0 AND v_unlocked_invalid_count = 0 THEN
    ALTER TABLE public.products
      VALIDATE CONSTRAINT products_master_path_invariant;
    RAISE NOTICE 'products_master_path_invariant validated successfully';
  ELSE
    RAISE NOTICE
      'Validation deferred for products_master_path_invariant (locked_legacy=%, non_locked_invalid=%)',
      v_locked_legacy_count,
      v_unlocked_invalid_count;
  END IF;
END
$$;

COMMIT;
