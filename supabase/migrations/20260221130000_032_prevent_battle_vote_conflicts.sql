/*
  # IAM transition step 3: block voting conflicts of interest in battles

  Goals:
  - Prevent participants from voting in their own battle.
  - Prevent any self-vote attempt.
  - Enforce rules at backend level (RLS + SQL function).
*/

BEGIN;

-- Harden INSERT policy on battle_votes
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
        AND b.status = 'voting'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.battles b
      WHERE b.id = battle_votes.battle_id
        AND (
          b.producer1_id = auth.uid()
          OR b.producer2_id = auth.uid()
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.battle_votes bv
      WHERE bv.battle_id = battle_votes.battle_id
        AND bv.user_id = auth.uid()
    )
  );

-- Harden vote recorder function with the same anti-conflict rules
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
BEGIN
  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND OR v_battle.status != 'voting' THEN
    RETURN false;
  END IF;

  -- Vote target must be one of battle participants.
  IF p_voted_for_producer_id != v_battle.producer1_id
     AND p_voted_for_producer_id != v_battle.producer2_id THEN
    RETURN false;
  END IF;

  IF NOT public.is_confirmed_user(p_user_id) THEN
    RETURN false;
  END IF;

  -- A participant cannot vote in their own battle.
  IF p_user_id = v_battle.producer1_id
     OR p_user_id = v_battle.producer2_id THEN
    RETURN false;
  END IF;

  -- Generic self-vote guard.
  IF p_voted_for_producer_id = p_user_id THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes
    WHERE battle_id = p_battle_id
      AND user_id = p_user_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, p_user_id, p_voted_for_producer_id);

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
END;
$$;

COMMIT;
