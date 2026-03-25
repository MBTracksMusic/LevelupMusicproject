/*
  # Fix is_admin() security - change SECURITY INVOKER to SECURITY DEFINER

  CRITICAL BUG: is_admin() was using SECURITY INVOKER, which means it ran
  with the authenticated user's privileges instead of postgres/admin privileges.
  This caused RLS checks on user_profiles to fail when the user tried to query
  their own role, breaking the maintenance mode toggle and other admin operations.

  Fix: Change to SECURITY DEFINER so function owner (postgres) can always read user_profiles.

  Impact:
  - Maintenance mode toggle will now work
  - Admin operations relying on is_admin() will work
  - Settings update RLS policy will properly validate admin status
*/

BEGIN;

-- Update is_admin() function with SECURITY DEFINER
-- Note: Cannot DROP FUNCTION because it has RLS policy dependencies
-- Instead, use CREATE OR REPLACE to modify it in-place
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND up.role = 'admin'::public.user_role
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  );
END;
$$;

COMMENT ON FUNCTION public.is_admin(uuid) IS 'Check if user is admin. Uses SECURITY DEFINER to bypass user RLS policies.';

COMMIT;
