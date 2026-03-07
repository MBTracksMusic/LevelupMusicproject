/*
  # Competitive system: ELO + matchmaking + badges + battle of the day

  Goals:
  - Add ELO and battle outcome counters to producer profiles.
  - Expose an ELO leaderboard view for top producers.
  - Provide matchmaking suggestions based on +/-100 ELO window.
  - Add badges/progression tables and assignment logic.
  - Publish a daily "battle of the day" view.

  Notes:
  - Additive migration only (no destructive schema changes).
  - Existing reputation system remains intact.
*/

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS elo_rating integer NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS battle_wins integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battle_losses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battle_draws integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_user_profiles_elo_rating
  ON public.user_profiles (elo_rating DESC);

CREATE INDEX IF NOT EXISTS idx_user_profiles_elo_active
  ON public.user_profiles (is_producer_active, elo_rating DESC)
  WHERE is_producer_active = true;

CREATE OR REPLACE FUNCTION public.update_elo_rating(
  p_player1 uuid,
  p_player2 uuid,
  p_winner uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rating1 integer := 1200;
  v_rating2 integer := 1200;
  v_expected1 numeric := 0.5;
  v_expected2 numeric := 0.5;
  v_score1 numeric := 0.5;
  v_score2 numeric := 0.5;
  v_k numeric := 32;
  v_new1 integer := 1200;
  v_new2 integer := 1200;
BEGIN
  IF p_player1 IS NULL OR p_player2 IS NULL OR p_player1 = p_player2 THEN
    RETURN false;
  END IF;

  IF p_winner IS NOT NULL
     AND p_winner <> p_player1
     AND p_winner <> p_player2 THEN
    RAISE EXCEPTION 'invalid_winner_for_elo';
  END IF;

  PERFORM 1
  FROM public.user_profiles up
  WHERE up.id IN (p_player1, p_player2)
  ORDER BY up.id
  FOR UPDATE;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_rating1
  FROM public.user_profiles up
  WHERE up.id = p_player1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_rating2
  FROM public.user_profiles up
  WHERE up.id = p_player2;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_winner = p_player1 THEN
    v_score1 := 1;
    v_score2 := 0;
  ELSIF p_winner = p_player2 THEN
    v_score1 := 0;
    v_score2 := 1;
  ELSE
    v_score1 := 0.5;
    v_score2 := 0.5;
  END IF;

  v_expected1 := 1 / (1 + power(10::numeric, (v_rating2 - v_rating1)::numeric / 400));
  v_expected2 := 1 / (1 + power(10::numeric, (v_rating1 - v_rating2)::numeric / 400));

  v_new1 := GREATEST(100, round(v_rating1 + (v_k * (v_score1 - v_expected1)))::integer);
  v_new2 := GREATEST(100, round(v_rating2 + (v_k * (v_score2 - v_expected2)))::integer);

  UPDATE public.user_profiles
  SET
    elo_rating = v_new1,
    battle_wins = COALESCE(battle_wins, 0) + CASE WHEN p_winner = p_player1 THEN 1 ELSE 0 END,
    battle_losses = COALESCE(battle_losses, 0) + CASE WHEN p_winner = p_player2 THEN 1 ELSE 0 END,
    battle_draws = COALESCE(battle_draws, 0) + CASE WHEN p_winner IS NULL THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE id = p_player1;

  UPDATE public.user_profiles
  SET
    elo_rating = v_new2,
    battle_wins = COALESCE(battle_wins, 0) + CASE WHEN p_winner = p_player2 THEN 1 ELSE 0 END,
    battle_losses = COALESCE(battle_losses, 0) + CASE WHEN p_winner = p_player1 THEN 1 ELSE 0 END,
    battle_draws = COALESCE(battle_draws, 0) + CASE WHEN p_winner IS NULL THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE id = p_player2;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_elo_rating(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_elo_rating(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_elo_rating(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_elo_rating(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_leaderboard_producers()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  elo_rating integer,
  battle_wins integer,
  battle_losses integer,
  battle_draws integer,
  total_battles integer,
  win_rate numeric,
  rank_position bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      up.id AS user_id,
      up.username,
      up.avatar_url,
      up.producer_tier,
      COALESCE(up.elo_rating, 1200) AS elo_rating,
      COALESCE(up.battle_wins, 0) AS battle_wins,
      COALESCE(up.battle_losses, 0) AS battle_losses,
      COALESCE(up.battle_draws, 0) AS battle_draws,
      (
        COALESCE(up.battle_wins, 0)
        + COALESCE(up.battle_losses, 0)
        + COALESCE(up.battle_draws, 0)
      )::integer AS total_battles
    FROM public.user_profiles up
    WHERE up.is_producer_active = true
      AND up.role IN ('producer', 'admin')
  )
  SELECT
    b.user_id,
    b.username,
    b.avatar_url,
    b.producer_tier,
    b.elo_rating,
    b.battle_wins,
    b.battle_losses,
    b.battle_draws,
    b.total_battles,
    CASE
      WHEN b.total_battles = 0 THEN 0::numeric
      ELSE round((b.battle_wins::numeric / b.total_battles::numeric) * 100, 2)
    END AS win_rate,
    row_number() OVER (
      ORDER BY
        b.elo_rating DESC,
        b.battle_wins DESC,
        b.battle_losses ASC,
        b.username ASC NULLS LAST,
        b.user_id ASC
    ) AS rank_position
  FROM base b;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard_producers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_leaderboard_producers() FROM anon;
REVOKE ALL ON FUNCTION public.get_leaderboard_producers() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_producers() TO anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_producers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_producers() TO service_role;

DROP VIEW IF EXISTS public.leaderboard_producers;
CREATE VIEW public.leaderboard_producers
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_leaderboard_producers()
ORDER BY rank_position ASC;

REVOKE ALL ON TABLE public.leaderboard_producers FROM PUBLIC;
REVOKE ALL ON TABLE public.leaderboard_producers FROM anon;
REVOKE ALL ON TABLE public.leaderboard_producers FROM authenticated;
GRANT SELECT ON TABLE public.leaderboard_producers TO anon;
GRANT SELECT ON TABLE public.leaderboard_producers TO authenticated;
GRANT SELECT ON TABLE public.leaderboard_producers TO service_role;

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
    AND COALESCE(up.elo_rating, 1200) BETWEEN (v_user_rating - 100) AND (v_user_rating + 100)
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

CREATE TABLE IF NOT EXISTS public.producer_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  condition_type text NOT NULL CHECK (condition_type IN ('total_battles', 'total_wins', 'leaderboard_top')),
  condition_value integer NOT NULL CHECK (condition_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_badges (
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES public.producer_badges(id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id
  ON public.user_badges (user_id);

CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id
  ON public.user_badges (badge_id);

ALTER TABLE public.producer_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read producer badges" ON public.producer_badges;
CREATE POLICY "Anyone can read producer badges"
  ON public.producer_badges
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Anyone can read user badges" ON public.user_badges;
CREATE POLICY "Anyone can read user badges"
  ON public.user_badges
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.producer_badges FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_badges FROM anon, authenticated;
GRANT SELECT ON TABLE public.producer_badges TO anon, authenticated;
GRANT SELECT ON TABLE public.user_badges TO anon, authenticated;
GRANT ALL ON TABLE public.producer_badges TO service_role;
GRANT ALL ON TABLE public.user_badges TO service_role;

INSERT INTO public.producer_badges (name, description, condition_type, condition_value)
VALUES
  ('Rookie', 'Unlocked after participating in 5 battles.', 'total_battles', 5),
  ('Challenger', 'Unlocked after participating in 20 battles.', 'total_battles', 20),
  ('Champion', 'Unlocked after 50 battle wins.', 'total_wins', 50),
  ('Lion Elite', 'Unlocked by entering Top 10 of the ELO leaderboard.', 'leaderboard_top', 10)
ON CONFLICT (name)
DO UPDATE SET
  description = EXCLUDED.description,
  condition_type = EXCLUDED.condition_type,
  condition_value = EXCLUDED.condition_value,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.check_and_assign_badges(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wins integer := 0;
  v_losses integer := 0;
  v_draws integer := 0;
  v_total_battles integer := 0;
  v_rank_position bigint := NULL;
  v_inserted integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT
    COALESCE(up.battle_wins, 0),
    COALESCE(up.battle_losses, 0),
    COALESCE(up.battle_draws, 0)
  INTO
    v_wins,
    v_losses,
    v_draws
  FROM public.user_profiles up
  WHERE up.id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_total_battles := v_wins + v_losses + v_draws;

  SELECT glp.rank_position
  INTO v_rank_position
  FROM public.get_leaderboard_producers() glp
  WHERE glp.user_id = p_user_id
  LIMIT 1;

  WITH eligible AS (
    SELECT pb.id
    FROM public.producer_badges pb
    WHERE (
      pb.condition_type = 'total_battles'
      AND v_total_battles >= pb.condition_value
    )
    OR (
      pb.condition_type = 'total_wins'
      AND v_wins >= pb.condition_value
    )
    OR (
      pb.condition_type = 'leaderboard_top'
      AND v_rank_position IS NOT NULL
      AND v_rank_position <= pb.condition_value
    )
  )
  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT p_user_id, e.id
  FROM eligible e
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_assign_badges(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_and_assign_badges(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_assign_badges(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_assign_badges(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.on_battle_completed_competitive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND COALESCE(OLD.status::text, '') <> 'completed' THEN
    BEGIN
      IF NEW.producer1_id IS NOT NULL AND NEW.producer2_id IS NOT NULL THEN
        PERFORM public.update_elo_rating(
          NEW.producer1_id,
          NEW.producer2_id,
          NEW.winner_id
        );
      END IF;

      PERFORM public.check_and_assign_badges(NEW.producer1_id);
      PERFORM public.check_and_assign_badges(NEW.producer2_id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'on_battle_completed_competitive failed for battle %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_battle_completed_competitive ON public.battles;
CREATE TRIGGER trg_battle_completed_competitive
  AFTER UPDATE OF status, winner_id ON public.battles
  FOR EACH ROW
  EXECUTE FUNCTION public.on_battle_completed_competitive();

DROP VIEW IF EXISTS public.battle_of_the_day;
CREATE VIEW public.battle_of_the_day
WITH (security_invoker = true)
AS
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
    b.votes_producer1,
    b.votes_producer2,
    dv.votes_today,
    (COALESCE(b.votes_producer1, 0) + COALESCE(b.votes_producer2, 0))::integer AS votes_total,
    row_number() OVER (
      ORDER BY
        dv.votes_today DESC,
        (COALESCE(b.votes_producer1, 0) + COALESCE(b.votes_producer2, 0)) DESC,
        b.updated_at DESC,
        b.id ASC
    ) AS rn
  FROM daily_votes dv
  JOIN public.battles b
    ON b.id = dv.battle_id
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

REVOKE ALL ON TABLE public.battle_of_the_day FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_of_the_day FROM anon;
REVOKE ALL ON TABLE public.battle_of_the_day FROM authenticated;
GRANT SELECT ON TABLE public.battle_of_the_day TO anon;
GRANT SELECT ON TABLE public.battle_of_the_day TO authenticated;
GRANT SELECT ON TABLE public.battle_of_the_day TO service_role;

WITH completed AS (
  SELECT
    b.id,
    b.producer1_id,
    b.producer2_id,
    b.winner_id
  FROM public.battles b
  WHERE b.status = 'completed'
),
participants AS (
  SELECT c.producer1_id AS user_id, c.winner_id
  FROM completed c
  WHERE c.producer1_id IS NOT NULL

  UNION ALL

  SELECT c.producer2_id AS user_id, c.winner_id
  FROM completed c
  WHERE c.producer2_id IS NOT NULL
),
stats AS (
  SELECT
    p.user_id,
    SUM(CASE WHEN p.winner_id = p.user_id THEN 1 ELSE 0 END)::integer AS wins,
    SUM(CASE WHEN p.winner_id IS NOT NULL AND p.winner_id <> p.user_id THEN 1 ELSE 0 END)::integer AS losses,
    SUM(CASE WHEN p.winner_id IS NULL THEN 1 ELSE 0 END)::integer AS draws
  FROM participants p
  GROUP BY p.user_id
)
UPDATE public.user_profiles up
SET
  battle_wins = COALESCE(s.wins, 0),
  battle_losses = COALESCE(s.losses, 0),
  battle_draws = COALESCE(s.draws, 0)
FROM stats s
WHERE up.id = s.user_id;

UPDATE public.user_profiles up
SET
  battle_wins = COALESCE(up.battle_wins, 0),
  battle_losses = COALESCE(up.battle_losses, 0),
  battle_draws = COALESCE(up.battle_draws, 0),
  elo_rating = COALESCE(up.elo_rating, 1200)
WHERE up.elo_rating IS NULL
   OR up.battle_wins IS NULL
   OR up.battle_losses IS NULL
   OR up.battle_draws IS NULL;

DROP POLICY IF EXISTS "Owner can update own profile" ON public.user_profiles;

CREATE POLICY "Owner can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid())
  AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid())
  AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid())
  AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid())
  AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid())
  AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid())
  AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid())
  AND battle_refusal_count IS NOT DISTINCT FROM (SELECT battle_refusal_count FROM public.user_profiles WHERE id = auth.uid())
  AND battles_participated IS NOT DISTINCT FROM (SELECT battles_participated FROM public.user_profiles WHERE id = auth.uid())
  AND battles_completed IS NOT DISTINCT FROM (SELECT battles_completed FROM public.user_profiles WHERE id = auth.uid())
  AND engagement_score IS NOT DISTINCT FROM (SELECT engagement_score FROM public.user_profiles WHERE id = auth.uid())
  AND elo_rating IS NOT DISTINCT FROM (SELECT elo_rating FROM public.user_profiles WHERE id = auth.uid())
  AND battle_wins IS NOT DISTINCT FROM (SELECT battle_wins FROM public.user_profiles WHERE id = auth.uid())
  AND battle_losses IS NOT DISTINCT FROM (SELECT battle_losses FROM public.user_profiles WHERE id = auth.uid())
  AND battle_draws IS NOT DISTINCT FROM (SELECT battle_draws FROM public.user_profiles WHERE id = auth.uid())
);

COMMIT;
