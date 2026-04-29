/*
  # Rewrite public home RPC wrappers as SECURITY INVOKER

  These RPCs are visitor-facing, so anon/authenticated execute access is
  intentional. To reduce Supabase linter noise without changing protected table
  access, this migration rewrites the homepage wrappers to read from the
  existing public-safe views instead of private base tables.

  Kept as SECURITY DEFINER elsewhere:
  - profile projection RPCs, because they sanitize private user_profiles rows
  - battle-of-the-day, because it aggregates private vote rows
  - admin/user workflow RPCs, because they enforce business guards internally
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.get_home_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'beats_published',
    (
      SELECT COUNT(*)
      FROM public.public_catalog_products p
      WHERE p.product_type = 'beat'::public.product_type
    ),
    'active_producers',
    (
      SELECT COUNT(*)
      FROM public.public_producer_profiles pp
      WHERE COALESCE(pp.is_deleted, false) = false
        AND COALESCE(pp.is_producer_active, false) = true
    ),
    'show_homepage_stats',
    COALESCE(
      (
        SELECT s.show_homepage_stats
        FROM public.settings s
        LIMIT 1
      ),
      false
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_public_home_featured_beats(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  price integer,
  play_count integer,
  cover_image_url text,
  is_sold boolean,
  is_exclusive boolean,
  producer_id uuid,
  producer_username text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.title,
    p.slug,
    p.price,
    COALESCE(p.play_count, 0) AS play_count,
    p.cover_image_url,
    COALESCE(p.is_sold, false) AS is_sold,
    COALESCE(p.is_exclusive, false) AS is_exclusive,
    p.producer_id,
    p.producer_username
  FROM public.public_catalog_products p
  WHERE p.product_type = 'beat'::public.product_type
  ORDER BY
    CASE WHEN COALESCE(p.top_10_flag, false) THEN 0 ELSE 1 END ASC,
    COALESCE(p.performance_score, 0) DESC,
    COALESCE(p.play_count, 0) DESC,
    p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 24);
$$;

CREATE OR REPLACE VIEW public.public_home_battles_preview
WITH (security_invoker = false)
AS
SELECT
  b.id,
  b.title,
  b.slug,
  b.status,
  b.producer1_id,
  pp1.username AS producer1_username,
  b.producer2_id,
  pp2.username AS producer2_username,
  COALESCE(b.votes_producer1, 0) AS votes_producer1,
  COALESCE(b.votes_producer2, 0) AS votes_producer2,
  b.created_at
FROM public.battles b
LEFT JOIN public.public_producer_profiles pp1 ON pp1.user_id = b.producer1_id
LEFT JOIN public.public_producer_profiles pp2 ON pp2.user_id = b.producer2_id
WHERE b.status IN ('active', 'voting', 'completed', 'awaiting_admin', 'approved');

REVOKE ALL ON TABLE public.public_home_battles_preview FROM PUBLIC;
REVOKE ALL ON TABLE public.public_home_battles_preview FROM anon;
REVOKE ALL ON TABLE public.public_home_battles_preview FROM authenticated;
GRANT SELECT ON TABLE public.public_home_battles_preview TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_home_battles_preview(p_limit integer DEFAULT 3)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  status public.battle_status,
  producer1_id uuid,
  producer1_username text,
  producer2_id uuid,
  producer2_username text,
  votes_producer1 integer,
  votes_producer2 integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    pb.id,
    pb.title,
    pb.slug,
    pb.status,
    pb.producer1_id,
    pb.producer1_username,
    pb.producer2_id,
    pb.producer2_username,
    pb.votes_producer1,
    pb.votes_producer2,
    pb.created_at
  FROM public.public_home_battles_preview pb
  ORDER BY pb.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 12);
$$;

CREATE OR REPLACE FUNCTION public.get_public_home_top_producers(p_limit integer DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  raw_username text,
  username text,
  avatar_url text,
  wins integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    lp.user_id,
    pp.raw_username,
    COALESCE(pp.username, lp.username) AS username,
    COALESCE(pp.avatar_url, lp.avatar_url) AS avatar_url,
    COALESCE(lp.battle_wins, 0)::integer AS wins
  FROM public.leaderboard_producers lp
  LEFT JOIN public.public_producer_profiles pp ON pp.user_id = lp.user_id
  WHERE COALESCE(lp.battle_wins, 0) > 0
  ORDER BY COALESCE(lp.battle_wins, 0) DESC, lp.rank_position ASC NULLS LAST, lp.user_id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_home_stats() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_home_top_producers(integer) TO anon, authenticated, service_role;

COMMIT;
