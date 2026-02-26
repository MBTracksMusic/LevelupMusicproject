/*
  # Public producer profiles V2 (strict additive allowlist contract)

  SECURITY NOTE:
  - This migration is additive and keeps legacy contract `/082` untouched.
  - `public.user_profiles` remains private (owner-only + service role via existing RLS/grants).
  - `public.get_public_producer_profiles_v2()` is SECURITY DEFINER and MUST only expose allowlisted public columns.
  - NE PAS AJOUTER DE COLONNES SENSIBLES (email, phone, stripe_*, subscription_status, internal roles, private metadata).
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_producer_profiles_v2()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  bio text,
  social_links jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    up.bio,
    up.social_links,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  WHERE up.is_producer_active = true
$$;

COMMENT ON FUNCTION public.get_public_producer_profiles_v2()
IS 'Public producer profiles V2 allowlist (SECURITY DEFINER). NE PAS AJOUTER DE COLONNES SENSIBLES.';

REVOKE ALL ON FUNCTION public.get_public_producer_profiles_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles_v2() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles_v2() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles_v2() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles_v2() TO service_role;

CREATE OR REPLACE VIEW public.public_producer_profiles_v2
WITH (security_invoker = true)
AS
SELECT
  v2.user_id,
  v2.username,
  v2.avatar_url,
  v2.producer_tier,
  v2.bio,
  v2.social_links,
  v2.created_at,
  v2.updated_at
FROM public.get_public_producer_profiles_v2() AS v2;

COMMENT ON VIEW public.public_producer_profiles_v2
IS 'Public producer profiles V2. Allowlist only. No sensitive columns.';

REVOKE ALL ON TABLE public.public_producer_profiles_v2 FROM PUBLIC;
REVOKE ALL ON TABLE public.public_producer_profiles_v2 FROM anon;
REVOKE ALL ON TABLE public.public_producer_profiles_v2 FROM authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles_v2 TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles_v2 TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles_v2 TO service_role;

COMMIT;
