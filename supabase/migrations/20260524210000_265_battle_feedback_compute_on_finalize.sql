-- Migration 265 — Phase 1 (Stats dashboard)
-- Patch private.finalize_battle to auto-compute battle_quality_snapshots
-- right after the battle transitions to status='completed'.
--
-- Design notes:
--   * private.finalize_battle is the single source of truth — public.finalize_battle
--     is a thin SQL wrapper (SELECT private.finalize_battle($1)).
--   * The snapshot compute is wrapped in BEGIN/EXCEPTION so that any failure
--     (missing votes, RLS edge case, transient error) NEVER blocks finalization.
--     Finalization is a critical path: reputation + engagement side-effects must
--     always commit, even if the stats dashboard misses a snapshot.
--   * Placed AFTER reputation/engagement recompute: snapshot is the last side
--     effect, so a partial failure leaves the battle fully finalized in all
--     other respects.
--   * Idempotent: CREATE OR REPLACE — re-running the migration is safe.
--   * Body is otherwise byte-for-byte identical to the previous definition
--     (captured from prod at 2026-05-24 21:00 UTC) to avoid behavior drift.

CREATE OR REPLACE FUNCTION private.finalize_battle(p_battle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF NOT public.check_rpc_rate_limit(v_actor, 'finalize_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role,
        'is_admin_actor', v_is_admin_actor
      ),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
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

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'status_before', v_battle.status,
        'status_after', v_battle.status,
        'jwt_role', v_jwt_role,
        'is_admin_actor', v_is_admin_actor,
        'noop', true
      ),
      p_extra_details => jsonb_build_object('winner_id', v_battle.winner_id),
      p_success => true,
      p_error => NULL
    );

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

  -- Phase 1 feedback dashboard: compute battle quality snapshots.
  -- Wrapped in BEGIN/EXCEPTION so snapshot failure cannot block finalization.
  BEGIN
    PERFORM public.rpc_compute_battle_quality_snapshot(p_battle_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'finalize_battle: rpc_compute_battle_quality_snapshot failed for battle_id=% (SQLSTATE=%, MSG=%)',
      p_battle_id, SQLSTATE, SQLERRM;
  END;

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

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'finalize_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'completed',
      'jwt_role', v_jwt_role,
      'is_admin_actor', v_is_admin_actor,
      'noop', false
    ),
    p_extra_details => jsonb_build_object(
      'winner_id', v_winner_id,
      'votes_producer1', v_battle.votes_producer1,
      'votes_producer2', v_battle.votes_producer2
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_winner_id;
END;
$function$;
