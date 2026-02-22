/*
  # Add per-battle custom duration and passive AI duration logging

  Additive migration only:
  - battles.custom_duration_days (nullable)
  - positive check constraint on custom_duration_days
  - extends ai_admin_actions.action_type to include battle_duration_set
  - updates admin_validate_battle logic with priority:
      custom_duration_days -> app_settings -> 5
  - writes passive executed log in ai_admin_actions when duration is determined
*/

BEGIN;

ALTER TABLE public.battles
ADD COLUMN IF NOT EXISTS custom_duration_days integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'battles_custom_duration_positive'
      AND conrelid = 'public.battles'::regclass
  ) THEN
    ALTER TABLE public.battles
    ADD CONSTRAINT battles_custom_duration_positive
    CHECK (custom_duration_days IS NULL OR custom_duration_days > 0);
  END IF;
END $$;

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
  'battle_duration_set'
));

CREATE OR REPLACE FUNCTION public.admin_validate_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_new_voting_ends_at timestamptz;
  v_effective_days integer;
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

  v_new_voting_ends_at := v_battle.voting_ends_at;

  IF v_battle.voting_ends_at IS NULL THEN
    IF v_battle.custom_duration_days IS NOT NULL THEN
      v_effective_days := v_battle.custom_duration_days;
    ELSE
      SELECT COALESCE((value->>'days')::int, 5)
      INTO v_effective_days
      FROM public.app_settings
      WHERE key = 'battle_default_duration_days'
      LIMIT 1;

      v_effective_days := COALESCE(v_effective_days, 5);
    END IF;

    v_new_voting_ends_at := now() + (v_effective_days || ' days')::interval;
  END IF;

  UPDATE public.battles
  SET status = 'active',
      admin_validated_at = now(),
      starts_at = COALESCE(starts_at, now()),
      voting_ends_at = CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE voting_ends_at
      END,
      updated_at = now()
  WHERE id = p_battle_id;

  IF v_battle.voting_ends_at IS NULL THEN
    INSERT INTO public.ai_admin_actions (
      action_type,
      entity_type,
      entity_id,
      ai_decision,
      confidence_score,
      reason,
      status,
      executed_at
    )
    VALUES (
      'battle_duration_set',
      'battle',
      p_battle_id,
      jsonb_build_object(
        'effective_days', v_effective_days,
        'custom_duration', v_battle.custom_duration_days,
        'source', CASE
          WHEN v_battle.custom_duration_days IS NOT NULL THEN 'custom'
          ELSE 'app_settings'
        END
      ),
      1.0,
      'Battle duration determined during admin validation',
      'executed',
      now()
    );
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO service_role;

COMMIT;
