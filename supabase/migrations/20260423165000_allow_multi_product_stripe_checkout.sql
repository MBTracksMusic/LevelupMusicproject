BEGIN;

-- A Stripe Checkout Session / PaymentIntent can now represent a cart with
-- several products. Idempotency must therefore be unique per Stripe ref + product,
-- not per Stripe ref globally.
ALTER TABLE public.purchases
  DROP CONSTRAINT IF EXISTS purchases_stripe_payment_intent_id_key;

ALTER TABLE public.purchases
  DROP CONSTRAINT IF EXISTS purchases_stripe_checkout_session_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_unique_stripe_payment_intent_product
  ON public.purchases (stripe_payment_intent_id, product_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_unique_stripe_checkout_session_product
  ON public.purchases (stripe_checkout_session_id, product_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_standard_purchase(
  p_product_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount integer,
  p_license_type text DEFAULT 'standard'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase_id uuid;
  v_existing_status public.purchase_status;
  v_producer_id uuid;
  v_is_new_purchase boolean := false;
BEGIN
  IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'Missing checkout session id';
  END IF;

  IF p_payment_intent_id IS NULL OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Missing payment intent id';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount snapshot: %', p_amount;
  END IF;

  SELECT id, status
  INTO v_purchase_id, v_existing_status
  FROM public.purchases
  WHERE user_id = p_user_id
    AND product_id = p_product_id
    AND (
      stripe_payment_intent_id = p_payment_intent_id
      OR stripe_checkout_session_id = p_checkout_session_id
      OR status = 'completed'
    )
  ORDER BY
    CASE
      WHEN stripe_payment_intent_id = p_payment_intent_id
        OR stripe_checkout_session_id = p_checkout_session_id
      THEN 0
      ELSE 1
    END,
    created_at DESC
  LIMIT 1;

  IF v_purchase_id IS NOT NULL AND v_existing_status = 'completed' THEN
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

    RETURN v_purchase_id;
  END IF;

  SELECT producer_id
  INTO v_producer_id
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF v_producer_id = p_user_id THEN
    RAISE EXCEPTION 'self_purchase_forbidden' USING ERRCODE = '42501';
  END IF;

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
    completed_at,
    download_expires_at
  ) VALUES (
    p_user_id,
    p_product_id,
    v_producer_id,
    p_payment_intent_id,
    p_checkout_session_id,
    p_amount,
    'completed',
    false,
    COALESCE(NULLIF(btrim(p_license_type), ''), 'standard'),
    now(),
    now() + interval '7 days'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_purchase_id;

  IF v_purchase_id IS NULL THEN
    SELECT id
    INTO v_purchase_id
    FROM public.purchases
    WHERE user_id = p_user_id
      AND product_id = p_product_id
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_purchase_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve existing purchase for product % and checkout %',
        p_product_id, p_checkout_session_id;
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

  IF v_is_new_purchase THEN
    UPDATE public.user_profiles
    SET total_purchases = total_purchases + 1
    WHERE id = p_user_id;
  END IF;

  RETURN v_purchase_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_exclusive_purchase(
  p_product_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase_id uuid;
  v_existing_status public.purchase_status;
  v_product public.products%ROWTYPE;
  v_lock public.exclusive_locks%ROWTYPE;
  v_is_new_purchase boolean := false;
BEGIN
  IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'Missing checkout session id';
  END IF;

  IF p_payment_intent_id IS NULL OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Missing payment intent id';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount snapshot: %', p_amount;
  END IF;

  SELECT id, status
  INTO v_purchase_id, v_existing_status
  FROM public.purchases
  WHERE user_id = p_user_id
    AND product_id = p_product_id
    AND (
      stripe_payment_intent_id = p_payment_intent_id
      OR stripe_checkout_session_id = p_checkout_session_id
      OR status = 'completed'
    )
  ORDER BY
    CASE
      WHEN stripe_payment_intent_id = p_payment_intent_id
        OR stripe_checkout_session_id = p_checkout_session_id
      THEN 0
      ELSE 1
    END,
    created_at DESC
  LIMIT 1;

  IF v_purchase_id IS NOT NULL AND v_existing_status = 'completed' THEN
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

    RETURN v_purchase_id;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF v_product.producer_id = p_user_id THEN
    RAISE EXCEPTION 'self_purchase_forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_product.is_sold THEN
    RAISE EXCEPTION 'This exclusive product has already been sold';
  END IF;

  SELECT *
  INTO v_lock
  FROM public.exclusive_locks
  WHERE product_id = p_product_id
    AND stripe_checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No valid lock found for this purchase';
  END IF;

  INSERT INTO public.purchases (
    user_id,
    product_id,
    producer_id,
    stripe_payment_intent_id,
    stripe_checkout_session_id,
    amount,
    status,
    is_exclusive,
    completed_at,
    download_expires_at
  ) VALUES (
    p_user_id,
    p_product_id,
    v_product.producer_id,
    p_payment_intent_id,
    p_checkout_session_id,
    p_amount,
    'completed',
    true,
    now(),
    now() + interval '24 hours'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_purchase_id;

  IF v_purchase_id IS NULL THEN
    SELECT id
    INTO v_purchase_id
    FROM public.purchases
    WHERE user_id = p_user_id
      AND product_id = p_product_id
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_purchase_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve existing purchase for product % and checkout %',
        p_product_id, p_checkout_session_id;
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

  UPDATE public.products
  SET
    is_sold = true,
    sold_at = now(),
    sold_to_user_id = p_user_id,
    is_published = false
  WHERE id = p_product_id;

  DELETE FROM public.exclusive_locks
  WHERE product_id = p_product_id;

  IF v_is_new_purchase THEN
    UPDATE public.user_profiles
    SET total_purchases = total_purchases + 1
    WHERE id = p_user_id;
  END IF;

  RETURN v_purchase_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) TO service_role;

COMMIT;
