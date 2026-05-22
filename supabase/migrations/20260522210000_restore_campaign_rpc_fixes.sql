-- Urgent hotfix: restore the campaign-assign fixes lost in 20260522190000.
--
-- When I rewrote admin_assign_producer_campaign in 20260522190000 to add the
-- commission_rate_override = 0 for the 'founding' campaign, I copied the body
-- from migration 222 (the original) and missed the three follow-up fixes that
-- the codebase had already shipped:
--   • 225 — producer_tier value: 'pro' → 'producteur' (enum value was renamed)
--   • 226 — role CASE returned plain text; needs ::public.user_role cast
--   • 227 — set is_producer_active = true so founders show on /producers
-- The current RPC therefore raises:
--   invalid input value for enum producer_tier_type: "pro"
-- whenever an admin tries to assign a campaign.
--
-- This migration restores 225+226+227 and keeps the new F5 behaviour
-- (commission_rate_override = 0 for 'founding'). Same fix is applied to the
-- internal helper promote_founding_producer_if_eligible.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) admin_assign_producer_campaign — full restoration
-- ─────────────────────────────────────────────────────────────────────────────

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
    is_producer_active     = true,
    commission_rate_override = CASE
                                 WHEN p_campaign_type = 'founding' THEN 0.0000
                                 ELSE commission_rate_override
                               END,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) promote_founding_producer_if_eligible — same three fixes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promote_founding_producer_if_eligible(
  p_user_id uuid,
  p_email   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_waitlist_id   uuid;
  v_campaign_type text;
  v_status        text;
  v_slot_count    int;
  v_max_slots     int;
  v_current_role  text;
BEGIN
  SELECT id, campaign_type, status
    INTO v_waitlist_id, v_campaign_type, v_status
  FROM public.waitlist
  WHERE lower(email) = lower(coalesce(p_email, ''))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_status <> 'accepted' OR v_campaign_type <> 'founding' THEN
    RETURN false;
  END IF;

  SELECT max_slots INTO v_max_slots
  FROM public.producer_campaigns
  WHERE type = 'founding' AND is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_max_slots IS NOT NULL THEN
    SELECT count(*) INTO v_slot_count
    FROM public.user_profiles
    WHERE producer_campaign_type = 'founding';

    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = p_user_id AND producer_campaign_type = 'founding'
    ) AND v_slot_count >= v_max_slots THEN
      RAISE WARNING 'promote_founding_producer_if_eligible: campaign full (%/%) for %',
        v_slot_count, v_max_slots, p_user_id;
      RETURN false;
    END IF;
  END IF;

  SELECT role INTO v_current_role
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.user_profiles
  SET
    producer_campaign_type   = 'founding',
    is_founding_producer     = true,
    founding_trial_start     = COALESCE(founding_trial_start, now()),
    role                     = CASE
                                 WHEN v_current_role = 'admin' THEN 'admin'::public.user_role
                                 ELSE 'producer'::public.user_role
                               END,
    producer_tier            = 'producteur'::public.producer_tier_type,
    is_producer_active       = true,
    commission_rate_override = 0.0000,
    updated_at               = now()
  WHERE id = p_user_id;

  UPDATE public.waitlist
  SET user_id = COALESCE(user_id, p_user_id)
  WHERE id = v_waitlist_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_founding_producer_if_eligible(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_founding_producer_if_eligible(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_founding_producer_if_eligible(uuid, text) TO service_role;

COMMIT;
