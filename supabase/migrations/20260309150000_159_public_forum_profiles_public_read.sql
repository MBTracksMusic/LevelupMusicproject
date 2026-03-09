/*
  # Public read-safe forum profile projection

  Goal:
  - expose only forum rendering fields to visitors (anon)
  - avoid exposing private account fields (email/role/subscription, etc.)
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.get_forum_public_profiles_public()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  rank text,
  reputation numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    up.id AS user_id,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    COALESCE(ur.rank_tier, 'bronze')::text AS rank,
    COALESCE(ur.reputation_score, 0) AS reputation
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_forum_public_profiles_public() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_forum_public_profiles_public() FROM anon;
REVOKE ALL ON FUNCTION public.get_forum_public_profiles_public() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles_public() TO anon;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles_public() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles_public() TO service_role;

CREATE OR REPLACE VIEW public.forum_public_profiles_public
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_forum_public_profiles_public();

REVOKE ALL ON TABLE public.forum_public_profiles_public FROM PUBLIC;
REVOKE ALL ON TABLE public.forum_public_profiles_public FROM anon;
REVOKE ALL ON TABLE public.forum_public_profiles_public FROM authenticated;
GRANT SELECT ON TABLE public.forum_public_profiles_public TO anon;
GRANT SELECT ON TABLE public.forum_public_profiles_public TO authenticated;
GRANT SELECT ON TABLE public.forum_public_profiles_public TO service_role;

COMMIT;
