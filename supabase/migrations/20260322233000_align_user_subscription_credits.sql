/*
  # Align user subscription credits with credit unit economics

  Goals:
  - keep buyer subscription pricing sustainable
  - allocate 1 credit per paid monthly invoice
  - preserve existing idempotency and balance cap behavior
*/

BEGIN;

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
  v_idempotency_key text;
  v_existing_event public.user_credit_allocation_events%ROWTYPE;
  v_allocation_target integer := 1;
  v_balance_cap integer := 6;
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

  v_idempotency_key := format('credit_allocation:%s', btrim(p_stripe_invoice_id));

  PERFORM pg_advisory_xact_lock(hashtext(v_idempotency_key));

  SELECT *
  INTO v_existing_event
  FROM public.user_credit_allocation_events
  WHERE idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'user_id', v_existing_event.user_id,
      'subscription_id', v_existing_event.subscription_id,
      'allocated_credits', v_existing_event.allocated_credits,
      'previous_balance', v_existing_event.previous_balance,
      'new_balance', v_existing_event.new_balance,
      'stripe_invoice_id', p_stripe_invoice_id,
      'billing_period_start', v_existing_event.billing_period_start,
      'billing_period_end', v_existing_event.billing_period_end
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
      v_idempotency_key,
      'skipped_inactive_subscription',
      0,
      v_current_balance,
      v_current_balance,
      COALESCE(p_metadata, '{}'::jsonb)
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
      v_idempotency_key,
      'skipped_max_balance',
      0,
      v_current_balance,
      v_current_balance,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
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
    v_idempotency_key,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
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
    v_idempotency_key,
    'processed',
    v_allocation,
    v_current_balance,
    v_new_balance,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
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
  'Atomic and idempotent monthly allocation for buyer credits. Allocates 1 credit per paid invoice, capped at 6 total credits.';

COMMIT;
