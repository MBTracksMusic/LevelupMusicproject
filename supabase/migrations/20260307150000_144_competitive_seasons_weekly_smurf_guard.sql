/*
  # Competitive improvements: seasons + weekly leaderboard + anti-smurf guard

  Goals:
  - Add competitive seasons and seasonal archive.
  - Add weekly leaderboard (top wins over 7 days).
  - Harden matchmaking and battle creation against very large skill gaps.
  - Add seasonal badges assigned during season reset.

  Notes:
  - Additive migration only.
  - Existing ELO/reputation systems are preserved.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.competitive_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitive_seasons_valid_dates CHECK (end_date > start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitive_seasons_one_active
  ON public.competitive_seasons (is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_competitive_seasons_dates
  ON public.competitive_seasons (start_date DESC, end_date DESC);

ALTER TABLE public.competitive_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read competitive seasons" ON public.competitive_seasons;
CREATE POLICY "Anyone can read competitive seasons"
  ON public.competitive_seasons
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.competitive_seasons FROM anon, authenticated;
GRANT SELECT ON TABLE public.competitive_seasons TO anon, authenticated;
GRANT ALL ON TABLE public.competitive_seasons TO service_role;

CREATE TABLE IF NOT EXISTS public.season_results (
  season_id uuid NOT NULL REFERENCES public.competitive_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  final_elo integer NOT NULL,
  rank_position integer NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_season_results_rank
  ON public.season_results (season_id, rank_position ASC);

CREATE INDEX IF NOT EXISTS idx_season_results_user
  ON public.season_results (user_id, season_id DESC);

ALTER TABLE public.season_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read season results" ON public.season_results;
CREATE POLICY "Anyone can read season results"
  ON public.season_results
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.season_results FROM anon, authenticated;
GRANT SELECT ON TABLE public.season_results TO anon, authenticated;
GRANT ALL ON TABLE public.season_results TO service_role;

CREATE OR REPLACE FUNCTION public.get_active_season()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cs.id
  FROM public.competitive_seasons cs
  WHERE cs.is_active = true
  ORDER BY cs.start_date DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_season() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_active_season() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_active_season() TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_season() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_season() TO service_role;

CREATE OR REPLACE FUNCTION public.get_active_season_details()
RETURNS TABLE (
  id uuid,
  name text,
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cs.id, cs.name, cs.start_date, cs.end_date, cs.is_active
  FROM public.competitive_seasons cs
  WHERE cs.is_active = true
  ORDER BY cs.start_date DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_season_details() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_active_season_details() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_active_season_details() TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_season_details() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_season_details() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.competitive_seasons) THEN
    INSERT INTO public.competitive_seasons (name, start_date, end_date, is_active)
    VALUES
      ('Season 1', now() - interval '180 days', now() - interval '120 days', false),
      ('Season 2', now() - interval '120 days', now() - interval '60 days', false),
      ('Season 3', now() - interval '60 days', now() + interval '30 days', true);
  ELSIF NOT EXISTS (SELECT 1 FROM public.competitive_seasons WHERE is_active = true) THEN
    UPDATE public.competitive_seasons cs
    SET is_active = true,
        updated_at = now()
    WHERE cs.id = (
      SELECT id
      FROM public.competitive_seasons
      ORDER BY end_date DESC
      LIMIT 1
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.producer_badges') IS NOT NULL THEN
    ALTER TABLE public.producer_badges
      DROP CONSTRAINT IF EXISTS producer_badges_condition_type_check;

    ALTER TABLE public.producer_badges
      ADD CONSTRAINT producer_badges_condition_type_check
      CHECK (
        condition_type IN (
          'total_battles',
          'total_wins',
          'leaderboard_top',
          'season_champion',
          'season_top10',
          'season_top100'
        )
      );
  END IF;
END;
$$;

INSERT INTO public.producer_badges (name, description, condition_type, condition_value)
VALUES
  ('Season Champion', 'Finished rank #1 in a competitive season.', 'season_champion', 1),
  ('Top 10 Season', 'Finished in the Top 10 of a competitive season.', 'season_top10', 10),
  ('Top 100 Season', 'Finished in the Top 100 of a competitive season.', 'season_top100', 100)
ON CONFLICT (name)
DO UPDATE SET
  description = EXCLUDED.description,
  condition_type = EXCLUDED.condition_type,
  condition_value = EXCLUDED.condition_value,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.reset_elo_for_new_season()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_active_season uuid;
  v_updated integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  v_active_season := public.get_active_season();

  IF v_active_season IS NULL THEN
    RAISE EXCEPTION 'no_active_season';
  END IF;

  INSERT INTO public.season_results (season_id, user_id, final_elo, rank_position, wins, losses)
  SELECT
    v_active_season,
    lp.user_id,
    lp.elo_rating,
    lp.rank_position::integer,
    lp.battle_wins,
    lp.battle_losses
  FROM public.leaderboard_producers lp
  ON CONFLICT (season_id, user_id)
  DO UPDATE SET
    final_elo = EXCLUDED.final_elo,
    rank_position = EXCLUDED.rank_position,
    wins = EXCLUDED.wins,
    losses = EXCLUDED.losses,
    created_at = now();

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM public.season_results sr
  JOIN public.producer_badges pb ON pb.name = 'Season Champion'
  WHERE sr.season_id = v_active_season
    AND sr.rank_position = 1
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM public.season_results sr
  JOIN public.producer_badges pb ON pb.name = 'Top 10 Season'
  WHERE sr.season_id = v_active_season
    AND sr.rank_position <= 10
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM public.season_results sr
  JOIN public.producer_badges pb ON pb.name = 'Top 100 Season'
  WHERE sr.season_id = v_active_season
    AND sr.rank_position <= 100
  ON CONFLICT DO NOTHING;

  UPDATE public.user_profiles up
  SET
    elo_rating = GREATEST(
      100,
      round(
        1200 + ((COALESCE(up.elo_rating, 1200) - 1200) * 0.5)
      )::integer
    ),
    updated_at = now()
  WHERE up.role IN ('producer', 'admin')
    AND up.is_producer_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_elo_for_new_season() TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_elo_for_new_season() TO authenticated;

DROP VIEW IF EXISTS public.weekly_leaderboard;
CREATE VIEW public.weekly_leaderboard
WITH (security_invoker = true)
AS
WITH recent_battles AS (
  SELECT
    b.id,
    b.producer1_id,
    b.producer2_id,
    b.winner_id
  FROM public.battles b
  WHERE b.status = 'completed'
    AND b.updated_at >= now() - interval '7 days'
),
participants AS (
  SELECT
    rb.producer1_id AS user_id,
    CASE WHEN rb.winner_id = rb.producer1_id THEN 1 ELSE 0 END AS win,
    CASE WHEN rb.winner_id IS NOT NULL AND rb.winner_id <> rb.producer1_id THEN 1 ELSE 0 END AS loss
  FROM recent_battles rb
  WHERE rb.producer1_id IS NOT NULL

  UNION ALL

  SELECT
    rb.producer2_id AS user_id,
    CASE WHEN rb.winner_id = rb.producer2_id THEN 1 ELSE 0 END AS win,
    CASE WHEN rb.winner_id IS NOT NULL AND rb.winner_id <> rb.producer2_id THEN 1 ELSE 0 END AS loss
  FROM recent_battles rb
  WHERE rb.producer2_id IS NOT NULL
),
agg AS (
  SELECT
    p.user_id,
    SUM(p.win)::integer AS weekly_wins,
    SUM(p.loss)::integer AS weekly_losses
  FROM participants p
  GROUP BY p.user_id
)
SELECT
  up.id AS user_id,
  up.username,
  a.weekly_wins,
  a.weekly_losses,
  CASE
    WHEN (a.weekly_wins + a.weekly_losses) = 0 THEN 0::numeric
    ELSE round((a.weekly_wins::numeric / (a.weekly_wins + a.weekly_losses)::numeric) * 100, 2)
  END AS weekly_winrate,
  row_number() OVER (
    ORDER BY a.weekly_wins DESC, a.weekly_losses ASC, up.username ASC NULLS LAST, up.id ASC
  ) AS rank_position
FROM agg a
JOIN public.user_profiles up ON up.id = a.user_id
WHERE up.is_producer_active = true
  AND up.role IN ('producer', 'admin')
ORDER BY rank_position ASC;

REVOKE ALL ON TABLE public.weekly_leaderboard FROM PUBLIC;
REVOKE ALL ON TABLE public.weekly_leaderboard FROM anon;
REVOKE ALL ON TABLE public.weekly_leaderboard FROM authenticated;
GRANT SELECT ON TABLE public.weekly_leaderboard TO anon;
GRANT SELECT ON TABLE public.weekly_leaderboard TO authenticated;
GRANT SELECT ON TABLE public.weekly_leaderboard TO service_role;

CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(p_limit integer DEFAULT 50)
RETURNS TABLE (
  user_id uuid,
  username text,
  weekly_wins integer,
  weekly_losses integer,
  weekly_winrate numeric,
  rank_position bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    wl.user_id,
    wl.username,
    wl.weekly_wins,
    wl.weekly_losses,
    wl.weekly_winrate,
    wl.rank_position
  FROM public.weekly_leaderboard wl
  ORDER BY wl.rank_position ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
$$;

REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO service_role;

DROP VIEW IF EXISTS public.season_leaderboard;
CREATE VIEW public.season_leaderboard
WITH (security_invoker = true)
AS
WITH active AS (
  SELECT cs.id, cs.name, cs.start_date, cs.end_date
  FROM public.competitive_seasons cs
  WHERE cs.is_active = true
  ORDER BY cs.start_date DESC
  LIMIT 1
)
SELECT
  a.id AS season_id,
  a.name AS season_name,
  a.start_date,
  a.end_date,
  lp.user_id,
  lp.username,
  lp.avatar_url,
  lp.producer_tier,
  lp.elo_rating,
  lp.battle_wins,
  lp.battle_losses,
  lp.battle_draws,
  lp.total_battles,
  lp.win_rate,
  lp.rank_position
FROM active a
JOIN public.leaderboard_producers lp ON true
ORDER BY lp.rank_position ASC;

REVOKE ALL ON TABLE public.season_leaderboard FROM PUBLIC;
REVOKE ALL ON TABLE public.season_leaderboard FROM anon;
REVOKE ALL ON TABLE public.season_leaderboard FROM authenticated;
GRANT SELECT ON TABLE public.season_leaderboard TO anon;
GRANT SELECT ON TABLE public.season_leaderboard TO authenticated;
GRANT SELECT ON TABLE public.season_leaderboard TO service_role;

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
  elo_diff integer
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
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role IN ('producer', 'admin')
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
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role IN ('producer', 'admin')
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
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role IN ('producer', 'admin')
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 800
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_opponents(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.suggest_opponents(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.suggest_opponents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_opponents(uuid) TO service_role;

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
  elo_diff integer
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

REVOKE EXECUTE ON FUNCTION public.get_matchmaking_opponents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_matchmaking_opponents() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_matchmaking_opponents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_matchmaking_opponents() TO service_role;

CREATE OR REPLACE FUNCTION public.assert_battle_skill_gap(
  p_producer1 uuid,
  p_producer2 uuid,
  p_max_diff integer DEFAULT 400
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_elo_1 integer := 1200;
  v_elo_2 integer := 1200;
BEGIN
  IF p_producer1 IS NULL OR p_producer2 IS NULL THEN
    RETURN false;
  END IF;

  IF p_max_diff IS NULL OR p_max_diff < 0 THEN
    p_max_diff := 400;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_producer1)
    OR public.is_admin(v_actor)
  ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_elo_1
  FROM public.user_profiles up
  WHERE up.id = p_producer1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_elo_2
  FROM public.user_profiles up
  WHERE up.id = p_producer2
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF ABS(v_elo_1 - v_elo_2) > p_max_diff THEN
    RAISE EXCEPTION 'Skill difference too high to start battle.';
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_battle_skill_gap(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_battle_skill_gap(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.assert_battle_skill_gap(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_battle_skill_gap(uuid, uuid, integer) TO service_role;

DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;

CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND producer1_id = auth.uid()
    AND producer2_id IS NOT NULL
    AND producer1_id != producer2_id
    AND status = 'pending_acceptance'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
    AND public.can_create_battle(auth.uid()) = true
    AND public.can_create_active_battle(auth.uid()) = true
    AND public.assert_battle_skill_gap(auth.uid(), producer2_id, 400) = true
    AND EXISTS (
      SELECT 1
      FROM public.public_producer_profiles pp2
      WHERE pp2.user_id = producer2_id
    )
    AND (
      product1_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p1
        WHERE p1.id = product1_id
          AND p1.producer_id = auth.uid()
          AND p1.deleted_at IS NULL
      )
    )
    AND (
      product2_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p2
        WHERE p2.id = product2_id
          AND p2.producer_id = producer2_id
          AND p2.deleted_at IS NULL
      )
    )
  );

COMMIT;
