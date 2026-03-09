/*
  # Public home discovery RPCs (safe additive)

  Goal:
  - Stabilize homepage public visibility for:
    - featured beats
    - battles preview
    - top producers
  - Avoid exposing sensitive fields.
  - Keep existing flows unchanged (additive only).
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Featured beats (public-safe)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_home_featured_beats(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  price integer,
  play_count integer,
  cover_image_url text,
  is_sold boolean,
  producer_id uuid,
  producer_username text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    p.producer_id,
    public.get_public_profile_label(up) AS producer_username
  FROM public.products p
  LEFT JOIN public.user_profiles up ON up.id = p.producer_id
  WHERE p.product_type = 'beat'
    AND p.deleted_at IS NULL
    AND p.status = 'active'
    AND COALESCE(p.is_published, false) = true
  ORDER BY COALESCE(p.play_count, 0) DESC, p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 24);
$$;

COMMENT ON FUNCTION public.get_public_home_featured_beats(integer)
IS 'Public-safe featured beats feed for homepage discovery.';

REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Battles preview (public-safe)
-- ---------------------------------------------------------------------------
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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.id,
    b.title,
    b.slug,
    b.status,
    b.producer1_id,
    public.get_public_profile_label(up1) AS producer1_username,
    b.producer2_id,
    public.get_public_profile_label(up2) AS producer2_username,
    COALESCE(b.votes_producer1, 0) AS votes_producer1,
    COALESCE(b.votes_producer2, 0) AS votes_producer2,
    b.created_at
  FROM public.battles b
  LEFT JOIN public.user_profiles up1 ON up1.id = b.producer1_id
  LEFT JOIN public.user_profiles up2 ON up2.id = b.producer2_id
  WHERE b.status IN ('active', 'voting', 'completed', 'awaiting_admin', 'approved', 'pending_acceptance')
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 12);
$$;

COMMENT ON FUNCTION public.get_public_home_battles_preview(integer)
IS 'Public-safe battles preview feed for homepage discovery.';

REVOKE ALL ON FUNCTION public.get_public_home_battles_preview(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_battles_preview(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_home_battles_preview(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Top producers (public-safe, wins-based)
-- ---------------------------------------------------------------------------
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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH wins_by_user AS (
    SELECT
      b.winner_id AS user_id,
      COUNT(*)::integer AS wins
    FROM public.battles b
    WHERE b.status = 'completed'
      AND b.winner_id IS NOT NULL
    GROUP BY b.winner_id
  )
  SELECT
    up.id AS user_id,
    up.username AS raw_username,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    w.wins
  FROM wins_by_user w
  JOIN public.user_profiles up ON up.id = w.user_id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL
  ORDER BY w.wins DESC, up.updated_at DESC, up.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30);
$$;

COMMENT ON FUNCTION public.get_public_home_top_producers(integer)
IS 'Public-safe top producers for homepage (wins from completed battles).';

REVOKE ALL ON FUNCTION public.get_public_home_top_producers(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_top_producers(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_home_top_producers(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_top_producers(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_home_top_producers(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_top_producers(integer) TO service_role;

COMMIT;
