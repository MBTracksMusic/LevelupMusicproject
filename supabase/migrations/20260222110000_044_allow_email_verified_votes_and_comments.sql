/*
  # Allow battle votes/comments for email-verified users

  Goals:
  - Add helper `public.is_email_verified_user(uuid)` based on `auth.users.email_confirmed_at`.
  - Keep `public.is_confirmed_user` unchanged.
  - Switch battle vote/comment gates to email verification.
  - Keep producer/admin/engagement workflows unchanged.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.is_email_verified_user(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = v_uid
      AND au.email_confirmed_at IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_email_verified_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_email_verified_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_email_verified_user(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_verified_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_verified_user(uuid) TO service_role;

DROP POLICY IF EXISTS "Confirmed users can vote" ON public.battle_votes;

CREATE POLICY "Confirmed users can vote"
  ON public.battle_votes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_email_verified_user(auth.uid())
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

DROP POLICY IF EXISTS "Confirmed users can comment" ON public.battle_comments;
DROP POLICY IF EXISTS "Authenticated users can comment" ON public.battle_comments;

CREATE POLICY "Confirmed users can comment"
  ON public.battle_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_email_verified_user(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.battles
      WHERE id = battle_comments.battle_id
        AND status IN ('active', 'voting')
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

  IF NOT public.is_email_verified_user(p_user_id) THEN
    RAISE EXCEPTION 'vote_not_allowed_unverified_email';
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

COMMIT;
