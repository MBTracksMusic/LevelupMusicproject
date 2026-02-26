/*
  # Fix security definer warnings on profile views

  - Recreates `public.my_user_profile` and `public.public_producer_profiles`
    with `security_invoker = true` (Postgres 15+).
  - Keeps only non-sensitive columns in both views.
  - Keeps RLS on `public.user_profiles` as source of truth.
*/

BEGIN;

DROP VIEW IF EXISTS public.my_user_profile;
DROP VIEW IF EXISTS public.public_producer_profiles;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view producer public profile" ON public.user_profiles;
CREATE POLICY "Public can view producer public profile"
  ON public.user_profiles
  FOR SELECT
  TO anon
  USING (is_producer_active = true);

REVOKE SELECT ON TABLE public.user_profiles FROM anon;
GRANT SELECT (
  id,
  username,
  full_name,
  avatar_url,
  producer_tier,
  is_producer_active,
  bio,
  website_url,
  social_links,
  created_at,
  updated_at
) ON TABLE public.user_profiles TO anon;

CREATE VIEW public.my_user_profile
WITH (security_invoker = true)
AS
SELECT
  up.id,
  up.id AS user_id,
  up.username,
  up.full_name,
  up.avatar_url,
  up.role,
  up.producer_tier,
  up.is_producer_active,
  up.total_purchases,
  up.confirmed_at,
  up.producer_verified_at,
  up.battle_refusal_count,
  up.battles_participated,
  up.battles_completed,
  up.engagement_score,
  up.language,
  up.bio,
  up.website_url,
  up.social_links,
  up.created_at,
  up.updated_at
FROM public.user_profiles up
WHERE up.id = auth.uid();

CREATE VIEW public.public_producer_profiles
WITH (security_invoker = true)
AS
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
WHERE up.is_producer_active = true;

REVOKE ALL ON TABLE public.my_user_profile FROM PUBLIC;
REVOKE ALL ON TABLE public.my_user_profile FROM anon;
REVOKE ALL ON TABLE public.my_user_profile FROM authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO service_role;

REVOKE ALL ON TABLE public.public_producer_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.public_producer_profiles FROM anon;
REVOKE ALL ON TABLE public.public_producer_profiles FROM authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO service_role;

COMMIT;
