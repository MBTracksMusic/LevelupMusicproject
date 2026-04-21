/*
  # Reassert public catalog anon access

  ## Why
  The live anon query path still fails on `public_catalog_products` /
  `public_producer_profiles` with:

    permission denied for table user_profiles

  That only happens when `public_producer_profiles` drifts back to a direct
  view on `user_profiles`, or when `public_catalog_products` no longer runs
  with definer privileges. Both situations have already happened before via
  remote_schema/pg_dump style migrations.

  ## Minimal fix
  - Restore `public.public_producer_profiles` to the safe wrapper built on the
    SECURITY DEFINER function `public.get_public_producer_profiles_soft()`
  - Reassert anon/authenticated SELECT grants on the public profile view
  - Reassert SECURITY DEFINER behavior on catalog views that must stay public
*/

BEGIN;

CREATE OR REPLACE VIEW public.public_producer_profiles
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_public_producer_profiles_soft();

REVOKE ALL ON TABLE public.public_producer_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.public_producer_profiles FROM anon;
REVOKE ALL ON TABLE public.public_producer_profiles FROM authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO service_role;

ALTER VIEW public.producer_beats_ranked SET (security_invoker = false);
ALTER VIEW public.public_catalog_products SET (security_invoker = false);

COMMIT;
