/*
  # Harden paid checkout completion (price snapshot + exclusive lock race resilience)

  Critical fixes:
  1) Price source of truth is the immutable checkout snapshot validated in webhook.
     -> complete_license_purchase no longer reads products.price.
  2) A confirmed paid exclusive session must not fail only because lock TTL elapsed.
     -> if matching lock is missing, proceed with paid-session fallback (product row lock + sold guard remain enforced).
*/

BEGIN;

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
    SELECT id
    INTO v_purchase_id
    FROM public.purchases
    WHERE stripe_payment_intent_id = p_payment_intent_id
       OR stripe_checkout_session_id = p_checkout_session_id
    ORDER BY created_at DESC
    LIMIT 1;

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
