/*
  # Secure authenticated INSERT on public.user_profiles

  Goal:
  - Prevent privilege escalation via client-side INSERT when profile row is missing.
  - Keep signup flow intact through handle_new_user + auth/service policies.

  Changes:
  - Drop legacy authenticated INSERT policies that only checked id = auth.uid().
  - Create a strict authenticated INSERT policy that enforces safe defaults.
  - Do not alter SELECT/UPDATE policies.
  - Do not alter service role INSERT policy.
*/

BEGIN;

DROP POLICY IF EXISTS "Authenticated can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Owner can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Authenticated can insert own profile safely" ON public.user_profiles;

CREATE POLICY "Authenticated can insert own profile safely"
ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  id = auth.uid()
  AND role = 'user'::public.user_role
  AND is_producer_active = false
  AND is_confirmed = false
);

COMMIT;
