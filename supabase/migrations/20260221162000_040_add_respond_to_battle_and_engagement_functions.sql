/*
  # Respond-to-battle workflow + engagement scoring helpers

  Adds:
  - recalculate_engagement(p_user_id)
  - respond_to_battle(p_battle_id, p_accept, p_reason)
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_engagement(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_score integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  UPDATE public.user_profiles up
  SET engagement_score = (COALESCE(up.battles_completed, 0) * 2) - (COALESCE(up.battle_refusal_count, 0) * 1)
  WHERE up.id = p_user_id
  RETURNING up.engagement_score INTO v_score;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  RETURN v_score;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_battle(
  p_battle_id uuid,
  p_accept boolean,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.producer2_id IS NULL OR v_battle.producer2_id != v_actor THEN
    RAISE EXCEPTION 'only_invited_producer_can_respond';
  END IF;

  IF v_battle.status != 'pending_acceptance' THEN
    RAISE EXCEPTION 'battle_not_waiting_for_response';
  END IF;

  IF v_battle.accepted_at IS NOT NULL OR v_battle.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'response_already_recorded';
  END IF;

  IF p_accept THEN
    UPDATE public.battles
    SET status = 'awaiting_admin',
        accepted_at = now(),
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_battle_id;
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'rejection_reason_required';
    END IF;

    UPDATE public.battles
    SET status = 'rejected',
        rejected_at = now(),
        accepted_at = NULL,
        rejection_reason = v_reason,
        updated_at = now()
    WHERE id = p_battle_id;

    UPDATE public.user_profiles
    SET battle_refusal_count = COALESCE(battle_refusal_count, 0) + 1,
        updated_at = now()
    WHERE id = v_actor;

    PERFORM public.recalculate_engagement(v_actor);
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalculate_engagement(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_engagement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_engagement(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_engagement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_engagement(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) TO authenticated;

COMMIT;
