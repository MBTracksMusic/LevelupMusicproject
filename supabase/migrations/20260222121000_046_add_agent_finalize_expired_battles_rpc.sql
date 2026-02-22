/*
  # Agent wrapper for battle finalization (rule-based)

  - Calls finalize_expired_battles on expired active/voting battles.
  - Logs every attempt in ai_admin_actions.
  - Designed for service-role orchestration (executed_by remains NULL).
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.agent_finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_candidate_id uuid;
  v_status public.battle_status;
  v_winner_id uuid;
  v_finalize_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  FOR v_row IN
    SELECT b.id, b.status, b.voting_ends_at
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    v_candidate_ids := array_append(v_candidate_ids, v_row.id);
  END LOOP;

  BEGIN
    v_finalize_count := public.finalize_expired_battles(v_limit);
  EXCEPTION
    WHEN OTHERS THEN
      FOREACH v_candidate_id IN ARRAY v_candidate_ids
      LOOP
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
        ) VALUES (
          'battle_finalize',
          'battle',
          v_candidate_id,
          jsonb_build_object(
            'model', 'rule-based',
            'source', 'agent_finalize_expired_battles',
            'battle_id', v_candidate_id
          ),
          1,
          'Battle finalization failed in finalize_expired_battles wrapper.',
          'failed',
          false,
          true,
          now(),
          NULL,
          SQLERRM
        );
      END LOOP;
      RAISE;
  END;

  FOREACH v_candidate_id IN ARRAY v_candidate_ids
  LOOP
    SELECT b.status, b.winner_id
    INTO v_status, v_winner_id
    FROM public.battles b
    WHERE b.id = v_candidate_id;

    IF v_status = 'completed' THEN
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
      ) VALUES (
        'battle_finalize',
        'battle',
        v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'winner_id', v_winner_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle auto-finalized by finalize_expired_battles().',
        'executed',
        false,
        true,
        now(),
        NULL,
        NULL
      );
      v_count := v_count + 1;
    ELSE
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
      ) VALUES (
        'battle_finalize',
        'battle',
        v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle not finalized by finalize_expired_battles().',
        'failed',
        false,
        true,
        now(),
        NULL,
        'battle_not_completed_after_finalize_call'
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) TO service_role;

COMMIT;
