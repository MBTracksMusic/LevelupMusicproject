/*
  # Add premium early access for beats
*/

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS early_access_until timestamptz NULL;

COMMENT ON COLUMN public.products.early_access_until IS
  'If set in the future for a beat, the product is only visible in public catalog feeds to active premium user subscribers until this timestamp.';

CREATE OR REPLACE FUNCTION public.user_has_active_buyer_subscription(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN p_user_id IS NULL THEN false
      WHEN public.is_admin(p_user_id) THEN true
      ELSE EXISTS (
        SELECT 1
        FROM public.user_subscriptions us
        WHERE us.user_id = p_user_id
          AND us.subscription_status IN ('active', 'trialing')
          AND (us.current_period_end IS NULL OR us.current_period_end > now())
      )
    END;
$$;

REVOKE ALL ON FUNCTION public.user_has_active_buyer_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_active_buyer_subscription(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.user_has_active_buyer_subscription(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_active_buyer_subscription(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.user_has_active_buyer_subscription(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_active_buyer_subscription(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.get_public_home_featured_beats(integer);

CREATE FUNCTION public.get_public_home_featured_beats(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  price integer,
  play_count integer,
  cover_image_url text,
  preview_url text,
  early_access_until timestamptz,
  is_sold boolean,
  producer_id uuid,
  producer_username text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.title,
    p.slug,
    p.price,
    COALESCE(p.play_count, 0) AS play_count,
    p.cover_image_url,
    NULLIF(TRIM(p.preview_url), '') AS preview_url,
    p.early_access_until,
    COALESCE(p.is_sold, false) AS is_sold,
    p.producer_id,
    public.get_public_profile_label(up) AS producer_username
  FROM public.products p
  LEFT JOIN public.user_profiles up ON up.id = p.producer_id
  LEFT JOIN public.producer_beats_ranked pbr ON pbr.id = p.id
  WHERE p.product_type = 'beat'
    AND p.deleted_at IS NULL
    AND p.status = 'active'
    AND COALESCE(p.is_published, false) = true
    AND (
      p.early_access_until IS NULL
      OR p.early_access_until <= now()
      OR public.user_has_active_buyer_subscription(auth.uid())
    )
  ORDER BY
    CASE WHEN COALESCE(pbr.top_10_flag, false) THEN 0 ELSE 1 END ASC,
    COALESCE(pbr.performance_score, 0) DESC,
    COALESCE(p.play_count, 0) DESC,
    p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 24);
$$;

COMMENT ON FUNCTION public.get_public_home_featured_beats(integer)
IS 'Public-safe featured beats feed for homepage discovery, with premium-only early access support.';

REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO service_role;

DO $$
DECLARE
  has_watermarked_path boolean;
  has_watermark_profile_id boolean;
  watermarked_path_expr text;
  watermark_profile_expr text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'watermarked_path'
  ) INTO has_watermarked_path;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'watermark_profile_id'
  ) INTO has_watermark_profile_id;

  watermarked_path_expr := CASE
    WHEN has_watermarked_path THEN 'p.watermarked_path AS watermarked_path'
    ELSE 'NULL::text AS watermarked_path'
  END;

  watermark_profile_expr := CASE
    WHEN has_watermark_profile_id THEN 'p.watermark_profile_id AS watermark_profile_id'
    ELSE 'NULL::uuid AS watermark_profile_id'
  END;

  EXECUTE format($view$
    CREATE OR REPLACE VIEW public.public_catalog_products
    WITH (security_invoker = true)
    AS
    SELECT
      p.id,
      p.producer_id,
      p.title,
      p.slug,
      p.description,
      p.product_type,
      p.genre_id,
      g.name AS genre_name,
      g.name_en AS genre_name_en,
      g.name_de AS genre_name_de,
      g.slug AS genre_slug,
      p.mood_id,
      m.name AS mood_name,
      m.name_en AS mood_name_en,
      m.name_de AS mood_name_de,
      m.slug AS mood_slug,
      p.bpm,
      p.key_signature,
      p.price,
      p.early_access_until,
      %s,
      p.watermarked_bucket,
      p.preview_url,
      p.exclusive_preview_url,
      p.cover_image_url,
      p.is_exclusive,
      p.is_sold,
      p.sold_at,
      p.sold_to_user_id,
      p.is_published,
      p.status,
      p.version,
      p.original_beat_id,
      p.version_number,
      p.parent_product_id,
      p.archived_at,
      p.play_count,
      p.tags,
      p.duration_seconds,
      p.file_format,
      p.license_terms,
      %s,
      p.created_at,
      p.updated_at,
      p.deleted_at,
      pp.username AS producer_username,
      pp.raw_username AS producer_raw_username,
      pp.avatar_url AS producer_avatar_url,
      COALESCE(pp.is_producer_active, false) AS producer_is_active,
      COALESCE(pbr.sales_count, 0) AS sales_count,
      COALESCE(pbr.battle_wins, 0) AS battle_wins,
      COALESCE(pbr.recency_bonus, 0) AS recency_bonus,
      COALESCE(pbr.performance_score, 0) AS performance_score,
      pbr.producer_rank,
      COALESCE(pbr.top_10_flag, false) AS top_10_flag
    FROM public.products p
    LEFT JOIN public.public_producer_profiles pp
      ON pp.user_id = p.producer_id
    LEFT JOIN public.genres g
      ON g.id = p.genre_id
    LEFT JOIN public.moods m
      ON m.id = p.mood_id
    LEFT JOIN public.producer_beats_ranked pbr
      ON pbr.id = p.id
    WHERE p.deleted_at IS NULL
      AND (
        p.product_type <> 'beat'
        OR p.early_access_until IS NULL
        OR p.early_access_until <= now()
        OR public.user_has_active_buyer_subscription(auth.uid())
      )
  $view$, watermarked_path_expr, watermark_profile_expr);
END
$$;

COMMENT ON VIEW public.public_catalog_products
IS 'Public-safe catalog read model enriched with producer ranking and premium early access filtering.';

REVOKE ALL ON TABLE public.public_catalog_products FROM PUBLIC;
REVOKE ALL ON TABLE public.public_catalog_products FROM anon;
REVOKE ALL ON TABLE public.public_catalog_products FROM authenticated;
GRANT SELECT ON TABLE public.public_catalog_products TO anon;
GRANT SELECT ON TABLE public.public_catalog_products TO authenticated;
GRANT SELECT ON TABLE public.public_catalog_products TO service_role;

CREATE OR REPLACE FUNCTION public.purchase_beat_with_credits(
  p_product_id uuid,
  p_license_id uuid DEFAULT NULL
)
RETURNS TABLE (
  purchase_id uuid,
  product_id uuid,
  license_id uuid,
  credits_spent integer,
  balance_before integer,
  balance_after integer,
  entitlement_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_existing_purchase_id uuid;
  v_existing_claim public.credit_purchase_claims%ROWTYPE;
  v_balance_before integer := 0;
  v_balance_after integer := 0;
  v_purchase_id uuid;
  v_entitlement_id uuid;
  v_required_credits integer := 0;
  v_credit_unit_value_cents integer := 1000;
  v_gross_reference_amount_cents integer := 0;
  v_producer_share_bps integer := 6000;
  v_platform_share_bps integer := 4000;
  v_producer_share_cents integer := 0;
  v_platform_share_cents integer := 0;
  v_economics_version text := 'credits_v4_fixed_unit_value';
  v_ledger_idempotency_key text;
  v_claim_id uuid;
  v_config jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'product_deleted' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.product_type <> 'beat'::public.product_type THEN
    RAISE EXCEPTION 'product_not_credit_eligible' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'product_not_active' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'product_not_published' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.early_access_until IS NOT NULL
    AND v_product.early_access_until > now()
    AND public.user_has_active_buyer_subscription(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'early_access_premium_only' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.is_exclusive IS TRUE OR v_product.product_type = 'exclusive'::public.product_type THEN
    RAISE EXCEPTION 'exclusive_not_allowed_with_credits' USING ERRCODE = 'P0001';
  END IF;

  IF v_product.is_sold IS TRUE OR v_product.sold_at IS NOT NULL OR v_product.sold_to_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'product_not_available' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_product.price, 0) <= 0 THEN
    RAISE EXCEPTION 'product_not_credit_eligible' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.id
  INTO v_existing_purchase_id
  FROM public.purchases p
  WHERE p.user_id = v_uid
    AND p.product_id = p_product_id
    AND p.status = 'completed'
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_existing_purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'purchase_already_exists' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.credit_purchase_claims (
    user_id,
    product_id,
    license_id
  ) VALUES (
    v_uid,
    p_product_id,
    NULL
  )
  ON CONFLICT (user_id, product_id) DO NOTHING
  RETURNING id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    SELECT *
    INTO v_existing_claim
    FROM public.credit_purchase_claims
    WHERE user_id = v_uid
      AND product_id = p_product_id
    LIMIT 1;

    IF v_existing_claim.purchase_id IS NOT NULL THEN
      RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'P0001';
    END IF;

    RAISE EXCEPTION 'concurrent_purchase_conflict' USING ERRCODE = '40001';
  END IF;

  SELECT value
  INTO v_config
  FROM public.app_settings
  WHERE key = 'credit_purchase_economics';

  v_producer_share_bps := GREATEST(LEAST(COALESCE((v_config->>'producer_share_bps')::integer, v_producer_share_bps), 10000), 0);
  v_platform_share_bps := GREATEST(LEAST(COALESCE((v_config->>'platform_share_bps')::integer, v_platform_share_bps), 10000), 0);
  v_economics_version := COALESCE(NULLIF(v_config->>'version', ''), v_economics_version);

  IF v_producer_share_bps + v_platform_share_bps <> 10000 THEN
    RAISE EXCEPTION 'invalid_credit_purchase_economics_config' USING ERRCODE = 'P0001';
  END IF;

  v_gross_reference_amount_cents := v_product.price;
  v_required_credits := GREATEST(
    CEIL(v_gross_reference_amount_cents::numeric / 1000::numeric)::integer,
    1
  );

  v_producer_share_cents := FLOOR((v_gross_reference_amount_cents::numeric * v_producer_share_bps::numeric) / 10000)::integer;
  v_platform_share_cents := v_gross_reference_amount_cents - v_producer_share_cents;

  SELECT COALESCE(SUM(l.balance_delta), 0)::integer
  INTO v_balance_before
  FROM public.user_credit_ledger l
  WHERE l.user_id = v_uid;

  IF v_balance_before < v_required_credits THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  v_balance_after := v_balance_before - v_required_credits;

  INSERT INTO public.purchases (
    user_id,
    product_id,
    producer_id,
    amount,
    currency,
    status,
    is_exclusive,
    license_type,
    license_id,
    completed_at,
    download_expires_at,
    purchase_source,
    credits_spent,
    credit_unit_value_cents_snapshot,
    gross_reference_amount_cents,
    producer_share_cents_snapshot,
    platform_share_cents_snapshot,
    price_snapshot,
    currency_snapshot,
    license_type_snapshot,
    license_name_snapshot,
    metadata
  ) VALUES (
    v_uid,
    p_product_id,
    v_product.producer_id,
    0,
    'eur',
    'completed',
    false,
    'standard',
    NULL,
    now(),
    now() + interval '7 days',
    'credits',
    v_required_credits,
    v_credit_unit_value_cents,
    v_gross_reference_amount_cents,
    v_producer_share_cents,
    v_platform_share_cents,
    v_gross_reference_amount_cents,
    'eur',
    'standard',
    'Standard',
    jsonb_build_object(
      'purchase_mode', 'credits',
      'credit_cost', v_required_credits,
      'credit_unit_value_cents_snapshot', v_credit_unit_value_cents,
      'gross_reference_amount_cents', v_gross_reference_amount_cents,
      'producer_share_cents_snapshot', v_producer_share_cents,
      'platform_share_cents_snapshot', v_platform_share_cents,
      'economic_snapshot_version', v_economics_version,
      'price_source', 'products.price'
    )
  )
  RETURNING id INTO v_purchase_id;

  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'concurrent_purchase_conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.credit_purchase_claims
  SET purchase_id = v_purchase_id
  WHERE id = v_claim_id;

  v_ledger_idempotency_key := format('credit_purchase:%s', v_purchase_id::text);

  INSERT INTO public.user_credit_ledger (
    user_id,
    purchase_id,
    entry_type,
    direction,
    credits_amount,
    balance_delta,
    running_balance,
    reason,
    idempotency_key,
    metadata
  ) VALUES (
    v_uid,
    v_purchase_id,
    'purchase_debit',
    'debit',
    v_required_credits,
    -v_required_credits,
    v_balance_after,
    'credit_purchase',
    v_ledger_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'purchase_source', 'credits',
      'price_source', 'products.price'
    )
  );

  INSERT INTO public.entitlements (
    user_id,
    product_id,
    purchase_id,
    entitlement_type
  ) VALUES (
    v_uid,
    p_product_id,
    v_purchase_id,
    'purchase'
  )
  ON CONFLICT (user_id, product_id) DO UPDATE
  SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now()
  RETURNING id INTO v_entitlement_id;

  UPDATE public.user_profiles
  SET total_purchases = total_purchases + 1
  WHERE id = v_uid;

  RETURN QUERY
  SELECT
    v_purchase_id,
    p_product_id,
    NULL::uuid,
    v_required_credits,
    v_balance_before,
    v_balance_after,
    v_entitlement_id,
    'completed'::text;
END;
$$;

COMMIT;
