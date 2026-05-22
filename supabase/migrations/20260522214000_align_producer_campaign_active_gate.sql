-- Align the producer campaign server gate with the public promo UI.
--
-- Source of truth for whether a campaign can receive new waitlist requests:
-- public.producer_campaigns.is_active.
--
-- settings.pricing_producer_promo.enabled remains a marketing display flag.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_join_waitlist_preflight(
  p_email text,
  p_campaign_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode         text;
  v_campaign     public.producer_campaigns%ROWTYPE;
  v_normalized   text;
  v_used_slots   int;
BEGIN
  -- Plain waitlist (no campaign) follows the launch-mode gate only.
  IF p_campaign_type IS NULL OR btrim(p_campaign_type) = '' THEN
    SELECT site_access_mode INTO v_mode FROM public.settings LIMIT 1;
    v_mode := COALESCE(v_mode, 'private');
    IF v_mode = 'public' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'launch_public');
    END IF;
    RETURN jsonb_build_object('ok', true, 'reason', null);
  END IF;

  v_normalized := lower(btrim(p_campaign_type));

  SELECT * INTO v_campaign
  FROM public.producer_campaigns
  WHERE type = v_normalized;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_campaign_type');
  END IF;

  IF v_campaign.is_active = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_inactive');
  END IF;

  -- Slot check (only when the campaign defines a cap).
  -- A slot is consumed as soon as a user_profile is tagged with the campaign.
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

REVOKE ALL ON FUNCTION public.rpc_join_waitlist_preflight(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_join_waitlist_preflight(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_join_waitlist_preflight(text, text) TO service_role;

COMMENT ON FUNCTION public.rpc_join_waitlist_preflight(text, text) IS
  'Preflight check for the join-waitlist edge function (service_role only). Plain waitlist (no campaign) is rejected with launch_public when site_access_mode=public. Campaign-scoped waitlists are mode-independent and validated against producer_campaigns.is_active + slot caps. Reason in {launch_public, invalid_campaign_type, campaign_inactive, campaign_slots_exhausted}.';

CREATE OR REPLACE FUNCTION public.get_public_producer_campaign_status(
  p_campaign_type text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized text := lower(btrim(COALESCE(p_campaign_type, '')));
  v_type       text;
  v_is_active  boolean;
BEGIN
  IF v_normalized = '' THEN
    RETURN jsonb_build_object(
      'exists', false,
      'is_active', false,
      'reason', 'missing_campaign_type'
    );
  END IF;

  SELECT type, is_active INTO v_type, v_is_active
  FROM public.producer_campaigns
  WHERE type = v_normalized;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'exists', false,
      'is_active', false,
      'reason', 'invalid_campaign_type'
    );
  END IF;

  RETURN jsonb_build_object(
    'exists', true,
    'type', v_type,
    'is_active', COALESCE(v_is_active, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_producer_campaign_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_producer_campaign_status(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_producer_campaign_status(text) IS
  'Public read-only campaign status used by the producer promo UI. Exposes only existence and is_active for a producer_campaigns row.';

COMMIT;
