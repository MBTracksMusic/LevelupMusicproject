/*
  # P1 SaaS stabilization: battle state machine guardrails + homogeneous admin logs + expiry index

  Additive only:
  - documents official battles state machine
  - prevents new assignments/transitions to legacy statuses (pending, approved, voting)
  - adds homogeneous admin action logs in ai_admin_actions for:
      - admin_validate_battle
      - admin_cancel_battle
      - finalize_battle (when called by admin)
  - adds expiry index aligned with active/voting finalization scans

  No RPC signature changes.
*/

BEGIN;

COMMENT ON COLUMN public.battles.status IS
  'Official flow: pending_acceptance -> awaiting_admin -> active -> completed; rejection path: pending_acceptance -> rejected; cancel path: non-terminal -> cancelled. Legacy statuses pending/approved/voting are kept for backward compatibility and blocked for new assignments/transitions.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'battles_accept_reject_mutually_exclusive'
      AND conrelid = 'public.battles'::regclass
  ) THEN
    ALTER TABLE public.battles
    ADD CONSTRAINT battles_accept_reject_mutually_exclusive
    CHECK (NOT (accepted_at IS NOT NULL AND rejected_at IS NOT NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_legacy_battle_status_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text IN ('pending', 'approved', 'voting') THEN
      RAISE EXCEPTION 'legacy_battle_status_forbidden';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status::text IN ('pending', 'approved', 'voting')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'legacy_battle_status_transition_forbidden';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_legacy_battle_status_assignments ON public.battles;

CREATE TRIGGER trg_prevent_legacy_battle_status_assignments
  BEFORE INSERT OR UPDATE OF status ON public.battles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_legacy_battle_status_assignments();

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
  'battle_duration_extended',
  'battle_validate_admin',
  'battle_cancel_admin',
  'battle_finalize_admin'
)) NOT VALID;

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
  v_duration_source text := 'already_defined';
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
      v_duration_source := 'custom';
    ELSE
      SELECT COALESCE((value->>'days')::int, 5)
      INTO v_effective_days
      FROM public.app_settings
      WHERE key = 'battle_default_duration_days'
      LIMIT 1;

      v_effective_days := COALESCE(v_effective_days, 5);
      v_duration_source := 'app_settings';
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

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  )
  VALUES (
    'battle_validate_admin',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'source', 'admin_validate_battle',
      'status_before', v_battle.status,
      'status_after', 'active',
      'voting_ends_at_before', v_battle.voting_ends_at,
      'voting_ends_at_after', CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE v_battle.voting_ends_at
      END,
      'duration_source', v_duration_source,
      'effective_days', v_effective_days,
      'actor', v_actor
    ),
    1.0,
    'Battle validated by admin',
    'executed',
    false,
    true,
    now(),
    v_actor,
    NULL
  );

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

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  )
  VALUES (
    'battle_cancel_admin',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'source', 'admin_cancel_battle',
      'status_before', v_battle.status,
      'status_after', 'cancelled',
      'actor', v_actor
    ),
    1.0,
    'Battle cancelled by admin',
    'executed',
    false,
    true,
    now(),
    v_actor,
    NULL
  );

  RETURN true;
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
  v_is_admin_actor boolean := public.is_admin(v_actor);
  v_battle public.battles%ROWTYPE;
  v_winner_id uuid;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR v_is_admin_actor
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
    IF v_is_admin_actor THEN
      INSERT INTO public.ai_admin_actions (
        action_type,
        entity_type,
        entity_id,
        ai_decision,
        confidence_score,
        reason,
        status,
        human_override,
        reversible,
        executed_at,
        executed_by,
        error
      )
      VALUES (
        'battle_finalize_admin',
        'battle',
        p_battle_id,
        jsonb_build_object(
          'source', 'finalize_battle',
          'noop', true,
          'already_completed', true,
          'winner_id', v_battle.winner_id,
          'actor', v_actor
        ),
        1.0,
        'Battle already completed (admin finalize noop)',
        'executed',
        false,
        true,
        now(),
        v_actor,
        NULL
      );
    END IF;

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

  IF v_is_admin_actor THEN
    INSERT INTO public.ai_admin_actions (
      action_type,
      entity_type,
      entity_id,
      ai_decision,
      confidence_score,
      reason,
      status,
      human_override,
      reversible,
      executed_at,
      executed_by,
      error
    )
    VALUES (
      'battle_finalize_admin',
      'battle',
      p_battle_id,
      jsonb_build_object(
        'source', 'finalize_battle',
        'noop', false,
        'status_before', v_battle.status,
        'status_after', 'completed',
        'winner_id', v_winner_id,
        'votes_producer1', v_battle.votes_producer1,
        'votes_producer2', v_battle.votes_producer2,
        'actor', v_actor
      ),
      1.0,
      'Battle finalized by admin',
      'executed',
      false,
      true,
      now(),
      v_actor,
      NULL
    );
  END IF;

  RETURN v_winner_id;
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

REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_battles_expiry_active_voting
ON public.battles (voting_ends_at)
WHERE status IN ('active', 'voting');

COMMIT;
