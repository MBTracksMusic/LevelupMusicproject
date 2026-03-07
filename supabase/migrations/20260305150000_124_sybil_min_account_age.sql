/*
  # Sybil hardening: minimum account age guard for sensitive actions

  Goals:
  - Ensure user_profiles has a reliable created_at timestamp.
  - Add reusable account-age guard helper.
  - Block battle vote and battle comment RPCs for very recent accounts.
*/

BEGIN;

-- 1) Ensure user_profiles.created_at exists and is usable for age checks.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.user_profiles
SET created_at = now()
WHERE created_at IS NULL;

ALTER TABLE public.user_profiles
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.user_profiles
  ALTER COLUMN created_at SET NOT NULL;

-- 2) Helper: account age check.
CREATE OR REPLACE FUNCTION public.is_account_old_enough(
  p_user_id uuid DEFAULT auth.uid(),
  p_min_age interval DEFAULT interval '24 hours'
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = COALESCE(p_user_id, auth.uid())
      AND up.created_at <= now() - COALESCE(p_min_age, interval '24 hours')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_account_old_enough(uuid, interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_account_old_enough(uuid, interval) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_account_old_enough(uuid, interval) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_old_enough(uuid, interval) TO service_role;

-- 3) Harden vote RPC with account age guard.
CREATE OR REPLACE FUNCTION public.record_battle_vote(
  p_battle_id uuid,
  p_user_id uuid,
  p_voted_for_producer_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_battle public.battles%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'vote_user_mismatch';
  END IF;

  IF NOT public.is_email_verified_user(p_user_id) THEN
    RAISE EXCEPTION 'vote_not_allowed_unverified_email';
  END IF;

  IF NOT public.is_account_old_enough(v_actor, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'record_battle_vote') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'active' THEN
    RAISE EXCEPTION 'battle_not_open_for_voting';
  END IF;

  IF v_battle.starts_at IS NULL OR now() < v_battle.starts_at THEN
    RAISE EXCEPTION 'battle_not_started';
  END IF;

  IF v_battle.voting_ends_at IS NULL OR now() >= v_battle.voting_ends_at THEN
    RAISE EXCEPTION 'battle_voting_expired';
  END IF;

  IF v_battle.producer1_id IS NULL OR v_battle.producer2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready_for_voting';
  END IF;

  IF p_voted_for_producer_id != v_battle.producer1_id
     AND p_voted_for_producer_id != v_battle.producer2_id THEN
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_actor = v_battle.producer1_id
     OR v_actor = v_battle.producer2_id THEN
    RAISE EXCEPTION 'participants_cannot_vote';
  END IF;

  IF p_voted_for_producer_id = v_actor THEN
    RAISE EXCEPTION 'self_vote_not_allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes
    WHERE battle_id = p_battle_id
      AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_voted';
  END IF;

  INSERT INTO public.battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, v_actor, p_voted_for_producer_id);

  IF p_voted_for_producer_id = v_battle.producer1_id THEN
    UPDATE public.battles
    SET votes_producer1 = votes_producer1 + 1
    WHERE id = p_battle_id;
  ELSE
    UPDATE public.battles
    SET votes_producer2 = votes_producer2 + 1
    WHERE id = p_battle_id;
  END IF;

  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;

-- 4) Harden battle comment RPC with account age guard.
CREATE OR REPLACE FUNCTION public.rpc_create_battle_comment(
  p_battle_id uuid,
  p_content text
)
RETURNS public.battle_comments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_row public.battle_comments;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_create_battle_comment') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_comment';
  END IF;

  IF char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long';
  END IF;

  -- Gate direct inserts: only this RPC sets this flag for the current transaction.
  PERFORM set_config('app.battle_comment_rpc', '1', true);

  INSERT INTO public.battle_comments (battle_id, user_id, content)
  VALUES (p_battle_id, v_user_id, v_content)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMIT;
