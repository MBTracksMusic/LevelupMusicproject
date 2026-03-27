/*
  # Harden monthly credit allocation and surface credit payouts

  Goals:
  - enforce one monthly credit allocation per eligible subscription billing period
  - preserve existing advisory locks, cap=6, and double-spend protections
  - make credit purchases visible in the fallback payout admin flow
*/

BEGIN;

CREATE INDEX IF NOT EXISTS idx_user_credit_allocation_events_subscription_period
  ON public.user_credit_allocation_events (subscription_id, billing_period_start, billing_period_end, created_at DESC);

CREATE OR REPLACE FUNCTION public.allocate_monthly_user_credits_for_invoice(
  p_stripe_invoice_id text,
  p_stripe_subscription_id text,
  p_billing_period_start timestamptz,
  p_billing_period_end timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription public.user_subscriptions%ROWTYPE;
  v_current_balance integer := 0;
  v_allocation integer := 0;
  v_new_balance integer := 0;
  v_allocation_target integer := 1;
  v_balance_cap integer := 6;
  v_invoice_idempotency_key text;
  v_period_idempotency_key text;
  v_existing_invoice_event public.user_credit_allocation_events%ROWTYPE;
  v_existing_period_event public.user_credit_allocation_events%ROWTYPE;
BEGIN
  IF p_stripe_invoice_id IS NULL OR btrim(p_stripe_invoice_id) = '' THEN
    RAISE EXCEPTION 'missing_stripe_invoice_id' USING ERRCODE = '22023';
  END IF;

  IF p_stripe_subscription_id IS NULL OR btrim(p_stripe_subscription_id) = '' THEN
    RAISE EXCEPTION 'missing_stripe_subscription_id' USING ERRCODE = '22023';
  END IF;

  IF p_billing_period_start IS NULL OR p_billing_period_end IS NULL OR p_billing_period_end <= p_billing_period_start THEN
    RAISE EXCEPTION 'invalid_billing_period' USING ERRCODE = '22023';
  END IF;

  v_invoice_idempotency_key := format('credit_allocation_invoice:%s', btrim(p_stripe_invoice_id));
  v_period_idempotency_key := format(
    'credit_allocation_period:%s:%s:%s',
    btrim(p_stripe_subscription_id),
    to_char(p_billing_period_start AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS'),
    to_char(p_billing_period_end AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS')
  );

  PERFORM pg_advisory_xact_lock(hashtext(v_invoice_idempotency_key));
  PERFORM pg_advisory_xact_lock(hashtext(v_period_idempotency_key));

  SELECT *
  INTO v_existing_invoice_event
  FROM public.user_credit_allocation_events
  WHERE stripe_invoice_id = btrim(p_stripe_invoice_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate_invoice',
      'user_id', v_existing_invoice_event.user_id,
      'subscription_id', v_existing_invoice_event.subscription_id,
      'allocated_credits', v_existing_invoice_event.allocated_credits,
      'previous_balance', v_existing_invoice_event.previous_balance,
      'new_balance', v_existing_invoice_event.new_balance,
      'existing_status', v_existing_invoice_event.status,
      'stripe_invoice_id', v_existing_invoice_event.stripe_invoice_id,
      'requested_stripe_invoice_id', p_stripe_invoice_id,
      'billing_period_start', v_existing_invoice_event.billing_period_start,
      'billing_period_end', v_existing_invoice_event.billing_period_end
    );
  END IF;

  SELECT *
  INTO v_subscription
  FROM public.user_subscriptions
  WHERE stripe_subscription_id = p_stripe_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_subscription_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_subscription.user_id::text));

  SELECT *
  INTO v_existing_period_event
  FROM public.user_credit_allocation_events
  WHERE subscription_id = v_subscription.id
    AND billing_period_start = p_billing_period_start
    AND billing_period_end = p_billing_period_end
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate_period',
      'user_id', v_existing_period_event.user_id,
      'subscription_id', v_existing_period_event.subscription_id,
      'allocated_credits', v_existing_period_event.allocated_credits,
      'previous_balance', v_existing_period_event.previous_balance,
      'new_balance', v_existing_period_event.new_balance,
      'existing_status', v_existing_period_event.status,
      'stripe_invoice_id', v_existing_period_event.stripe_invoice_id,
      'requested_stripe_invoice_id', p_stripe_invoice_id,
      'billing_period_start', v_existing_period_event.billing_period_start,
      'billing_period_end', v_existing_period_event.billing_period_end
    );
  END IF;

  SELECT COALESCE(SUM(balance_delta), 0)::integer
  INTO v_current_balance
  FROM public.user_credit_ledger
  WHERE user_id = v_subscription.user_id;

  IF v_subscription.subscription_status NOT IN ('active', 'trialing') THEN
    INSERT INTO public.user_credit_allocation_events (
      user_id,
      subscription_id,
      stripe_invoice_id,
      billing_period_start,
      billing_period_end,
      idempotency_key,
      status,
      allocated_credits,
      previous_balance,
      new_balance,
      metadata
    ) VALUES (
      v_subscription.user_id,
      v_subscription.id,
      p_stripe_invoice_id,
      p_billing_period_start,
      p_billing_period_end,
      v_period_idempotency_key,
      'skipped_inactive_subscription',
      0,
      v_current_balance,
      v_current_balance,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'invoice_idempotency_key', v_invoice_idempotency_key,
        'period_idempotency_key', v_period_idempotency_key,
        'allocation_target', v_allocation_target,
        'balance_cap', v_balance_cap
      )
    );

    RETURN jsonb_build_object(
      'status', 'skipped_inactive_subscription',
      'user_id', v_subscription.user_id,
      'subscription_id', v_subscription.id,
      'allocated_credits', 0,
      'previous_balance', v_current_balance,
      'new_balance', v_current_balance,
      'stripe_invoice_id', p_stripe_invoice_id,
      'billing_period_start', p_billing_period_start,
      'billing_period_end', p_billing_period_end
    );
  END IF;

  IF v_current_balance >= v_balance_cap THEN
    INSERT INTO public.user_credit_allocation_events (
      user_id,
      subscription_id,
      stripe_invoice_id,
      billing_period_start,
      billing_period_end,
      idempotency_key,
      status,
      allocated_credits,
      previous_balance,
      new_balance,
      metadata
    ) VALUES (
      v_subscription.user_id,
      v_subscription.id,
      p_stripe_invoice_id,
      p_billing_period_start,
      p_billing_period_end,
      v_period_idempotency_key,
      'skipped_max_balance',
      0,
      v_current_balance,
      v_current_balance,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'invoice_idempotency_key', v_invoice_idempotency_key,
        'period_idempotency_key', v_period_idempotency_key,
        'allocation_target', v_allocation_target,
        'balance_cap', v_balance_cap
      )
    );

    RETURN jsonb_build_object(
      'status', 'skipped_max_balance',
      'user_id', v_subscription.user_id,
      'subscription_id', v_subscription.id,
      'allocated_credits', 0,
      'previous_balance', v_current_balance,
      'new_balance', v_current_balance,
      'stripe_invoice_id', p_stripe_invoice_id,
      'billing_period_start', p_billing_period_start,
      'billing_period_end', p_billing_period_end
    );
  END IF;

  v_allocation := LEAST(v_allocation_target, GREATEST(0, v_balance_cap - v_current_balance));
  v_new_balance := v_current_balance + v_allocation;

  INSERT INTO public.user_credit_ledger (
    user_id,
    subscription_id,
    entry_type,
    direction,
    credits_amount,
    balance_delta,
    running_balance,
    reason,
    stripe_invoice_id,
    billing_period_start,
    billing_period_end,
    idempotency_key,
    metadata
  ) VALUES (
    v_subscription.user_id,
    v_subscription.id,
    'monthly_allocation',
    'credit',
    v_allocation,
    v_allocation,
    v_new_balance,
    'monthly_allocation',
    p_stripe_invoice_id,
    p_billing_period_start,
    p_billing_period_end,
    v_period_idempotency_key,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'invoice_idempotency_key', v_invoice_idempotency_key,
      'period_idempotency_key', v_period_idempotency_key,
      'allocation_target', v_allocation_target,
      'balance_cap', v_balance_cap
    )
  );

  INSERT INTO public.user_credit_allocation_events (
    user_id,
    subscription_id,
    stripe_invoice_id,
    billing_period_start,
    billing_period_end,
    idempotency_key,
    status,
    allocated_credits,
    previous_balance,
    new_balance,
    metadata
  ) VALUES (
    v_subscription.user_id,
    v_subscription.id,
    p_stripe_invoice_id,
    p_billing_period_start,
    p_billing_period_end,
    v_period_idempotency_key,
    'processed',
    v_allocation,
    v_current_balance,
    v_new_balance,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'invoice_idempotency_key', v_invoice_idempotency_key,
      'period_idempotency_key', v_period_idempotency_key,
      'allocation_target', v_allocation_target,
      'balance_cap', v_balance_cap
    )
  );

  RETURN jsonb_build_object(
    'status', 'processed',
    'user_id', v_subscription.user_id,
    'subscription_id', v_subscription.id,
    'allocated_credits', v_allocation,
    'previous_balance', v_current_balance,
    'new_balance', v_new_balance,
    'stripe_invoice_id', p_stripe_invoice_id,
    'billing_period_start', p_billing_period_start,
    'billing_period_end', p_billing_period_end
  );
