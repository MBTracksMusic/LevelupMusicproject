/*
  # Add admin RPC to extend battle voting duration

  Additive migration:
  - extends ai_admin_actions.action_type with battle_duration_extended
  - adds admin_extend_battle_duration(p_battle_id, p_days, p_reason)

  Notes:
  - Existing RPC signatures remain unchanged.
  - finalize_expired_battles behavior remains unchanged.
*/

BEGIN;

ALTER TABLE public.ai_admin_actions
DROP CONSTRAINT IF EXISTS ai_admin_actions_action_type_check;

ALTER TABLE public.ai_admin_actions
ADD CONSTRAINT ai_admin_actions_action_type_check
CHECK (action_type IN (
  'battle_validate',
  'battle_cancel',
  'battle_finalize',
  'comment_moderation',
  'match_recommendation',
  'battle_duration_set',
  'battle_duration_extended'
));

CREATE OR REPLACE FUNCTION public.admin_extend_battle_duration(
  p_battle_id uuid,
  p_days integer,
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
  v_before_voting_ends_at timestamptz;
  v_after_voting_ends_at timestamptz;
  v_reason_text text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'invalid_extension_days';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status NOT IN ('active', 'voting') THEN
    RAISE EXCEPTION 'battle_not_open_for_extension';
  END IF;

  IF v_battle.voting_ends_at IS NULL THEN
    RAISE EXCEPTION 'battle_has_no_voting_end';
  END IF;

  v_before_voting_ends_at := v_battle.voting_ends_at;
  v_after_voting_ends_at := v_before_voting_ends_at + (p_days || ' days')::interval;

  UPDATE public.battles
  SET voting_ends_at = v_after_voting_ends_at,
      updated_at = now()
  WHERE id = p_battle_id;

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    executed_at,
    executed_by
  )
  VALUES (
    'battle_duration_extended',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'before_voting_ends_at', v_before_voting_ends_at,
      'after_voting_ends_at', v_after_voting_ends_at,
      'days_added', p_days,
      'actor', v_actor,
      'reason_text', v_reason_text
    ),
    1.0,
    'Battle duration extended by admin',
    'executed',
    now(),
    v_actor
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) TO service_role;

COMMIT;
