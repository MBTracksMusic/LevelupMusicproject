-- Preflight gating for the join-waitlist edge function.
--
-- Closes 3 follow-up gaps from the founding-producer audit (S573 / 3512):
--
--   G1. campaign_type was accepted as an unbounded string. Now validated
--       against producer_campaigns (must exist and be active).
--   G2. No business-side slot check. New founding signups while the
--       cohort is already full just accumulate as ghost candidates that
--       can never be promoted.
--   G3. join-waitlist accepted entries even in site_access_mode='public'.
--       When the launch is fully open, the waitlist funnel is meaningless
--       — users should sign up directly via Register.
--
-- This RPC is called by the join-waitlist edge function (service_role).
-- Returns jsonb { ok: bool, reason: text|null } where reason is one of:
--   - launch_public
--   - invalid_campaign_type
--   - campaign_slots_exhausted

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
  -- G3. Launch-mode gate.
  --     In 'public' mode the waitlist funnel is not the intended path;
  --     callers should be sent to direct registration instead.
  SELECT site_access_mode INTO v_mode FROM public.settings LIMIT 1;
  v_mode := COALESCE(v_mode, 'private');

  IF v_mode = 'public' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'launch_public');
  END IF;

  -- No campaign requested → plain waitlist signup is always allowed
  -- in private/controlled modes.
  IF p_campaign_type IS NULL OR btrim(p_campaign_type) = '' THEN
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

-- Lockdown — same pattern as accept_waitlist_entry / promote_founding_*:
-- only the edge function (service_role) should ever call this.
REVOKE ALL    ON FUNCTION public.rpc_join_waitlist_preflight(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_join_waitlist_preflight(text, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_join_waitlist_preflight(text, text) TO service_role;

COMMENT ON FUNCTION public.rpc_join_waitlist_preflight(text, text) IS
  'Preflight check for the join-waitlist edge function (service_role only). Validates site_access_mode, campaign_type and remaining campaign slots. Returns {ok, reason}; reason ∈ {launch_public, invalid_campaign_type, campaign_slots_exhausted}.';
