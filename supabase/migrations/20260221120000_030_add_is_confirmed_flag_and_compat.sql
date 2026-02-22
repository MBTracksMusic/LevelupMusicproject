/*
  # IAM transition step 1: add is_confirmed flag + compatibility guardrails

  Goals:
  - Add a non-destructive `user_profiles.is_confirmed` flag.
  - Backfill from legacy role/confirmation state.
  - Keep client updates from mutating the new sensitive flag.
  - Provide a compatibility helper function for old+new model checks.
*/

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false;

UPDATE public.user_profiles
SET is_confirmed = (
  role IN ('confirmed_user', 'producer', 'admin')
  OR confirmed_at IS NOT NULL
)
WHERE is_confirmed IS DISTINCT FROM (
  role IN ('confirmed_user', 'producer', 'admin')
  OR confirmed_at IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_is_confirmed
  ON public.user_profiles (is_confirmed)
  WHERE is_confirmed = true;

CREATE OR REPLACE FUNCTION public.is_confirmed_user(p_user_id uuid DEFAULT auth.uid())
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
      AND (
        up.is_confirmed = true
        OR up.role IN ('confirmed_user', 'producer', 'admin')
      )
  );
END;
$$;

DROP POLICY IF EXISTS "Users can update own profile limited fields" ON public.user_profiles;

CREATE POLICY "Users can update own profile limited fields"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid()) AND
    is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid()) AND
    is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid()) AND
    stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid()) AND
    stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid()) AND
    subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid()) AND
    total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid()) AND
    confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid()) AND
    producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid())
  );

COMMIT;
