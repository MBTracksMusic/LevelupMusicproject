/*
  # Grant admin role to specific user (email: ludovic.ousselin@gmail.com)

  Chosen approach (Option B): leverage existing user_profiles.role enum (user_role) already used across the app.
  - Set role = 'admin' for the target user.
  - Add helper function public.is_admin(p_user_id) (SECURITY INVOKER, safe search_path).
  - Add RLS policy to let admins read all profiles without loosening other permissions.
  - Idempotent guards: only runs if user_profiles exists and user is found.
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

DO $$
DECLARE
  target_email text := 'ludovic.ousselin@gmail.com';
  u_id uuid;
  table_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) INTO table_exists;

  IF NOT table_exists THEN
    RAISE NOTICE 'Table public.user_profiles not found; skipping admin assignment.';
    RETURN;
  END IF;

  SELECT id INTO u_id
  FROM auth.users
  WHERE lower(email) = lower(target_email)
  LIMIT 1;

  IF u_id IS NULL THEN
    RAISE NOTICE 'No auth.users row found for %; skipping admin assignment.', target_email;
    RETURN;
  END IF;

  UPDATE public.user_profiles
  SET role = 'admin',
      updated_at = now()
  WHERE id = u_id;

  IF NOT FOUND THEN
    -- If profile row missing, create it minimally (rare case)
    INSERT INTO public.user_profiles (id, email, role, created_at, updated_at)
    VALUES (u_id, target_email, 'admin', now(), now())
    ON CONFLICT (id) DO UPDATE
      SET role = EXCLUDED.role,
          email = EXCLUDED.email,
          updated_at = now();
  END IF;
END
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
