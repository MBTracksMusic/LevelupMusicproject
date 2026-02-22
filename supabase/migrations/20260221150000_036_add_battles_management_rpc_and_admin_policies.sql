/*
  # Battles management RPCs + admin policies

  Goals:
  - Add safe producer RPCs to publish and start voting.
  - Add admin read/update access on battles.
  - Harden battle creation policy defaults.
  - Restrict/validate finalize_battle execution for admin/service-role only.

  Backward-compatible: additive policy/function changes.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Harden producer create policy defaults (pending + zeroed result fields)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;

CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    producer1_id = auth.uid()
    AND status = 'pending'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND (
      producer2_id IS NULL
      OR producer2_id != auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
    )
    AND (
      producer2_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.user_profiles up2
        WHERE up2.id = producer2_id
          AND up2.is_producer_active = true
      )
    )
    AND (
      product1_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p1
        WHERE p1.id = product1_id
          AND p1.producer_id = auth.uid()
          AND p1.deleted_at IS NULL
      )
    )
    AND (
      product2_id IS NULL
      OR (
        producer2_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.products p2
          WHERE p2.id = product2_id
            AND p2.producer_id = producer2_id
            AND p2.deleted_at IS NULL
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Admin policies on battles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battles'
      AND policyname = 'Admins can view all battles'
  ) THEN
    CREATE POLICY "Admins can view all battles"
      ON public.battles
      FOR SELECT
      TO authenticated
      USING (public.is_admin(auth.uid()));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battles'
      AND policyname = 'Admins can update all battles'
  ) THEN
    CREATE POLICY "Admins can update all battles"
      ON public.battles
      FOR UPDATE
      TO authenticated
      USING (public.is_admin(auth.uid()))
      WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Producer management RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.producer_publish_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.producer1_id != v_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_battle.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  IF v_battle.producer2_id IS NULL
     OR v_battle.product1_id IS NULL
     OR v_battle.product2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready';
  END IF;

  UPDATE public.battles
  SET status = 'active',
      starts_at = COALESCE(starts_at, now()),
      updated_at = now()
  WHERE id = p_battle_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.producer_start_battle_voting(
  p_battle_id uuid,
  p_voting_duration_hours integer DEFAULT 72
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_hours integer := GREATEST(1, LEAST(COALESCE(p_voting_duration_hours, 72), 720));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.producer1_id != v_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_battle.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  IF v_battle.producer2_id IS NULL
     OR v_battle.product1_id IS NULL
     OR v_battle.product2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready';
  END IF;

  UPDATE public.battles
  SET status = 'voting',
      starts_at = COALESCE(starts_at, now()),
      voting_ends_at = COALESCE(voting_ends_at, now() + make_interval(hours => v_hours)),
      updated_at = now()
  WHERE id = p_battle_id;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Finalization RPC hardened for admin/service-role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_battle(p_battle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_battle public.battles%ROWTYPE;
  v_winner_id uuid;
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

  IF v_battle.status = 'cancelled' THEN
    RAISE EXCEPTION 'battle_cancelled';
  END IF;

  IF v_battle.status = 'completed' THEN
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

  RETURN v_winner_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) EXECUTE grants
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.producer_publish_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.producer_publish_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.producer_publish_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.producer_publish_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.producer_publish_battle(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.producer_start_battle_voting(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO service_role;

COMMIT;
