-- Unify the founding-producer acceptance flow.
--
-- Closes 3 gaps identified by the audit of 2026-05-22:
--   F5 — admin_assign_producer_campaign now sets commission_rate_override = 0
--        for the 'founding' campaign (founders are promised 0% commission).
--   F2/F3/F4 — accepting a waitlist entry now propagates the founding status
--        to user_profiles via a single RPC (accept_waitlist_entry) that also
--        handles whitelist upsert. A trigger on user_profiles AFTER INSERT
--        catches the case where the user signs up AFTER admin acceptance.
--   F1 — supporting RPCs return enough metadata for the edge function to
--        send a confirmation email.
--
-- Strategy:
--   • Replace admin_assign_producer_campaign (additive: same signature)
--   • Add internal helper promote_founding_producer_if_eligible (SECURITY DEFINER)
--   • Add trigger on user_profiles AFTER INSERT (fires for any new account)
--   • Add accept_waitlist_entry(p_waitlist_id) for admins
--   • Backfill commission_rate_override = 0 for existing founders

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Replace admin_assign_producer_campaign — F5 (commission=0 for founding)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_assign_producer_campaign(
  p_user_id      uuid,
  p_campaign_type text,
  p_trial_start  timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign     public.producer_campaigns%ROWTYPE;
  v_slot_count   int;
  v_current_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_campaign
  FROM public.producer_campaigns
  WHERE type = p_campaign_type;

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
                               WHEN v_current_role = 'admin' THEN 'admin'
                               ELSE 'producer'
                             END,
    producer_tier          = 'pro'::public.producer_tier_type,
    -- F5: founding producers get 0% commission as promised by the campaign card
    commission_rate_override = CASE
                                 WHEN p_campaign_type = 'founding' THEN 0.0000
                                 ELSE commission_rate_override
                               END,
    updated_at             = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',        p_user_id,
    'campaign_type',  p_campaign_type,
    'trial_start',    p_trial_start,
    'trial_end',      p_trial_start + v_campaign.trial_duration,
    'slots_used',     COALESCE(v_slot_count, 0) + 1,
    'slots_max',      v_campaign.max_slots
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Internal helper: promote_founding_producer_if_eligible
--    Returns true if a promotion occurred. No admin check (system-level call).
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

  -- Campaign must exist + be active, and slots must still be available
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

    -- Idempotent: skip the cap check if this user is already on it
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
    role                     = CASE WHEN v_current_role = 'admin' THEN 'admin' ELSE 'producer' END,
    producer_tier            = 'pro'::public.producer_tier_type,
    commission_rate_override = 0.0000,
    updated_at               = now()
  WHERE id = p_user_id;

  -- Link the waitlist entry to the user_id so the audit trail is complete
  UPDATE public.waitlist
  SET user_id = COALESCE(user_id, p_user_id)
  WHERE id = v_waitlist_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_founding_producer_if_eligible(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_founding_producer_if_eligible(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Trigger on user_profiles AFTER INSERT — F2/F3/F4 (auto-promote on signup)
--    Fires when ANY new profile is created, regardless of signup path
--    (direct, Google OAuth, admin-created).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_promote_founding_producer_on_profile_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower(coalesce(NEW.email, ''));
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  PERFORM public.promote_founding_producer_if_eligible(NEW.id, v_email);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auto_promote_founding_producer_on_profile_create failed for user %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_promote_founding_producer_on_profile_create() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_auto_promote_founding_on_profile_create ON public.user_profiles;
CREATE TRIGGER trg_auto_promote_founding_on_profile_create
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_promote_founding_producer_on_profile_create();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RPC accept_waitlist_entry — F1/F2/F3 single-call admin acceptance
--    Bundles: waitlist update + whitelist upsert + immediate promotion
--    if the user already exists. Returns the metadata the edge function
--    needs to send the right confirmation email.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_waitlist_entry(
  p_waitlist_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email               text;
  v_linked_user_id      uuid;
  v_campaign_type       text;
  v_existing_profile_id uuid;
  v_promoted            boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(email), user_id, campaign_type
    INTO v_email, v_linked_user_id, v_campaign_type
  FROM public.waitlist
  WHERE id = p_waitlist_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Waitlist entry not found: %', p_waitlist_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 1) Mark accepted
  UPDATE public.waitlist
  SET status = 'accepted', accepted_at = now()
  WHERE id = p_waitlist_id;

  -- 2) Upsert access_whitelist (idempotent)
  INSERT INTO public.access_whitelist (email, is_active, granted_at)
  VALUES (v_email, true, now())
  ON CONFLICT (email) DO UPDATE
    SET is_active  = true,
        granted_at = COALESCE(public.access_whitelist.granted_at, EXCLUDED.granted_at);

  -- 3) Resolve existing user_profile (waitlist link or email match)
  IF v_linked_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_profile_id
    FROM public.user_profiles
    WHERE id = v_linked_user_id;
  END IF;

  IF v_existing_profile_id IS NULL THEN
    SELECT id INTO v_existing_profile_id
    FROM public.user_profiles
    WHERE lower(email) = v_email
    LIMIT 1;
  END IF;

  -- 4) If user already exists AND waitlist is for founding campaign,
  --    promote them now. Otherwise the AFTER INSERT trigger on user_profiles
  --    will catch them at signup time.
  IF v_existing_profile_id IS NOT NULL AND v_campaign_type = 'founding' THEN
    v_promoted := public.promote_founding_producer_if_eligible(v_existing_profile_id, v_email);
  END IF;

  RETURN jsonb_build_object(
    'waitlist_id',       p_waitlist_id,
    'email',             v_email,
    'campaign_type',     v_campaign_type,
    'whitelisted',       true,
    'user_existed',      v_existing_profile_id IS NOT NULL,
    'founding_promoted', v_promoted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_waitlist_entry(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_waitlist_entry(uuid) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Backfill commission_rate_override = 0 for existing founding producers
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.user_profiles
SET commission_rate_override = 0.0000,
    updated_at               = now()
WHERE producer_campaign_type = 'founding'
  AND (commission_rate_override IS NULL OR commission_rate_override <> 0.0000);

COMMIT;
