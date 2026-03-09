/*
  # Public visibility hardening (safe incremental)

  Goals:
  - Decouple public producer visibility from `is_producer_active` capability.
  - Keep voter identities private while restoring a useful public battle-of-the-day feed.
  - No raw battle vote exposure.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Public producer visibility (catalog use-case)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_visible_producer_profiles()
RETURNS TABLE (
  user_id uuid,
  raw_username text,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  bio text,
  social_links jsonb,
  xp bigint,
  level integer,
  rank_tier text,
  reputation_score numeric,
  is_deleted boolean,
  is_producer_active boolean,
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
    up.username AS raw_username,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.bio
    END AS bio,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN '{}'::jsonb
      ELSE COALESCE(up.social_links, '{}'::jsonb)
    END AS social_links,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    (COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL) AS is_deleted,
    COALESCE(up.is_producer_active, false) AS is_producer_active,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL
    AND COALESCE(up.is_deleted, false) = false
    AND up.deleted_at IS NULL
    AND (
      up.role IN ('producer', 'admin')
      OR COALESCE(up.is_producer_active, false) = true
      OR up.producer_tier IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.producer_id = up.id
          AND p.deleted_at IS NULL
          AND p.status = 'active'
          AND p.is_published = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.status IN ('active', 'voting', 'completed')
          AND (b.producer1_id = up.id OR b.producer2_id = up.id)
      )
    );
$$;

COMMENT ON FUNCTION public.get_public_visible_producer_profiles()
IS 'Public producer listing for marketplace discovery. Visibility is broader than is_producer_active capability.';

REVOKE ALL ON FUNCTION public.get_public_visible_producer_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_visible_producer_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_visible_producer_profiles() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_visible_producer_profiles() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_visible_producer_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_visible_producer_profiles() TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Public battle-of-the-day aggregator (no raw vote exposure)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_battle_of_the_day()
RETURNS TABLE (
  battle_id uuid,
  slug text,
  title text,
  status public.battle_status,
  producer1_id uuid,
  producer1_username text,
  producer2_id uuid,
  producer2_username text,
  winner_id uuid,
  votes_today integer,
  votes_total integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH daily_votes AS (
    SELECT
      bv.battle_id,
      count(*)::integer AS votes_today
    FROM public.battle_votes bv
    WHERE bv.created_at >= date_trunc('day', now())
      AND bv.created_at < date_trunc('day', now()) + interval '1 day'
    GROUP BY bv.battle_id
  ),
  ranked AS (
    SELECT
      b.id AS battle_id,
      b.slug,
      b.title,
      b.status,
      b.producer1_id,
      b.producer2_id,
      b.winner_id,
      COALESCE(dv.votes_today, 0)::integer AS votes_today,
      (COALESCE(b.votes_producer1, 0) + COALESCE(b.votes_producer2, 0))::integer AS votes_total,
      row_number() OVER (
        ORDER BY
          COALESCE(dv.votes_today, 0) DESC,
          (COALESCE(b.votes_producer1, 0) + COALESCE(b.votes_producer2, 0)) DESC,
          b.updated_at DESC,
          b.id ASC
      ) AS rn
    FROM public.battles b
    LEFT JOIN daily_votes dv ON dv.battle_id = b.id
    WHERE b.status IN ('active', 'voting', 'completed')
  )
  SELECT
    r.battle_id,
    r.slug,
    r.title,
    r.status,
    r.producer1_id,
    p1.username AS producer1_username,
    r.producer2_id,
    p2.username AS producer2_username,
    r.winner_id,
    r.votes_today,
    r.votes_total
  FROM ranked r
  LEFT JOIN public.public_producer_profiles p1
    ON p1.user_id = r.producer1_id
  LEFT JOIN public.public_producer_profiles p2
    ON p2.user_id = r.producer2_id
  WHERE r.rn = 1;
$$;

COMMENT ON FUNCTION public.get_public_battle_of_the_day()
IS 'Public safe aggregate for homepage battle spotlight. No voter-level data is exposed.';

REVOKE ALL ON FUNCTION public.get_public_battle_of_the_day() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_battle_of_the_day() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_battle_of_the_day() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_battle_of_the_day() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_battle_of_the_day() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_battle_of_the_day() TO service_role;

CREATE OR REPLACE VIEW public.battle_of_the_day
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_public_battle_of_the_day();

REVOKE ALL ON TABLE public.battle_of_the_day FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_of_the_day FROM anon;
REVOKE ALL ON TABLE public.battle_of_the_day FROM authenticated;
GRANT SELECT ON TABLE public.battle_of_the_day TO anon;
GRANT SELECT ON TABLE public.battle_of_the_day TO authenticated;
GRANT SELECT ON TABLE public.battle_of_the_day TO service_role;

COMMIT;
