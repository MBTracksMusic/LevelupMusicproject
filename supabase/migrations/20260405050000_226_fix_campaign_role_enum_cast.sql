/*
  # Fix campaign role enum cast

  ## Why
  `public.user_profiles.role` is of type `public.user_role`.
  The campaign assignment RPC used a CASE expression returning bare text
  literals (`'admin'`, `'producer'`), which makes Postgres infer `text`
  for the whole expression and fail on UPDATE.

  ## Scope
  - Fix only `public.admin_assign_producer_campaign(...)`
  - Keep Stripe and subscription behavior unchanged
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_assign_producer_campaign(
  p_user_id       uuid,
  p_campaign_type text,
  p_trial_start   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign     public.producer_campaigns%ROWTYPE;
  v_slot_count   int := 0;
  v_current_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign
  FROM public.producer_campaigns
  WHERE type = p_campaign_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_type
      USING ERRCODE = 'P0002';
  END IF;

  IF v_campaign.is_active = false THEN
    RAISE EXCEPTION 'Campaign % is not active', p_campaign_type
      USING ERRCODE = '22023';
  END IF;

  IF v_campaign.max_slots IS NOT NULL THEN
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;

    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = p_user_id AND producer_campaign_type = p_campaign_type
    ) THEN
      IF v_slot_count >= v_campaign.max_slots THEN
        RAISE EXCEPTION 'Campaign % is full (% / % slots used)',
          p_campaign_type, v_slot_count, v_campaign.max_slots
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = p_campaign_type;
  END IF;

  SELECT role INTO v_current_role
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id
      USING ERRCODE = '02000';
  END IF;

  UPDATE public.user_profiles
  SET
    producer_campaign_type = p_campaign_type,
    is_founding_producer   = CASE
                               WHEN p_campaign_type = 'founding' THEN true
                               ELSE is_founding_producer
                             END,
    founding_trial_start   = COALESCE(
                               CASE
                                 WHEN producer_campaign_type = p_campaign_type
                                 THEN founding_trial_start
                               END,
                               p_trial_start
                             ),
    role                   = CASE
                               WHEN v_current_role = 'admin' THEN 'admin'::public.user_role
                               ELSE 'producer'::public.user_role
                             END,
    producer_tier          = 'producteur'::public.producer_tier_type,
    updated_at             = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',       p_user_id,
    'campaign_type', p_campaign_type,
    'trial_start',   p_trial_start,
    'trial_end',     p_trial_start + v_campaign.trial_duration,
    'slots_used',    v_slot_count + 1,
    'slots_max',     v_campaign.max_slots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_assign_producer_campaign(uuid, text, timestamptz)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_assign_producer_campaign(uuid, text, timestamptz)
  FROM anon;

COMMIT;
