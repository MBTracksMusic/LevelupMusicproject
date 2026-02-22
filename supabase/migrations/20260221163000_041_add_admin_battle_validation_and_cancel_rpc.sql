/*
  # Admin validation/cancel workflow for battles

  Adds:
  - admin_validate_battle(p_battle_id)
  - admin_cancel_battle(p_battle_id)

  Hardens:
  - producer status-transition RPCs are no longer callable by authenticated users.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_validate_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'awaiting_admin' THEN
    RAISE EXCEPTION 'battle_not_waiting_admin_validation';
  END IF;

  UPDATE public.battles
  SET status = 'active',
      admin_validated_at = now(),
      starts_at = COALESCE(starts_at, now()),
      updated_at = now()
  WHERE id = p_battle_id;

  UPDATE public.user_profiles
  SET battles_participated = COALESCE(battles_participated, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status = 'completed' THEN
    RAISE EXCEPTION 'cannot_cancel_completed_battle';
  END IF;

  UPDATE public.battles
  SET status = 'cancelled',
      winner_id = NULL,
      updated_at = now()
  WHERE id = p_battle_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) TO service_role;

-- Prevent producer-side status bypass paths from previous iterations.
REVOKE EXECUTE ON FUNCTION public.producer_publish_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.producer_publish_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.producer_publish_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.producer_publish_battle(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) TO service_role;

COMMIT;
