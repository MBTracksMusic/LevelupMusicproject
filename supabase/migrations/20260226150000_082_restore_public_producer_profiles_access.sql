/*
  # Restore anon/auth access to public_producer_profiles without reopening user_profiles

  Keeps:
  - user_profiles private (owner-only/service role)
  - public_producer_profiles as SECURITY INVOKER view

  Strategy:
  - expose active producers through a SECURITY DEFINER function with explicit column allowlist
  - rebuild the view from that function
*/

BEGIN;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.user_profiles FROM anon;

CREATE OR REPLACE FUNCTION public.get_public_producer_profiles()
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

REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO service_role;

DROP VIEW IF EXISTS public.public_producer_profiles;

CREATE VIEW public.public_producer_profiles
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_public_producer_profiles();

REVOKE ALL ON TABLE public.public_producer_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.public_producer_profiles FROM anon;
REVOKE ALL ON TABLE public.public_producer_profiles FROM authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO service_role;

COMMIT;
