/*
  # Battle quota and active cap hardening

  Phase 3 integrity fix:
  - Active cap now counts both producer roles and includes awaiting_admin.
  - Monthly battle quota now counts both producer roles.
  - Admin validation re-checks products and participant active cap before
    transitioning awaiting_admin -> active.

  Occupied statuses are intentionally aligned with Phase 1 product locks:
  pending_acceptance, awaiting_admin, active, voting.
*/

BEGIN;

CREATE INDEX IF NOT EXISTS idx_battles_producer1_occupied_limit
  ON public.battles (producer1_id, status)
  WHERE status IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting');

CREATE INDEX IF NOT EXISTS idx_battles_producer2_occupied_limit
  ON public.battles (producer2_id, status)
  WHERE producer2_id IS NOT NULL
    AND status IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting');

CREATE INDEX IF NOT EXISTS idx_battles_producer1_monthly_quota
  ON public.battles (producer1_id, created_at);

CREATE INDEX IF NOT EXISTS idx_battles_producer2_monthly_quota
  ON public.battles (producer2_id, created_at)
  WHERE producer2_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.count_user_occupied_battles(
  p_user_id uuid,
  p_exclude_battle_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)
  FROM public.battles b
  WHERE p_user_id IS NOT NULL
    AND b.status IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting')
    AND (b.producer1_id = p_user_id OR b.producer2_id = p_user_id)
    AND (p_exclude_battle_id IS NULL OR b.id <> p_exclude_battle_id);
$$;

REVOKE EXECUTE ON FUNCTION public.count_user_occupied_battles(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_user_occupied_battles(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_user_occupied_battles(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.count_user_occupied_battles(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_create_active_battle(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_count bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  v_count := public.count_user_occupied_battles(p_user_id, NULL);

  RETURN v_count < 3;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_create_active_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_create_active_battle(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_create_active_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_active_battle(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_user_battle_quota(p_user_id uuid)
RETURNS TABLE (
  tier text,
  used_this_month bigint,
  battle_limit integer,
  remaining_this_month integer,
  can_create boolean,
  reason text,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_tier_text text := 'user';
  v_used bigint := 0;
  v_limit integer := 0;
  v_remaining integer := 0;
  v_can_create boolean := false;
  v_reason text := 'plan_insufficient';
  v_month_start timestamptz := date_trunc('month', now());
  v_next_month_start timestamptz := date_trunc('month', now()) + interval '1 month';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(up.producer_tier::text, 'user')
  INTO v_tier_text
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_used
  FROM public.battles b
  WHERE (b.producer1_id = p_user_id OR b.producer2_id = p_user_id)
    AND b.created_at >= v_month_start
    AND b.created_at < v_next_month_start;

  SELECT COALESCE(pp.battle_limit, pp.max_battles_created_per_month, 0)
  INTO v_limit
  FROM public.producer_plans pp
  WHERE pp.tier::text = v_tier_text
    AND pp.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    v_limit := 0;
  END IF;

  IF v_limit = -1 THEN
    v_remaining := -1;
    v_can_create := true;
    v_reason := 'eligible';
  ELSIF v_limit <= 0 THEN
    v_remaining := 0;
    v_can_create := false;
    v_reason := 'plan_insufficient';
  ELSIF v_used >= v_limit THEN
    v_remaining := 0;
    v_can_create := false;
    v_reason := 'quota_reached';
  ELSE
    v_remaining := GREATEST(v_limit - v_used, 0)::integer;
    v_can_create := true;
    v_reason := 'eligible';
  END IF;

  RETURN QUERY
  SELECT
    v_tier_text,
    v_used,
    v_limit,
    v_remaining,
    v_can_create,
    v_reason,
    v_next_month_start;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_battle_quota(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_battle_quota(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_battle_quota(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_battle_quota(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_create_battle(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_can_create boolean := false;
BEGIN
  SELECT quota.can_create
  INTO v_can_create
  FROM public.get_user_battle_quota(p_user_id) AS quota
  LIMIT 1;

  RETURN COALESCE(v_can_create, false);
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_create_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_create_battle(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_create_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_battle(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_validate_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor       uuid   := auth.uid();
  v_jwt_role    text   := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_battle      public.battles%ROWTYPE;
  v_new_voting_ends_at timestamptz;
  v_effective_days     integer;
  v_duration_source    text := 'already_defined';
  v_producer1_other_occupied bigint := 0;
  v_producer2_other_occupied bigint := 0;
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

  PERFORM public.assert_battle_create_validations(
    v_battle.producer1_id,
    v_battle.producer2_id,
    v_battle.product1_id,
    v_battle.product2_id,
    true,
    400
  );

  v_producer1_other_occupied := public.count_user_occupied_battles(v_battle.producer1_id, p_battle_id);
  v_producer2_other_occupied := public.count_user_occupied_battles(v_battle.producer2_id, p_battle_id);

  IF v_producer1_other_occupied >= 3 THEN
    RAISE EXCEPTION 'BATTLE_ACTIVE_CAP_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'producer_id', v_battle.producer1_id,
              'role', 'producer1',
              'other_occupied_battles', v_producer1_other_occupied,
              'max_active_battles', 3
            )::text;
  END IF;

  IF v_producer2_other_occupied >= 3 THEN
    RAISE EXCEPTION 'BATTLE_ACTIVE_CAP_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'producer_id', v_battle.producer2_id,
              'role', 'producer2',
              'other_occupied_battles', v_producer2_other_occupied,
              'max_active_battles', 3
            )::text;
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

COMMIT;
