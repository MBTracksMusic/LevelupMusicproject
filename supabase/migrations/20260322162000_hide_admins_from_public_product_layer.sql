BEGIN;

CREATE OR REPLACE FUNCTION public.suggest_opponents(p_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  elo_rating integer,
  battle_wins integer,
  battle_losses integer,
  battle_draws integer,
  elo_diff integer,
  role public.user_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_user_rating integer := 1200;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_user_rating
  FROM public.user_profiles up
  WHERE up.id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(up.elo_rating, 1200) AS elo_rating,
    COALESCE(up.battle_wins, 0) AS battle_wins,
    COALESCE(up.battle_losses, 0) AS battle_losses,
    COALESCE(up.battle_draws, 0) AS battle_draws,
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff,
    up.role
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role = 'producer'
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 400
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(up.elo_rating, 1200) AS elo_rating,
    COALESCE(up.battle_wins, 0) AS battle_wins,
    COALESCE(up.battle_losses, 0) AS battle_losses,
    COALESCE(up.battle_draws, 0) AS battle_draws,
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff,
    up.role
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role = 'producer'
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 600
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(up.elo_rating, 1200) AS elo_rating,
    COALESCE(up.battle_wins, 0) AS battle_wins,
    COALESCE(up.battle_losses, 0) AS battle_losses,
    COALESCE(up.battle_draws, 0) AS battle_draws,
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff,
    up.role
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role = 'producer'
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 800
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matchmaking_opponents()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  elo_rating integer,
  battle_wins integer,
  battle_losses integer,
  battle_draws integer,
  elo_diff integer,
  role public.user_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.suggest_opponents(v_uid);
END;
$$;

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
    AND up.role = 'producer'
$$;

CREATE OR REPLACE FUNCTION public.get_public_producer_profiles()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  bio text,
  social_links jsonb,
  xp bigint,
  level integer,
  rank_tier text,
  reputation_score numeric,
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
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL
    AND up.role = 'producer';
$$;

CREATE OR REPLACE FUNCTION public.get_public_producer_profiles_soft()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  bio text,
  social_links jsonb,
  xp bigint,
  level integer,
  rank_tier text,
  reputation_score numeric,
  created_at timestamptz,
  updated_at timestamptz,
  raw_username text,
  is_deleted boolean,
  is_producer_active boolean
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
    up.created_at,
    up.updated_at,
    up.username AS raw_username,
    (COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL) AS is_deleted,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.producer_subscriptions ps_any
        WHERE ps_any.user_id = up.id
      ) THEN EXISTS (
        SELECT 1
        FROM public.producer_subscriptions ps
        WHERE ps.user_id = up.id
          AND COALESCE(ps.is_producer_active, false) = true
          AND ps.subscription_status IN ('active', 'trialing')
          AND ps.current_period_end > now()
      )
      ELSE COALESCE(up.is_producer_active, false)
    END AS is_producer_active
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL
    AND up.role = 'producer';
$$;

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
    AND up.role = 'producer'
    AND (
      COALESCE(up.is_producer_active, false) = true
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

CREATE OR REPLACE FUNCTION public.sync_user_profile_producer_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_profiles
    SET is_producer_active = CASE
          WHEN role = 'admin'::public.user_role THEN false
          ELSE NEW.is_producer_active
        END,
        role = CASE
          WHEN role = 'admin'::public.user_role THEN role
          WHEN NEW.is_producer_active = true THEN 'producer'::public.user_role
          ELSE role
        END,
        updated_at = now()
    WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

UPDATE public.user_profiles
SET is_producer_active = false,
    updated_at = now()
WHERE role = 'admin'
  AND is_producer_active = true;

COMMIT;
