/*
  # Fix battles INSERT RLS — opponent lookup bypasses user_profiles RLS

  Problem:
  - The battles INSERT policy contains a direct subquery on `user_profiles`
    to check that `producer2_id` is an active producer.
  - `user_profiles` SELECT RLS only allows a user to read their **own** row.
  - When producer1 tries to create a battle, the EXISTS subquery for producer2
    returns nothing (RLS blocks cross-user reads), EXISTS = false → INSERT blocked
    with [42501].

  Fix:
  - Add a `SECURITY DEFINER` function `is_active_battle_opponent(uuid)` that
    reads `user_profiles` as the function owner (bypasses RLS).
  - Replace the direct `user_profiles up2` subquery in the INSERT policy with
    a call to this function.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_battle_opponent(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_user_id
      AND up.role = ANY (ARRAY['producer'::user_role, 'admin'::user_role])
      AND up.is_producer_active = true
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_battle_opponent(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_battle_opponent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_battle_opponent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_battle_opponent(uuid) TO service_role;

DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;

CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND producer1_id = auth.uid()
    AND producer2_id IS NOT NULL
    AND producer1_id != producer2_id
    AND status = 'pending_acceptance'
    AND battle_type = 'user'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
    AND public.can_create_battle(auth.uid()) = true
    AND public.can_create_active_battle(auth.uid()) = true
    AND public.assert_battle_skill_gap(auth.uid(), producer2_id, 400) = true
    AND public.is_active_battle_opponent(producer2_id) = true
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

COMMIT;
