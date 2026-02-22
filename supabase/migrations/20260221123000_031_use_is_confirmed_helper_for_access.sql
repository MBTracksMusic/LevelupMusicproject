/*
  # IAM transition step 2: use `is_confirmed_user` for confirmed-gated backend checks

  Goals:
  - Keep backward compatibility through helper logic introduced in step 1.
  - Remove direct dependency on legacy `role IN (...)` in key backend gates.
  - Keep behavior unchanged for currently confirmed users.
*/

BEGIN;

-- battle_votes INSERT policy: confirmed eligibility now goes through compatibility helper
DROP POLICY IF EXISTS "Confirmed users can vote" ON public.battle_votes;

CREATE POLICY "Confirmed users can vote"
  ON public.battle_votes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    public.is_confirmed_user(auth.uid()) AND
    EXISTS (
      SELECT 1 FROM public.battles
      WHERE id = battle_votes.battle_id
      AND status = 'voting'
    ) AND
    NOT EXISTS (
      SELECT 1 FROM public.battle_votes bv
      WHERE bv.battle_id = battle_votes.battle_id
      AND bv.user_id = auth.uid()
    )
  );

-- SQL vote recorder: use compatibility helper instead of legacy role enum checks
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
  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id FOR UPDATE;

  IF NOT FOUND OR v_battle.status != 'voting' THEN
    RETURN false;
  END IF;

  IF p_voted_for_producer_id != v_battle.producer1_id AND p_voted_for_producer_id != v_battle.producer2_id THEN
    RETURN false;
  END IF;

  IF NOT public.is_confirmed_user(p_user_id) THEN
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

-- Preview gate helper: use centralized confirmation helper
CREATE OR REPLACE FUNCTION public.can_access_exclusive_preview(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.is_confirmed_user(p_user_id);
END;
$$;

COMMIT;
