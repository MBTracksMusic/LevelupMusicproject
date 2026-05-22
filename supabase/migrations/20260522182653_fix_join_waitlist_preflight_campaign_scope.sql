-- Corrective migration on top of 20260522182343_add_join_waitlist_preflight_rpc.
--
-- Bug: the previous version rejected ALL signups with 'launch_public' when
-- site_access_mode='public', including campaign-scoped signups (e.g. the
-- 'founding' cohort). But campaign waitlists are bounded cohorts that
-- exist independently of the general launch mode — production currently
-- runs in 'public' mode while still soliciting founding producers via
-- ProducerPromoCard, so the previous logic broke that funnel entirely.
--
-- Fix: only return 'launch_public' for plain waitlist signups
-- (p_campaign_type IS NULL). Campaign-scoped signups bypass the launch
-- mode check and are validated against producer_campaigns + slot cap only.

CREATE OR REPLACE FUNCTION public.rpc_join_waitlist_preflight(
  p_email text,
  p_campaign_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode         text;
  v_campaign     public.producer_campaigns%ROWTYPE;
  v_normalized   text;
  v_used_slots   int;
BEGIN
  -- Plain waitlist (no campaign) → only useful in private/controlled modes.
  -- Once the site is public, callers should sign up directly via Register.
  IF p_campaign_type IS NULL OR btrim(p_campaign_type) = '' THEN
    SELECT site_access_mode INTO v_mode FROM public.settings LIMIT 1;
    v_mode := COALESCE(v_mode, 'private');
    IF v_mode = 'public' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'launch_public');
    END IF;
    RETURN jsonb_build_object('ok', true, 'reason', null);
  END IF;

  v_normalized := lower(btrim(p_campaign_type));

  -- G1. campaign_type must reference an active row in producer_campaigns.
  SELECT * INTO v_campaign
  FROM public.producer_campaigns
  WHERE type = v_normalized;

  IF NOT FOUND OR v_campaign.is_active = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_campaign_type');
  END IF;

  -- G2. Slot check (only when the campaign defines a cap).
  --     A slot is consumed as soon as a user_profile is tagged with the
  --     campaign — same notion the admin assignment RPCs use.
  IF v_campaign.max_slots IS NOT NULL THEN
    SELECT COUNT(*) INTO v_used_slots
    FROM public.user_profiles
    WHERE producer_campaign_type = v_campaign.type;

    IF v_used_slots >= v_campaign.max_slots THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'campaign_slots_exhausted');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', null);
END;
$$;

COMMENT ON FUNCTION public.rpc_join_waitlist_preflight(text, text) IS
  'Preflight check for the join-waitlist edge function (service_role only). Plain waitlist (no campaign) is rejected with launch_public when site_access_mode=public. Campaign-scoped waitlists are mode-independent and only validated against producer_campaigns + slot caps. Reason in {launch_public, invalid_campaign_type, campaign_slots_exhausted}.';
