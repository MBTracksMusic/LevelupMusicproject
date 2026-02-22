/*
  # Battles P0 hardening (vote RPC + EXECUTE grants)

  Goals:
  - Enforce strict auth checks in `record_battle_vote`.
  - Prevent vote target spoofing and participant/self-voting.
  - Keep one-vote-per-user semantics with explicit errors.
  - Tighten EXECUTE grants for battle RPCs.
  - Harden direct INSERT policy on `battle_votes` for defense in depth.

  Notes:
  - Backward-compatible migration (no DROP TABLE/COLUMN).
  - Keeps RPC name/signature unchanged.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) EXECUTE privileges hardening
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.record_battle_vote(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_battle_vote(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_battle_vote(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_battle_vote(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_battle_vote(uuid, uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) battle_votes INSERT policy hardening (defense in depth)
-- ---------------------------------------------------------------------------
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
        AND b.status IN ('active', 'voting')
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

-- ---------------------------------------------------------------------------
-- 3) Harden vote recorder with strict auth checks + explicit errors
-- ---------------------------------------------------------------------------
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

  IF v_battle.status NOT IN ('active', 'voting') THEN
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
