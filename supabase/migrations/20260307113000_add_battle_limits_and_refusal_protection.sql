/*
  # Add battle limits and refusal counter protection

  Goals:
  - Enforce max 3 active battles per producer (pending_acceptance, active, voting).
  - Enforce max 5 battle refusals per 24h for invited producer responses.
  - Protect battle_refusal_count from direct owner-side updates on user_profiles.
  - Keep existing monthly creation quota and current RLS architecture.
*/

BEGIN;

CREATE INDEX IF NOT EXISTS idx_battles_producer1_active_limit
  ON public.battles (producer1_id, status)
  WHERE status IN ('pending_acceptance', 'active', 'voting');

CREATE INDEX IF NOT EXISTS idx_battles_producer2_rejected_window
  ON public.battles (producer2_id, rejected_at DESC)
  WHERE rejected_at IS NOT NULL;

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
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.battles b
  WHERE b.producer1_id = p_user_id
    AND b.status IN ('pending_acceptance', 'active', 'voting');

  RETURN v_count < 3;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_create_active_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_create_active_battle(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_create_active_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_active_battle(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.check_daily_battle_refusals(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_count bigint := 0;
  v_window_start timestamptz := now() - interval '24 hours';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.battles b
  WHERE b.producer2_id = p_user_id
    AND b.status = 'rejected'
    AND b.rejected_at IS NOT NULL
    AND b.rejected_at >= v_window_start;

  RETURN v_count < 5;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_daily_battle_refusals(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_daily_battle_refusals(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_daily_battle_refusals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_daily_battle_refusals(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.respond_to_battle(
  p_battle_id uuid,
  p_accept boolean,
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
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
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

  IF v_battle.producer2_id IS NULL OR v_battle.producer2_id != v_actor THEN
    RAISE EXCEPTION 'only_invited_producer_can_respond';
  END IF;

  IF v_battle.status != 'pending_acceptance' THEN
    RAISE EXCEPTION 'battle_not_waiting_for_response';
  END IF;

  IF v_battle.accepted_at IS NOT NULL OR v_battle.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'response_already_recorded';
  END IF;

  IF p_accept THEN
    UPDATE public.battles
    SET status = 'awaiting_admin',
        accepted_at = now(),
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_battle_id;
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'rejection_reason_required';
    END IF;

    IF NOT public.check_daily_battle_refusals(v_actor) THEN
      RAISE EXCEPTION 'Daily battle refusal limit reached (5 per day)';
    END IF;

    UPDATE public.battles
    SET status = 'rejected',
        rejected_at = now(),
        accepted_at = NULL,
        rejection_reason = v_reason,
        updated_at = now()
    WHERE id = p_battle_id;

    UPDATE public.user_profiles
    SET battle_refusal_count = COALESCE(battle_refusal_count, 0) + 1,
        updated_at = now()
    WHERE id = v_actor;

    PERFORM public.recalculate_engagement(v_actor);
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_battle(uuid, boolean, text) TO authenticated;

DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;

CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND producer1_id = auth.uid()
    AND producer2_id IS NOT NULL
    AND producer1_id != producer2_id
    AND status = 'pending_acceptance'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
    AND public.can_create_battle(auth.uid()) = true
    AND public.can_create_active_battle(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.public_producer_profiles pp2
      WHERE pp2.user_id = producer2_id
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
      OR EXISTS (
        SELECT 1
        FROM public.products p2
        WHERE p2.id = product2_id
          AND p2.producer_id = producer2_id
          AND p2.deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS "Owner can update own profile" ON public.user_profiles;

CREATE POLICY "Owner can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid())
  AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid())
  AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid())
  AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid())
  AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid())
  AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid())
  AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid())
  AND battle_refusal_count IS NOT DISTINCT FROM (SELECT battle_refusal_count FROM public.user_profiles WHERE id = auth.uid())
);

COMMIT;
