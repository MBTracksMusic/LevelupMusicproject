/*
  # Active-vote only + completion engagement updates

  - Votes allowed only when battle.status = 'active'.
  - finalize_battle increments completion counters and recalculates engagement.
  - finalize_expired_battles handles active (and legacy voting) battles.
  - Adds non-enforced helper for future refusal-based temporary blocks.
*/

BEGIN;

DROP POLICY IF EXISTS "Confirmed users can vote" ON public.battle_votes;

CREATE POLICY "Confirmed users can vote"
  ON public.battle_votes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_confirmed_user(auth.uid())
    AND voted_for_producer_id != auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.battles b
      WHERE b.id = battle_votes.battle_id
        AND b.status = 'active'
        AND b.producer1_id IS NOT NULL
        AND b.producer2_id IS NOT NULL
        AND (
          voted_for_producer_id = b.producer1_id
          OR voted_for_producer_id = b.producer2_id
        )
        AND auth.uid() != b.producer1_id
        AND auth.uid() != b.producer2_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.battle_votes bv
      WHERE bv.battle_id = battle_votes.battle_id
        AND bv.user_id = auth.uid()
    )
  );

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

  IF NOT public.is_confirmed_user(v_actor) THEN
    RAISE EXCEPTION 'vote_not_allowed_unconfirmed_user';
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

CREATE OR REPLACE FUNCTION public.finalize_battle(p_battle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_battle public.battles%ROWTYPE;
  v_winner_id uuid;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status = 'cancelled' THEN
    RAISE EXCEPTION 'battle_cancelled';
  END IF;

  IF v_battle.status = 'completed' THEN
    RETURN v_battle.winner_id;
  END IF;

  IF v_battle.status NOT IN ('active', 'voting') THEN
    RAISE EXCEPTION 'battle_not_open_for_finalization';
  END IF;

  IF v_battle.votes_producer1 > v_battle.votes_producer2 THEN
    v_winner_id := v_battle.producer1_id;
  ELSIF v_battle.votes_producer2 > v_battle.votes_producer1 THEN
    v_winner_id := v_battle.producer2_id;
  ELSE
    v_winner_id := NULL;
  END IF;

  UPDATE public.battles
  SET status = 'completed',
      winner_id = v_winner_id,
      voting_ends_at = COALESCE(voting_ends_at, now()),
      updated_at = now()
  WHERE id = p_battle_id;

  UPDATE public.user_profiles
  SET battles_completed = COALESCE(battles_completed, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  RETURN v_winner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  FOR v_row IN
    SELECT b.id
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    PERFORM public.finalize_battle(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.should_flag_battle_refusal_risk(
  p_user_id uuid,
  p_threshold integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refusals integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.battle_refusal_count, 0)
  INTO v_refusals
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Intentionally informational only for now (not auto-enforced in policies).
  RETURN v_refusals >= GREATEST(1, COALESCE(p_threshold, 5));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.should_flag_battle_refusal_risk(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.should_flag_battle_refusal_risk(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.should_flag_battle_refusal_risk(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.should_flag_battle_refusal_risk(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.should_flag_battle_refusal_risk(uuid, integer) TO service_role;

COMMIT;
