/*
  # Harden leaderboard season system

  Changes (additive, non-breaking):

  1. reset_elo_for_new_season()
     - Add archive-before-reset safety check.
       If the leaderboard has producers but 0 rows are archived, abort with an
       exception — ELO is never reset without a successful archive.
     - Add RAISE LOG at key steps for production observability.
     - Signature: UNCHANGED.

  2. create_new_season(p_name, p_duration_days)
     - p_name now defaults to NULL; when NULL/empty, auto-generates
       'Season YYYY-MM' from the current timestamp.
     - Existing callers that provide a name are unaffected.
     - Add RAISE LOG on creation.

  3. check_and_rotate_season()
     - Add pg_try_advisory_xact_lock (non-blocking, transaction-scoped).
       Concurrent cron runs return 'locked' immediately — no deadlock possible,
       no indefinite blocking, lock auto-released when transaction ends.
     - Add RAISE LOG for every outcome (ok / locked / rotated / created).
     - Keep all existing logic intact.

  Advisory lock key
     42424201  — arbitrary stable bigint, documented here.
     To avoid collisions with other advisory locks in the project, pick a
     different number if needed (update both places: the constant comment and
     the pg_try_advisory_xact_lock call).
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. reset_elo_for_new_season()
--    CHANGES: archive safety guard + logging.
--    Signature: UNCHANGED.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_elo_for_new_season()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor          uuid    := auth.uid();
  v_jwt_role       text    := COALESCE(
                                auth.jwt()->>'role',
                                current_setting('request.jwt.claim.role', true),
                                ''
                              );
  v_active_season  uuid;
  v_expected       integer := 0;   -- producers visible in leaderboard before archive
  v_archived       integer := 0;   -- rows written to season_results
  v_updated        integer := 0;   -- rows whose ELO was reset
BEGIN
  -- Auth guard (unchanged).
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  v_active_season := public.get_active_season();

  IF v_active_season IS NULL THEN
    RAISE EXCEPTION 'no_active_season';
  END IF;

  RAISE LOG '[season] reset_elo_for_new_season: starting archive for season %',
    v_active_season;

  -- ── Safety: how many producers should we archive? ──────────────────────
  -- leaderboard_producers is the canonical source (same view used in archive).
  SELECT COUNT(*)::integer
  INTO   v_expected
  FROM   public.leaderboard_producers;

  -- ── Archive season results ──────────────────────────────────────────────
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
    final_elo     = EXCLUDED.final_elo,
    rank_position = EXCLUDED.rank_position,
    wins          = EXCLUDED.wins,
    losses        = EXCLUDED.losses,
    created_at    = now();

  GET DIAGNOSTICS v_archived = ROW_COUNT;

  RAISE LOG '[season] reset_elo_for_new_season: archived % / % producers for season %',
    v_archived, v_expected, v_active_season;

  -- ── Data-safety gate ───────────────────────────────────────────────────
  -- If the leaderboard had producers but we archived nothing, something went
  -- wrong with the INSERT. Abort here — ELO must NOT be reset without archive.
  IF v_expected > 0 AND v_archived = 0 THEN
    RAISE EXCEPTION
      'season_archive_failed: leaderboard had % producers but 0 rows were archived for season %',
      v_expected, v_active_season;
  END IF;

  -- ── Assign seasonal badges ─────────────────────────────────────────────
  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM   public.season_results sr
  JOIN   public.producer_badges pb ON pb.name = 'Season Champion'
  WHERE  sr.season_id = v_active_season AND sr.rank_position = 1
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM   public.season_results sr
  JOIN   public.producer_badges pb ON pb.name = 'Top 10 Season'
  WHERE  sr.season_id = v_active_season AND sr.rank_position <= 10
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM   public.season_results sr
  JOIN   public.producer_badges pb ON pb.name = 'Top 100 Season'
  WHERE  sr.season_id = v_active_season AND sr.rank_position <= 100
  ON CONFLICT DO NOTHING;

  -- ── ELO soft-reset ─────────────────────────────────────────────────────
  -- Runs only after a successful archive (gate above guarantees this).
  UPDATE public.user_profiles up
  SET
    elo_rating = GREATEST(
      100,
      round(1200 + ((COALESCE(up.elo_rating, 1200) - 1200) * 0.5))::integer
    ),
    updated_at = now()
  WHERE up.role IN ('producer', 'admin')
    AND up.is_producer_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RAISE LOG '[season] reset_elo_for_new_season: ELO reset applied to % producers for season %',
    v_updated, v_active_season;

  RETURN v_updated;
END;
$$;

-- Grants unchanged (same as migration 144).
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.reset_elo_for_new_season() TO service_role;
GRANT  EXECUTE ON FUNCTION public.reset_elo_for_new_season() TO authenticated;  -- admin gate inside

COMMENT ON FUNCTION public.reset_elo_for_new_season() IS
  'Archives season_results + resets ELO for the active season. '
  'Aborts with an exception if archive produces 0 rows but producers exist. '
  'Admin or service_role only.';

-- ---------------------------------------------------------------------------
-- 2. create_new_season(p_name, p_duration_days)
--    CHANGES: p_name defaults to NULL (auto-generated when omitted/empty) + logging.
--    Signature: backward-compatible (existing callers providing a name are unaffected).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_new_season(
  p_name          text    DEFAULT NULL,
  p_duration_days integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_jwt_role text := COALESCE(
                       auth.jwt()->>'role',
                       current_setting('request.jwt.claim.role', true),
                       ''
                     );
  v_old_id   uuid;
  v_new_id   uuid;
  v_name     text;
BEGIN
  -- Auth guard (unchanged).
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  p_duration_days := GREATEST(7, COALESCE(p_duration_days, 30));

  -- Auto-generate name when not provided or empty.
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    v_name := 'Season ' || to_char(now(), 'YYYY-MM');
  END IF;

  -- If an active season exists → archive it first (reset_elo_for_new_season needs
  -- is_active = true, so deactivation must come AFTER the archive call).
  v_old_id := public.get_active_season();

  IF v_old_id IS NOT NULL THEN
    -- Archive season_results + soft-reset ELO.
    -- reset_elo_for_new_season() shares the same auth context (SECURITY DEFINER chain).
    PERFORM public.reset_elo_for_new_season();

    -- Deactivate old season (releases the unique partial index for the next INSERT).
    UPDATE public.competitive_seasons
    SET    is_active  = false,
           updated_at = now()
    WHERE  id = v_old_id;

    RAISE LOG '[season] create_new_season: archived and closed season % (%)',
      v_old_id, (SELECT name FROM public.competitive_seasons WHERE id = v_old_id);
  END IF;

  -- Create the new season.
  INSERT INTO public.competitive_seasons (name, start_date, end_date, is_active)
  VALUES (v_name, now(), now() + (p_duration_days || ' days')::interval, true)
  RETURNING id INTO v_new_id;

  RAISE LOG '[season] create_new_season: new season created — id=% name=% duration=%d',
    v_new_id, v_name, p_duration_days;

  RETURN v_new_id;
END;
$$;

-- Grants unchanged (same as migration 221).
REVOKE ALL  ON FUNCTION public.create_new_season(text, integer) FROM PUBLIC;
REVOKE ALL  ON FUNCTION public.create_new_season(text, integer) FROM anon;
REVOKE ALL  ON FUNCTION public.create_new_season(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_new_season(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_new_season(text, integer) TO authenticated;  -- is_admin() gate inside

COMMENT ON FUNCTION public.create_new_season(text, integer) IS
  'Archives the current active season (ELO reset + season_results) then starts a new one. '
  'Name defaults to ''Season YYYY-MM'' when omitted. Min duration: 7 days. '
  'Admin or service_role only.';

-- ---------------------------------------------------------------------------
-- 3. check_and_rotate_season()
--    CHANGES: advisory lock (non-blocking) + logging.
--    All existing logic preserved.
--
--    Advisory lock key: 42424201 (bigint, transaction-scoped).
--    pg_try_advisory_xact_lock:
--      - Non-blocking: returns false immediately if lock is already held.
--      - Transaction-scoped: automatically released on commit/rollback.
--        No manual pg_advisory_unlock needed, no orphaned lock risk.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_and_rotate_season()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Stable lock key for season rotation. Document any change here.
  -- Must not overlap with other advisory locks in this project.
  c_lock_key   constant bigint := 42424201;

  v_jwt_role   text        := COALESCE(
                               auth.jwt()->>'role',
                               current_setting('request.jwt.claim.role', true),
                               ''
                             );
  v_got_lock   boolean;
  v_end_date   timestamptz;
  v_had_active boolean     := false;
  v_new_name   text;
  v_new_id     uuid;
BEGIN
  -- Auth guard (unchanged).
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  -- ── Advisory lock (non-blocking, transaction-scoped) ───────────────────
  -- If another cron invocation or manual call is already rotating, bail out
  -- immediately. The lock is released automatically when this transaction ends.
  v_got_lock := pg_try_advisory_xact_lock(c_lock_key);

  IF NOT v_got_lock THEN
    RAISE LOG '[season] check_and_rotate_season: skipped — lock % held by another session',
      c_lock_key;
    RETURN 'locked';
  END IF;

  -- ── Check active season ─────────────────────────────────────────────────
  SELECT end_date
  INTO   v_end_date
  FROM   public.competitive_seasons
  WHERE  is_active = true
  ORDER  BY start_date DESC
  LIMIT  1;

  IF FOUND THEN
    v_had_active := true;

    IF v_end_date > now() THEN
      -- Season still running — nothing to do.
      RAISE LOG '[season] check_and_rotate_season: ok — active season ends %',
        to_char(v_end_date, 'YYYY-MM-DD HH24:MI:SS TZ');
      RETURN 'ok';
    END IF;

    -- Season found but expired → fall through to rotation.
    RAISE LOG '[season] check_and_rotate_season: expired season detected (end_date=%), rotating…',
      to_char(v_end_date, 'YYYY-MM-DD HH24:MI:SS TZ');
  ELSE
    -- No active season at all — this is abnormal in production; log loudly.
    RAISE LOG '[season] check_and_rotate_season: WARNING — no active season found, creating emergency season';
  END IF;

  -- ── Rotate ─────────────────────────────────────────────────────────────
  -- Name: 'Season YYYY-MM' auto-generated inside create_new_season() when NULL.
  SELECT public.create_new_season(NULL, 30)
  INTO   v_new_id;

  -- Resolve the actual name that was inserted (for the return value).
  SELECT name
  INTO   v_new_name
  FROM   public.competitive_seasons
  WHERE  id = v_new_id;

  RAISE LOG '[season] check_and_rotate_season: % — id=% name=%',
    CASE WHEN v_had_active THEN 'rotated' ELSE 'created' END,
    v_new_id,
    v_new_name;

  RETURN CASE WHEN v_had_active
    THEN 'rotated:' || v_new_name
    ELSE 'created:' || v_new_name
  END;
END;
$$;

-- Grants unchanged (same as migration 221).
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM PUBLIC;
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM anon;
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_rotate_season() TO service_role;

COMMENT ON FUNCTION public.check_and_rotate_season() IS
  'Idempotent, race-safe season rotation guard. '
  'Uses pg_try_advisory_xact_lock(42424201) — returns ''locked'' immediately if '
  'another session is already rotating. Returns ''ok'' | ''rotated:<name>'' | '
  '''created:<name>'' | ''locked''. Service_role only.';

COMMIT;
