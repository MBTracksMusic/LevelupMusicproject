/*
  # Add licensing catalog + purchase RPC

  This migration introduces a first-class `licenses` table and a new purchase
  completion RPC (`complete_license_purchase`) used by Stripe webhook flows.
  It keeps legacy purchase rows compatible by making `purchases.license_id`
  nullable and backfilling when possible.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Licenses catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  max_streams integer CHECK (max_streams IS NULL OR max_streams >= 0),
  max_sales integer CHECK (max_sales IS NULL OR max_sales >= 0),
  youtube_monetization boolean NOT NULL DEFAULT false,
  music_video_allowed boolean NOT NULL DEFAULT false,
  credit_required boolean NOT NULL DEFAULT true,
  exclusive_allowed boolean NOT NULL DEFAULT false,
  price integer NOT NULL CHECK (price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licenses_name_lower ON public.licenses (lower(name));
CREATE INDEX IF NOT EXISTS idx_licenses_exclusive_allowed ON public.licenses (exclusive_allowed);

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'licenses'
      AND policyname = 'Anyone can read licenses'
  ) THEN
    CREATE POLICY "Anyone can read licenses"
      ON public.licenses
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END
$$;

GRANT SELECT ON TABLE public.licenses TO anon;
GRANT SELECT ON TABLE public.licenses TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_licenses_updated_at'
      AND tgrelid = 'public.licenses'::regclass
  ) THEN
    CREATE TRIGGER update_licenses_updated_at
      BEFORE UPDATE ON public.licenses
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

-- Seed baseline licenses (idempotent).
INSERT INTO public.licenses (
  name,
  description,
  max_streams,
  max_sales,
  youtube_monetization,
  music_video_allowed,
  credit_required,
  exclusive_allowed,
  price
) VALUES
  (
    'Standard',
    'Licence standard pour sorties non exclusives (streaming et diffusion de base).',
    100000,
    NULL,
    true,
    false,
    true,
    false,
    2999
  ),
  (
    'Premium',
    'Licence premium avec droits et plafonds etendus pour exploitation commerciale.',
    500000,
    NULL,
    true,
    true,
    true,
    false,
    5999
  ),
  (
    'Exclusive',
    'Licence exclusive avec transfert de droits exclusifs sur le titre.',
    NULL,
    1,
    true,
    true,
    true,
    true,
    19999
  )
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  max_streams = EXCLUDED.max_streams,
  max_sales = EXCLUDED.max_sales,
  youtube_monetization = EXCLUDED.youtube_monetization,
  music_video_allowed = EXCLUDED.music_video_allowed,
  credit_required = EXCLUDED.credit_required,
  exclusive_allowed = EXCLUDED.exclusive_allowed,
  price = EXCLUDED.price,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) Purchases: add license link + backfill
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS license_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchases_license_id_fkey'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_license_id_fkey
      FOREIGN KEY (license_id)
      REFERENCES public.licenses(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_purchases_license_id
  ON public.purchases (license_id)
  WHERE license_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_user_product_license
  ON public.purchases (user_id, product_id, license_id, created_at DESC);

-- Backfill legacy purchases when possible.
UPDATE public.purchases p
SET license_id = l.id,
    license_type = COALESCE(NULLIF(p.license_type, ''), l.name)
FROM public.licenses l
WHERE p.license_id IS NULL
  AND lower(COALESCE(p.license_type, '')) = lower(l.name);

WITH standard_license AS (
  SELECT id, name
  FROM public.licenses
  WHERE lower(name) = 'standard'
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE public.purchases p
SET license_id = s.id,
    license_type = COALESCE(NULLIF(p.license_type, ''), s.name)
FROM standard_license s
WHERE p.license_id IS NULL
  AND p.is_exclusive = false;

WITH exclusive_license AS (
  SELECT id, name
  FROM public.licenses
  WHERE exclusive_allowed = true
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE public.purchases p
SET license_id = e.id,
    license_type = COALESCE(NULLIF(p.license_type, ''), e.name)
FROM exclusive_license e
WHERE p.license_id IS NULL
  AND p.is_exclusive = true;

UPDATE public.purchases p
SET license_type = l.name
FROM public.licenses l
WHERE p.license_id = l.id
  AND COALESCE(NULLIF(p.license_type, ''), '') <> l.name;

-- ---------------------------------------------------------------------------
-- 3) New RPC: complete_license_purchase
-- ---------------------------------------------------------------------------
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

  -- Idempotency gate: same Stripe identifiers must return same purchase id.
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

  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  IF v_license.price <> p_amount THEN
    RAISE EXCEPTION 'Amount mismatch for license %. Expected %, got %', v_license.name, v_license.price, p_amount;
  END IF;

  IF v_product.is_exclusive AND NOT v_license.exclusive_allowed THEN
    RAISE EXCEPTION 'License % does not allow exclusive purchase', v_license.name;
  END IF;

  IF v_product.is_exclusive THEN
    IF v_product.is_sold AND v_product.sold_to_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'This exclusive product has already been sold';
    END IF;

    SELECT *
    INTO v_lock
    FROM public.exclusive_locks
    WHERE product_id = p_product_id
      AND stripe_checkout_session_id = p_checkout_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No valid lock found for this exclusive purchase';
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
      'exclusive_allowed', v_license.exclusive_allowed
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
