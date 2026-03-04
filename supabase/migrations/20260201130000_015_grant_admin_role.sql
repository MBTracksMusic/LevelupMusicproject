/*
  # Add admin role helper + admin profile read policy (schema-only)

  Security note:
  - This migration intentionally does NOT assign admin role to any user.
  - Admin assignment must be handled manually outside migrations.
*/

BEGIN;

-- Helper: safe check for admin role (invoker honors RLS; uses fixed search_path)
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
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
      AND up.role = 'admin'
  );
END;
$$;

-- Add a read policy for admins to view all profiles (without changing existing restrictions for others)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_profiles'
      AND policyname = 'Admins can view all profiles'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Admins can view all profiles"
        ON public.user_profiles
        FOR SELECT
        TO authenticated
        USING (public.is_admin(auth.uid()));
    $policy$;
  END IF;
END
$$;

COMMIT;
