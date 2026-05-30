/*
  # Product monthly battle cap

  Phase 5 integrity fix:
  - Add configurable max_battles_per_product_per_month in app_settings.
  - Initial value is 3: permissive enough for cold-start reuse, but bounded.
  - Enforce the cap in rpc_create_battle and admin_validate_battle.

  Counting rule:
  - Count battles created in the current calendar month where the product appears
    as product1_id or product2_id.
  - Count all statuses. Phase 1 already prevents active overlap; this cap limits
    monthly cumulative reuse.
*/

BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES ('max_battles_per_product_per_month', '{"value": 3}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_battles_product1_monthly_cap
  ON public.battles (product1_id, created_at)
  WHERE product1_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_battles_product2_monthly_cap
  ON public.battles (product2_id, created_at)
  WHERE product2_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_max_battles_per_product_per_month()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings jsonb;
  v_limit integer;
BEGIN
  SELECT value
  INTO v_settings
  FROM public.app_settings
  WHERE key = 'max_battles_per_product_per_month'
  LIMIT 1;

  v_limit := COALESCE(
    (v_settings ->> 'value')::integer,
    (v_settings ->> 'max')::integer,
    3
  );

  IF v_limit IS NULL OR v_limit <= 0 THEN
    RETURN 3;
  END IF;

  RETURN LEAST(v_limit, 100);
EXCEPTION
  WHEN OTHERS THEN
    RETURN 3;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_max_battles_per_product_per_month() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_max_battles_per_product_per_month() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_max_battles_per_product_per_month() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_max_battles_per_product_per_month() TO service_role;

CREATE OR REPLACE FUNCTION public.count_product_battles_this_month(
  p_product_id uuid,
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
  WHERE p_product_id IS NOT NULL
    AND (b.product1_id = p_product_id OR b.product2_id = p_product_id)
    AND b.created_at >= date_trunc('month', now())
    AND b.created_at < date_trunc('month', now()) + interval '1 month'
    AND (p_exclude_battle_id IS NULL OR b.id <> p_exclude_battle_id);
$$;

REVOKE EXECUTE ON FUNCTION public.count_product_battles_this_month(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_product_battles_this_month(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_product_battles_this_month(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.count_product_battles_this_month(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_battle_product_monthly_caps(
  p_product1_id uuid DEFAULT NULL,
  p_product2_id uuid DEFAULT NULL,
  p_exclude_battle_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := public.get_max_battles_per_product_per_month();
  v_product1_count bigint := 0;
  v_product2_count bigint := 0;
BEGIN
  IF p_product1_id IS NOT NULL
     AND p_product2_id IS NOT NULL
     AND p_product1_id = p_product2_id THEN
    RAISE EXCEPTION 'BATTLE_PRODUCT_DUPLICATE_IN_BATTLE'
      USING ERRCODE = '23505',
            DETAIL = jsonb_build_object('product_id', p_product1_id)::text;
  END IF;

  IF p_product1_id IS NOT NULL THEN
    v_product1_count := public.count_product_battles_this_month(p_product1_id, p_exclude_battle_id);

    IF v_product1_count >= v_limit THEN
      RAISE EXCEPTION 'BATTLE_PRODUCT_MONTHLY_CAP_REACHED'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'product_id', p_product1_id,
                'slot', 'product1',
                'used_this_month', v_product1_count,
                'max_battles_per_product_per_month', v_limit
              )::text;
    END IF;
  END IF;

  IF p_product2_id IS NOT NULL THEN
    v_product2_count := public.count_product_battles_this_month(p_product2_id, p_exclude_battle_id);

    IF v_product2_count >= v_limit THEN
      RAISE EXCEPTION 'BATTLE_PRODUCT_MONTHLY_CAP_REACHED'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'product_id', p_product2_id,
                'slot', 'product2',
                'used_this_month', v_product2_count,
                'max_battles_per_product_per_month', v_limit
              )::text;
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_battle_product_monthly_caps(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_battle_product_monthly_caps(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_battle_product_monthly_caps(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_battle_product_monthly_caps(uuid, uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text);

CREATE FUNCTION public.rpc_create_battle(
  p_title         text,
  p_slug          text,
  p_producer2_id  uuid,
  p_description   text DEFAULT NULL,
  p_product1_id   uuid DEFAULT NULL,
  p_product2_id   uuid DEFAULT NULL,
  p_battle_type   text DEFAULT 'user'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_title          text := NULLIF(trim(COALESCE(p_title, '')), '');
  v_slug           text := NULLIF(trim(COALESCE(p_slug, '')), '');
  v_description    text := NULLIF(trim(COALESCE(p_description, '')), '');
  v_cooldown_days  integer;
  v_cooldown_end   timestamptz;
  v_new_battle_id  uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_battle_type IS NULL OR p_battle_type NOT IN ('user') THEN
    RAISE EXCEPTION 'unsupported_battle_type' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.assert_battle_create_validations(
    v_actor,
    p_producer2_id,
    p_product1_id,
    p_product2_id,
    false,
    400
  );

  PERFORM public.assert_battle_product_monthly_caps(
    p_product1_id,
    p_product2_id,
    NULL
  );

  v_cooldown_days := public.get_battle_pair_cooldown_days(p_battle_type);

  IF NOT public.can_create_battle(v_actor) THEN
    RAISE EXCEPTION 'BATTLE_QUOTA_REACHED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_create_active_battle(v_actor) THEN
    RAISE EXCEPTION 'BATTLE_ACTIVE_CAP_REACHED' USING ERRCODE = 'P0001';
  END IF;

  IF public.check_battle_pair_active(v_actor, p_producer2_id) THEN
    RAISE EXCEPTION 'BATTLE_PAIR_ALREADY_ACTIVE' USING ERRCODE = 'P0002';
  END IF;

  v_cooldown_end := public.get_battle_pair_cooldown_end(
    v_actor,
    p_producer2_id
  );

  IF v_cooldown_end IS NOT NULL THEN
    RAISE EXCEPTION 'BATTLE_PAIR_COOLDOWN'
      USING ERRCODE = 'P0003',
            DETAIL = jsonb_build_object(
              'cooldown_end_at', to_char(v_cooldown_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              'cooldown_days',   v_cooldown_days,
              'opponent_id',     p_producer2_id
            )::text;
  END IF;

  INSERT INTO public.battles (
    title,
    slug,
    description,
    producer1_id,
    producer2_id,
    product1_id,
    product2_id,
    status,
    winner_id,
    votes_producer1,
    votes_producer2
  )
  VALUES (
    v_title,
    v_slug,
    v_description,
    v_actor,
    p_producer2_id,
    p_product1_id,
    p_product2_id,
    'pending_acceptance',
    NULL,
    0,
    0
  )
  RETURNING id INTO v_new_battle_id;

  RETURN v_new_battle_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text) TO service_role;

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

  PERFORM public.assert_battle_product_monthly_caps(
    v_battle.product1_id,
    v_battle.product2_id,
    p_battle_id
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
