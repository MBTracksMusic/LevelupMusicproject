/*
  # Prevent duplicate completed purchases per user+product

  Problem: no uniqueness constraint on (user_id, product_id) in purchases.
  Deduplication was only by Stripe session/payment intent IDs, so two separate
  checkout sessions for the same (user, product) could both complete successfully.

  Fixes applied:

  1. Partial unique index on purchases(user_id, product_id) WHERE status = 'completed'
     → Hard DB guarantee: impossible to hold two completed purchases for the same product.
     → Pending / failed / refunded rows are NOT constrained (Stripe retries are safe).
     → IF NOT EXISTS makes this migration idempotent.

  2. Updated complete_license_purchase:
     → Adds Fallback 2 after the existing Stripe-ID fallback.
     → If the INSERT is swallowed by ON CONFLICT DO NOTHING due to the new index
       (two parallel webhook deliveries for different Stripe sessions, same user+product),
       the function resolves the existing completed row by (user_id, product_id) instead
       of crashing.
     → Stripe idempotency (primary dedup by Stripe IDs) is fully preserved.
     → Exclusive product logic is unchanged.
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 1: Pre-index deduplication — resolve existing duplicate completed rows
-- ─────────────────────────────────────────────────────────────────────────────
-- Must run before the unique index.  Uses ROW_NUMBER() to identify the canonical
-- row (most recent created_at, id DESC as tiebreaker) and marks all others as
-- 'failed' so they are excluded from the WHERE status = 'completed' index filter.
-- A _dedup metadata stamp distinguishes these from genuine payment failures.
-- Step A runs first so that entitlements are re-pointed while all rows are still
-- 'completed' and the ranked window is unambiguous.

-- Step A: re-point entitlements that reference a superseded purchase to the
--         canonical (newest) purchase for the same (user_id, product_id).
WITH ranked AS (
  SELECT
    id,
    user_id,
    product_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, product_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.purchases
  WHERE status = 'completed'
),
canonical AS (
  SELECT id AS canonical_id, user_id, product_id
  FROM ranked
  WHERE rn = 1
),
superseded AS (
  SELECT id AS superseded_id, user_id, product_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.entitlements AS e
   SET purchase_id = c.canonical_id
  FROM superseded s
  JOIN canonical c
    ON c.user_id    = s.user_id
   AND c.product_id = s.product_id
 WHERE e.purchase_id = s.superseded_id;

-- Step B: mark superseded duplicates as 'failed' and stamp metadata for audit.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, product_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.purchases
  WHERE status = 'completed'
),
superseded AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.purchases AS p
   SET status   = 'failed',
       metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
         '_dedup', jsonb_build_object(
           'reason',          'superseded_duplicate_completed_purchase',
           'deduplicated_at', now()::text,
           'migration',       '187_prevent_duplicate_completed_purchases'
         )
       )
  FROM superseded
 WHERE p.id = superseded.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 2: DB-level partial unique index
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_unique_completed_user_product
  ON public.purchases(user_id, product_id)
  WHERE status = 'completed';

-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 3: Updated completion RPC — handles race on the new index
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_license_purchase(
  p_product_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_license_id uuid,
  p_amount integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase_id uuid;
  v_existing_purchase_id uuid;
  v_producer_id uuid;
  v_product public.products%ROWTYPE;
  v_license public.licenses%ROWTYPE;
  v_existing_license_sales integer;
  v_lock public.exclusive_locks%ROWTYPE;
  v_is_new_purchase boolean := false;
BEGIN
  IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'Missing checkout session id';
  END IF;

  IF p_payment_intent_id IS NULL OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Missing payment intent id';
  END IF;

  -- Primary Stripe-ID dedup: covers webhook replay and duplicate Stripe events.
  SELECT id
  INTO v_existing_purchase_id
  FROM public.purchases
  WHERE stripe_payment_intent_id = p_payment_intent_id
     OR stripe_checkout_session_id = p_checkout_session_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_purchase_id IS NOT NULL THEN
    RETURN v_existing_purchase_id;
  END IF;

  -- Row-level lock serializes concurrent completion attempts on the same product.
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  SELECT *
  INTO v_license
  FROM public.licenses
  WHERE id = p_license_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'License not found: %', p_license_id;
  END IF;

  -- Snapshot amount comes from webhook (Stripe amount_total validated against checkout metadata snapshot).
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount snapshot: %', p_amount;
  END IF;

  IF v_product.is_exclusive AND NOT v_license.exclusive_allowed THEN
    RAISE EXCEPTION 'License % does not allow exclusive purchase', v_license.name;
  END IF;

  IF v_product.is_exclusive THEN
    -- Strict single-sale invariant for exclusives (after product row lock).
    IF v_product.is_sold THEN
      RAISE EXCEPTION 'This exclusive product has already been sold';
    END IF;

    SELECT *
    INTO v_lock
    FROM public.exclusive_locks
    WHERE product_id = p_product_id
      AND stripe_checkout_session_id = p_checkout_session_id;

    IF NOT FOUND THEN
      -- Paid-session resilience:
      -- do not reject a confirmed Stripe payment only because lock TTL elapsed/reclaimed.
      -- Concurrency safety is still enforced by product row lock + sold guard above.
      RAISE NOTICE 'complete_license_purchase: missing lock for paid exclusive checkout %, product %, user %; proceeding',
        p_checkout_session_id, p_product_id, p_user_id;
    END IF;
  END IF;

  IF v_license.max_sales IS NOT NULL THEN
    SELECT count(*)
    INTO v_existing_license_sales
    FROM public.purchases
    WHERE product_id = p_product_id
      AND license_id = p_license_id
      AND status = 'completed';

    IF v_existing_license_sales >= v_license.max_sales THEN
      RAISE EXCEPTION 'License % reached max sales limit for this product', v_license.name;
    END IF;
  END IF;

  v_producer_id := v_product.producer_id;

  INSERT INTO public.purchases (
    user_id,
    product_id,
    producer_id,
    stripe_payment_intent_id,
    stripe_checkout_session_id,
    amount,
    status,
    is_exclusive,
    license_type,
    license_id,
    completed_at,
    download_expires_at,
    metadata
  ) VALUES (
    p_user_id,
    p_product_id,
    v_producer_id,
    p_payment_intent_id,
    p_checkout_session_id,
    p_amount,
    'completed',
    v_product.is_exclusive,
    v_license.name,
    v_license.id,
    now(),
    CASE
      WHEN v_product.is_exclusive THEN now() + interval '24 hours'
      ELSE now() + interval '7 days'
    END,
    jsonb_build_object(
      'license_id', v_license.id,
      'license_name', v_license.name,
      'max_streams', v_license.max_streams,
      'max_sales', v_license.max_sales,
      'youtube_monetization', v_license.youtube_monetization,
      'music_video_allowed', v_license.music_video_allowed,
      'credit_required', v_license.credit_required,
      'exclusive_allowed', v_license.exclusive_allowed,
      'price_source', 'checkout.metadata.db_price_snapshot'
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_purchase_id;

  IF v_purchase_id IS NULL THEN
    -- Fallback 1: Stripe-ID lookup.
    -- Covers webhook replay of this exact event after a crash mid-transaction.
    SELECT id
    INTO v_purchase_id
    FROM public.purchases
    WHERE stripe_payment_intent_id = p_payment_intent_id
       OR stripe_checkout_session_id = p_checkout_session_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Fallback 2: ownership lookup.
    -- Covers the race where two parallel webhook deliveries for *different* Stripe sessions
    -- (same user + product) both passed the primary Stripe-ID dedup check before either
    -- committed. The second INSERT was swallowed by ON CONFLICT DO NOTHING due to the
    -- partial unique index on (user_id, product_id) WHERE status = 'completed'.
    -- Fallback 1 returned NULL because the existing row has different Stripe IDs.
    -- We recover here instead of crashing, preserving Stripe idempotency.
    IF v_purchase_id IS NULL THEN
      SELECT id
      INTO v_purchase_id
      FROM public.purchases
      WHERE user_id = p_user_id
        AND product_id = p_product_id
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF v_purchase_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve existing purchase for payment intent %', p_payment_intent_id;
    END IF;
  ELSE
    v_is_new_purchase := true;
  END IF;

  INSERT INTO public.entitlements (
    user_id,
    product_id,
    purchase_id,
    entitlement_type
  ) VALUES (
    p_user_id,
    p_product_id,
    v_purchase_id,
    'purchase'
  )
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now();

  IF v_product.is_exclusive THEN
    UPDATE public.products
    SET
      is_sold = true,
      sold_at = now(),
      sold_to_user_id = p_user_id,
      is_published = false
    WHERE id = p_product_id;

    DELETE FROM public.exclusive_locks
    WHERE product_id = p_product_id;
  END IF;

  IF v_is_new_purchase THEN
    UPDATE public.user_profiles
    SET total_purchases = total_purchases + 1
    WHERE id = p_user_id;
  END IF;

  RETURN v_purchase_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_license_purchase(uuid, uuid, text, text, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_license_purchase(uuid, uuid, text, text, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_license_purchase(uuid, uuid, text, text, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_license_purchase(uuid, uuid, text, text, uuid, integer) TO service_role;

COMMIT;
