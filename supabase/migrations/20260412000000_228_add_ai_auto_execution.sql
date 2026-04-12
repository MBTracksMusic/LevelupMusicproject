/*
  # AI Auto-Execution pipeline

  Adds:
  - app_settings seed: 'ai_auto_execution' with default config (disabled)
  - admin_validate_battle / admin_cancel_battle: accept service_role (same pattern as finalize_battle)
  - agent_auto_execute_ai_battle_actions(p_limit): picks proposed AI actions above
    confidence threshold and executes them automatically when enabled in app_settings.

  The RPC is designed to be called by the agent-auto-execute-ai-actions Edge Function
  via service_role key on a scheduled basis.
*/

BEGIN;

-- ── 1. Seed app_settings ────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value)
VALUES (
  'ai_auto_execution',
  '{"enabled": false, "confidence_threshold": 0.85, "auto_validate": true, "auto_cancel": false}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Patch admin_validate_battle to also accept service_role ───────────────
--    Adds: v_jwt_role check (same pattern as finalize_battle)

CREATE OR REPLACE FUNCTION public.admin_validate_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor       uuid   := auth.uid();
  v_jwt_role    text   := current_setting('request.jwt.claim.role', true);
  v_battle      public.battles%ROWTYPE;
  v_new_voting_ends_at timestamptz;
  v_effective_days     integer;
  v_duration_source    text := 'already_defined';
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
  SET status           = 'active',
      admin_validated_at = now(),
      starts_at        = COALESCE(starts_at, now()),
      voting_ends_at   = CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE voting_ends_at
      END,
      updated_at       = now()
  WHERE id = p_battle_id;

  INSERT INTO public.ai_admin_actions (
    action_type, entity_type, entity_id,
    ai_decision, confidence_score, reason,
    status, human_override, reversible,
    executed_at, executed_by, error
  ) VALUES (
    'battle_validate_admin', 'battle', p_battle_id,
    jsonb_build_object(
      'source',                  'admin_validate_battle',
      'status_before',           v_battle.status,
      'status_after',            'active',
      'voting_ends_at_before',   v_battle.voting_ends_at,
      'voting_ends_at_after',    CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE v_battle.voting_ends_at
      END,
      'duration_source',         v_duration_source,
      'effective_days',          v_effective_days,
      'actor',                   v_actor,
      'via_service_role',        (v_jwt_role = 'service_role')
    ),
    1.0,
    'Battle validated by admin',
    'executed', false, true,
    now(), v_actor, NULL
  );

  IF v_battle.voting_ends_at IS NULL THEN
    INSERT INTO public.ai_admin_actions (
      action_type, entity_type, entity_id,
      ai_decision, confidence_score, reason,
      status, executed_at
    ) VALUES (
      'battle_duration_set', 'battle', p_battle_id,
      jsonb_build_object(
        'effective_days',   v_effective_days,
        'custom_duration',  v_battle.custom_duration_days,
        'source', CASE
          WHEN v_battle.custom_duration_days IS NOT NULL THEN 'custom'
          ELSE 'app_settings'
        END
      ),
      1.0,
      'Battle duration determined during admin validation',
      'executed', now()
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

-- ── 3. Patch admin_cancel_battle to also accept service_role ─────────────────

CREATE OR REPLACE FUNCTION public.admin_cancel_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_battle   public.battles%ROWTYPE;
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

  IF v_battle.status = 'completed' THEN
    RAISE EXCEPTION 'cannot_cancel_completed_battle';
  END IF;

  UPDATE public.battles
  SET status     = 'cancelled',
      winner_id  = NULL,
      updated_at = now()
  WHERE id = p_battle_id;

  INSERT INTO public.ai_admin_actions (
    action_type, entity_type, entity_id,
    ai_decision, confidence_score, reason,
    status, human_override, reversible,
    executed_at, executed_by, error
  ) VALUES (
    'battle_cancel_admin', 'battle', p_battle_id,
    jsonb_build_object(
      'source',          'admin_cancel_battle',
      'status_before',   v_battle.status,
      'status_after',    'cancelled',
      'actor',           v_actor,
      'via_service_role', (v_jwt_role = 'service_role')
    ),
    1.0,
    'Battle cancelled by admin',
    'executed', false, true,
    now(), v_actor, NULL
  );

  RETURN true;
END;
$$;

-- ── 4. New RPC: agent_auto_execute_ai_battle_actions ─────────────────────────
--    Called by the Edge Function cron. Reads app_settings for config,
--    picks proposed actions above threshold, executes them, logs feedback.

CREATE OR REPLACE FUNCTION public.agent_auto_execute_ai_battle_actions(
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid   := auth.uid();
  v_jwt_role     text   := current_setting('request.jwt.claim.role', true);
  v_settings     jsonb;
  v_enabled      boolean;
  v_threshold    numeric;
  v_auto_validate boolean;
  v_auto_cancel   boolean;
  v_limit         integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
  v_row           record;
  v_rpc_error     text;
  v_executed      integer := 0;
  v_failed        integer := 0;
  v_skipped       integer := 0;
BEGIN
  -- Auth: service_role or admin
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- Read settings
  SELECT value INTO v_settings
  FROM public.app_settings
  WHERE key = 'ai_auto_execution';

  IF v_settings IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'settings_not_found',
      'executed', 0, 'failed', 0, 'skipped', 0
    );
  END IF;

  v_enabled       := COALESCE((v_settings ->> 'enabled')::boolean,            false);
  v_threshold     := COALESCE((v_settings ->> 'confidence_threshold')::numeric, 0.85);
  v_auto_validate := COALESCE((v_settings ->> 'auto_validate')::boolean,       true);
  v_auto_cancel   := COALESCE((v_settings ->> 'auto_cancel')::boolean,         false);

  IF NOT v_enabled THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reason', 'auto_execution_disabled',
      'executed', 0, 'failed', 0, 'skipped', 0
    );
  END IF;

  -- Process proposed actions
  FOR v_row IN
    SELECT a.id, a.action_type, a.entity_id, a.confidence_score, a.ai_decision
    FROM public.ai_admin_actions a
    WHERE a.status      = 'proposed'
      AND a.entity_type = 'battle'
      AND a.action_type IN ('battle_validate', 'battle_cancel')
      AND a.confidence_score IS NOT NULL
      AND a.confidence_score >= v_threshold
    ORDER BY a.confidence_score DESC, a.created_at ASC
    LIMIT v_limit
  LOOP
    -- Per-type toggle check
    IF v_row.action_type = 'battle_validate' AND NOT v_auto_validate THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_row.action_type = 'battle_cancel' AND NOT v_auto_cancel THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Execute (admin_validate_battle / admin_cancel_battle now accept service_role)
    v_rpc_error := NULL;
    BEGIN
      IF v_row.action_type = 'battle_validate' THEN
        PERFORM public.admin_validate_battle(v_row.entity_id);
      ELSIF v_row.action_type = 'battle_cancel' THEN
        PERFORM public.admin_cancel_battle(v_row.entity_id);
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_rpc_error := SQLERRM;
    END;

    IF v_rpc_error IS NOT NULL THEN
      UPDATE public.ai_admin_actions
      SET status      = 'failed',
          error       = v_rpc_error,
          executed_at = now(),
          executed_by = NULL
      WHERE id = v_row.id;

      INSERT INTO public.ai_training_feedback (
        action_id, ai_prediction, human_decision, delta, created_by
      ) VALUES (
        v_row.id,
        v_row.ai_decision,
        jsonb_build_object(
          'decision',    'auto_execute_failed',
          'action_type', v_row.action_type,
          'entity_id',   v_row.entity_id,
          'error',       v_rpc_error
        ),
        1,
        NULL
      );

      v_failed := v_failed + 1;
    ELSE
      UPDATE public.ai_admin_actions
      SET status        = 'executed',
          human_override = false,
          error         = NULL,
          executed_at   = now(),
          executed_by   = NULL
      WHERE id = v_row.id;

      INSERT INTO public.ai_training_feedback (
        action_id, ai_prediction, human_decision, delta, created_by
      ) VALUES (
        v_row.id,
        v_row.ai_decision,
        jsonb_build_object(
          'decision',    'auto_execute',
          'action_type', v_row.action_type,
          'entity_id',   v_row.entity_id
        ),
        0,
        NULL
      );

      v_executed := v_executed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                true,
    'executed',          v_executed,
    'failed',            v_failed,
    'skipped',           v_skipped,
    'threshold',         v_threshold,
    'auto_validate',     v_auto_validate,
    'auto_cancel',       v_auto_cancel
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_auto_execute_ai_battle_actions(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agent_auto_execute_ai_battle_actions(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.agent_auto_execute_ai_battle_actions(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_auto_execute_ai_battle_actions(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_auto_execute_ai_battle_actions(integer) TO service_role;

COMMIT;
