/*
  # Secure public profile exposure with a minimal public view

  - Adds `public.public_producer_profiles` for public producer rendering.
  - Adds `public.my_user_profile` for owner-only full profile reads.
  - Restricts direct SELECT on sensitive columns from `user_profiles`.
  - Keeps anon compatibility for legacy public joins while removing authenticated global reads.
*/

BEGIN;

CREATE OR REPLACE VIEW public.public_producer_profiles AS
SELECT
  up.id AS user_id,
  up.username,
  COALESCE(NULLIF(up.full_name, ''), up.username) AS display_name,
  up.avatar_url,
  up.producer_tier,
  up.bio,
  up.website_url,
  up.social_links,
  up.created_at,
  up.updated_at
FROM public.user_profiles up
WHERE up.is_producer_active = true;

GRANT SELECT ON TABLE public.public_producer_profiles TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO service_role;

CREATE OR REPLACE VIEW public.my_user_profile AS
SELECT up.*
FROM public.user_profiles up
WHERE up.id = auth.uid();

GRANT SELECT ON TABLE public.my_user_profile TO authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO service_role;

DROP POLICY IF EXISTS "Anyone can view producer profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Public can view producer public profile" ON public.user_profiles;

CREATE POLICY "Public can view producer public profile"
  ON public.user_profiles
  FOR SELECT
  TO anon
  USING (is_producer_active = true);

REVOKE SELECT ON TABLE public.user_profiles FROM anon;
REVOKE SELECT ON TABLE public.user_profiles FROM authenticated;

GRANT SELECT ON TABLE public.user_profiles TO authenticated;

GRANT SELECT (
  id,
  username,
  full_name,
  avatar_url,
  role,
  is_producer_active,
  producer_tier,
  total_purchases,
  confirmed_at,
  producer_verified_at,
  battle_refusal_count,
  battles_participated,
  battles_completed,
  engagement_score,
  language,
  bio,
  website_url,
  social_links,
  created_at,
  updated_at
) ON TABLE public.user_profiles TO anon;

COMMIT;
