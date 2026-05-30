/*
  # Server-side battle pair cooldown

  Phase 4 integrity fix:
  - Remove p_cooldown_days from the client-exposed rpc_create_battle signature.
  - Remove p_cooldown_days from the client-exposed cooldown lookup helper.
  - Read the cooldown duration from public.app_settings on the server side.

  Config row:
  - key: battle_pair_cooldown_days
  - value: {"user": 30}
*/

BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES ('battle_pair_cooldown_days', '{"user": 30}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_battle_pair_cooldown_days(
  p_battle_type text DEFAULT 'user'
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings jsonb;
  v_battle_type text := COALESCE(NULLIF(btrim(p_battle_type), ''), 'user');
  v_days integer;
BEGIN
  SELECT value
  INTO v_settings
  FROM public.app_settings
  WHERE key = 'battle_pair_cooldown_days'
  LIMIT 1;

  v_days := COALESCE(
    (v_settings ->> v_battle_type)::integer,
    (v_settings ->> 'days')::integer,
    30
  );

  IF v_days IS NULL OR v_days <= 0 THEN
    RETURN 30;
  END IF;

  RETURN LEAST(v_days, 365);
EXCEPTION
  WHEN OTHERS THEN
    RETURN 30;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_days(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_days(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_days(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_battle_pair_cooldown_days(text) TO service_role;

DROP FUNCTION IF EXISTS public.get_battle_pair_cooldown_end(uuid, uuid, int);
DROP FUNCTION IF EXISTS public.get_battle_pair_cooldown_end(uuid, uuid);

CREATE FUNCTION public.get_battle_pair_cooldown_end(
  p_producer_a uuid,
  p_producer_b uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor              uuid := auth.uid();
  v_jwt_role           text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_cooldown_days      integer := public.get_battle_pair_cooldown_days('user');
  v_last_terminated_at timestamptz;
  v_cooldown_end       timestamptz;
BEGIN
  IF p_producer_a IS NULL OR p_producer_b IS NULL OR p_producer_a = p_producer_b THEN
    RETURN NULL;
  END IF;

  IF v_cooldown_days IS NULL OR v_cooldown_days <= 0 THEN
    v_cooldown_days := 30;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND (v_actor = p_producer_a OR v_actor = p_producer_b))
  ) THEN
    RETURN NULL;
  END IF;

  SELECT MAX(COALESCE(b.voting_ends_at, b.updated_at))
  INTO v_last_terminated_at
  FROM public.battles b
  WHERE LEAST(b.producer1_id, b.producer2_id) = LEAST(p_producer_a, p_producer_b)
    AND GREATEST(b.producer1_id, b.producer2_id) = GREATEST(p_producer_a, p_producer_b)
    AND b.status IN ('completed', 'cancelled');

  IF v_last_terminated_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_cooldown_end := v_last_terminated_at + make_interval(days => v_cooldown_days);

  IF v_cooldown_end <= now() THEN
    RETURN NULL;
  END IF;

  RETURN v_cooldown_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, int);
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

COMMIT;