END;
$$;

COMMENT ON FUNCTION public.allocate_monthly_user_credits_for_invoice(text, text, timestamptz, timestamptz, jsonb) IS
  'Atomic and idempotent monthly allocation for buyer credits. Allocates up to 1 credit per eligible billing period, capped at 6 total credits.';

UPDATE public.purchases p
SET metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
  'payout_mode', 'platform_fallback',
  'payout_amount', p.producer_share_cents_snapshot,
  'requires_manual_payout', true,
  'payout_status', COALESCE(NULLIF(p.metadata->>'payout_status', ''), 'pending'),
  'tracked_at', COALESCE(NULLIF(p.metadata->>'tracked_at', ''), now()::text),
  'payout_source', 'credit_purchase'
)
WHERE p.purchase_source = 'credits'
  AND p.status = 'completed'
  AND p.producer_share_cents_snapshot IS NOT NULL
  AND COALESCE(p.metadata->>'payout_mode', '') = '';

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
      'price_source', 'products.price',
      'payout_mode', 'platform_fallback',
      'payout_amount', v_producer_share_cents,
      'requires_manual_payout', true,
      'payout_status', 'pending',
      'tracked_at', now(),
      'payout_source', 'credit_purchase'
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

CREATE OR REPLACE VIEW public.fallback_payout_alerts AS
SELECT
  p.id AS purchase_id,
  p.producer_id,
  COALESCE(NULLIF(up.username, ''), split_part(up.email, '@', 1), p.producer_id::text) AS username,
  up.email,
  ROUND(
    COALESCE(
      CASE
        WHEN COALESCE(p.metadata->>'payout_amount', '') ~ '^-?[0-9]+$'
          THEN (p.metadata->>'payout_amount')::numeric
        ELSE NULL
      END,
      p.producer_share_cents_snapshot::numeric,
      0::numeric
    ) / 100.0,
    2
  ) AS payout_amount_eur,
  GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(p.completed_at, p.created_at))) / 86400)
  )::integer AS days_pending,
  CASE
    WHEN COALESCE(p.completed_at, p.created_at) <= now() - interval '14 days' THEN 'CRITIQUE > 14 jours'
    WHEN COALESCE(p.completed_at, p.created_at) <= now() - interval '7 days' THEN 'WARNING > 7 jours'
    ELSE 'OK < 7 jours'
  END AS urgency_level
FROM public.purchases p
JOIN public.user_profiles up
  ON up.id = p.producer_id
WHERE (
    public.is_admin(auth.uid())
    OR COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
  )
  AND p.status = 'completed'
  AND COALESCE(p.metadata->>'payout_mode', '') = 'platform_fallback'
  AND lower(COALESCE(p.metadata->>'requires_manual_payout', 'false')) IN ('true', 't', '1')
  AND COALESCE(p.metadata->>'payout_status', 'pending') = 'pending'
  AND COALESCE(p.metadata->>'payout_processed_at', '') = ''
  AND COALESCE(
    CASE
      WHEN COALESCE(p.metadata->>'payout_amount', '') ~ '^-?[0-9]+$'
        THEN (p.metadata->>'payout_amount')::integer
      ELSE NULL
    END,
    p.producer_share_cents_snapshot,
    0
  ) > 0;

GRANT SELECT ON TABLE public.fallback_payout_alerts TO authenticated;
GRANT SELECT ON TABLE public.fallback_payout_alerts TO service_role;

COMMIT;
