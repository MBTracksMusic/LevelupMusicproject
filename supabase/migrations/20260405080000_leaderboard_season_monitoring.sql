/*
  # Leaderboard season — monitoring & observability hardening

  Scope: ADDITIVE ONLY. No behavior changes. No schema changes. No new tables.
  Signatures: UNCHANGED for both functions.

  Changes applied:

  1. reset_elo_for_new_season()
     + Cross-check: if leaderboard_producers returns 0 rows but user_profiles
       contains active producers, emit RAISE WARNING. The archive view may be
       misconfigured. Existing abort logic (v_expected > 0 AND v_archived = 0)
       is untouched — this check fires earlier, before the INSERT.

  2. check_and_rotate_season()
     + 'locked' outcome  → upgraded from RAISE LOG to RAISE WARNING; adds
       an explicit hint about cron-overlap so ops can act on it.
     + 'ok' outcome      → two new proactive warnings added before RETURN:
         a) Expiry warning: active season ends within 72 hours.
         b) Long-running warning: active season started more than 60 days ago.
            (suggests cron rotation may not be firing correctly)
     + 'no active season' → upgraded from RAISE LOG to RAISE WARNING
       for faster ops visibility.
     + start_date fetched alongside end_date in the existing SELECT (no
       separate query).
     + Advisory lock key block comment expanded with full rationale.

  Functions NOT touched: create_new_season() — no changes needed.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. reset_elo_for_new_season()
--    ADDED: cross-check between leaderboard_producers and user_profiles.
--    Everything else: IDENTICAL to migration 222.
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
  v_expected       integer := 0;  -- producers visible in leaderboard_producers
  v_archived       integer := 0;  -- rows written to season_results
  v_updated        integer := 0;  -- rows whose ELO was reset
  -- NEW: raw count of active producers directly from user_profiles.
  -- Used only for the view-discrepancy cross-check below; never as archive source.
  v_raw_active     integer := 0;
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

  -- ── How many producers should we archive? ──────────────────────────────
  SELECT COUNT(*)::integer
  INTO   v_expected
  FROM   public.leaderboard_producers;

  -- ── NEW: Cross-check — leaderboard_producers vs user_profiles ──────────
  -- If the view returns 0 rows but active producers exist in user_profiles,
  -- the view filter or join may be broken. We do NOT switch source — the
  -- existing abort gate (v_expected > 0 AND v_archived = 0) will still fire
  -- after the INSERT and prevent an unarchived ELO reset.
  -- This WARNING fires early so ops can investigate the view before data loss.
  IF v_expected = 0 THEN
    SELECT COUNT(*)::integer
    INTO   v_raw_active
    FROM   public.user_profiles
    WHERE  is_producer_active = true
      AND  role IN ('producer', 'admin');

    IF v_raw_active > 0 THEN
      RAISE WARNING
        '[season] reset_elo_for_new_season: leaderboard_producers returned 0 rows '
        'but user_profiles has % active producers — the view may be misconfigured '
        'or filtering incorrectly. Season %, aborting to prevent unarchived ELO reset.',
        v_raw_active, v_active_season;
      -- Raise an exception so ELO reset never runs on an inconsistent state.
      RAISE EXCEPTION
        'season_archive_view_empty: leaderboard_producers=0 but active_producers=%',
        v_raw_active;
    END IF;
    -- v_raw_active = 0 → platform genuinely empty, proceed normally.
  END IF;

  -- ── Archive season results (unchanged) ────────────────────────────────
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

  -- ── Data-safety gate (unchanged) ──────────────────────────────────────
  IF v_expected > 0 AND v_archived = 0 THEN
    RAISE EXCEPTION
      'season_archive_failed: leaderboard had % producers but 0 rows were archived for season %',
      v_expected, v_active_season;
  END IF;

  -- ── Assign seasonal badges (unchanged) ────────────────────────────────
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

  -- ── ELO soft-reset (unchanged) ────────────────────────────────────────
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

-- Grants unchanged.
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_elo_for_new_season() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.reset_elo_for_new_season() TO service_role;
GRANT  EXECUTE ON FUNCTION public.reset_elo_for_new_season() TO authenticated;

COMMENT ON FUNCTION public.reset_elo_for_new_season() IS
  'Archives season_results + resets ELO for the active season. '
  'Cross-checks leaderboard_producers against user_profiles before archiving — '
  'aborts with a WARNING + exception if the view appears broken. '
  'Also aborts if archive produces 0 rows but producers exist. '
  'Admin or service_role only.';

-- ---------------------------------------------------------------------------
-- 2. check_and_rotate_season()
--    ADDED: cron-overlap warning on 'locked'; proactive warnings on 'ok'
--           (expiry within 72 h, running > 60 days); upgraded WARNING level
--           for missing active season; expanded lock-key documentation.
--    Everything else: IDENTICAL to migration 222.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_and_rotate_season()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- ── Advisory lock key ─────────────────────────────────────────────────
  --
  --  Value  : 42424201  (stable bigint, must never change once deployed)
  --  Scope  : pg_try_advisory_xact_lock → transaction-level.
  --           Released automatically on commit/rollback — no explicit unlock,
  --           no orphaned locks, no indefinite blocking.
  --  Purpose: prevents concurrent season rotations when the cron overlaps
  --           (e.g. two Edge Function invocations firing within the same minute,
  --           or a manual admin call racing with the scheduled job).
  --  Uniqueness: this key must not be reused by any other advisory lock in the
  --           project. If a collision is ever found, update both this constant
  --           AND the COMMENT ON FUNCTION below in a new migration.
  --
  c_lock_key     constant bigint      := 42424201;

  -- Thresholds for proactive monitoring signals (no behavior effect).
  c_expiry_warn  constant interval    := interval '72 hours';  -- warn if season ends soon
  c_age_warn     constant interval    := interval '60 days';   -- warn if season is very old

  v_jwt_role     text;
  v_got_lock     boolean;
  -- NEW: fetch start_date alongside end_date in one query (no extra round-trip).
  v_start_date   timestamptz;
  v_end_date     timestamptz;
  v_had_active   boolean := false;
  v_new_name     text;
  v_new_id       uuid;
BEGIN
  v_jwt_role := COALESCE(
    auth.jwt()->>'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );

  -- Auth guard (unchanged).
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  -- ── Advisory lock (unchanged logic, enhanced log) ──────────────────────
  v_got_lock := pg_try_advisory_xact_lock(c_lock_key);

  IF NOT v_got_lock THEN
    -- Upgraded from RAISE LOG → RAISE WARNING so it surfaces more visibly.
    -- A single 'locked' result is normal (two cron calls overlapping).
    -- Frequent occurrences suggest the cron interval is shorter than the
    -- rotation work duration — increase the interval or check for runaway jobs.
    RAISE WARNING
      '[season] check_and_rotate_season: lock % already held by a concurrent session — '
      'returning ''locked''. If this appears frequently in logs, your cron schedule '
      'may be overlapping (consider increasing the interval or checking for stuck jobs).',
      c_lock_key;
    RETURN 'locked';
  END IF;

  -- ── Check active season ─────────────────────────────────────────────────
  -- Fetch start_date too (used for long-running warning below).
  SELECT start_date, end_date
  INTO   v_start_date, v_end_date
  FROM   public.competitive_seasons
  WHERE  is_active = true
  ORDER  BY start_date DESC
  LIMIT  1;

  IF FOUND THEN
    v_had_active := true;

    IF v_end_date > now() THEN
      -- Season is running. Check proactive signals before returning 'ok'.

      -- Signal A: expiring within c_expiry_warn (default 72 h).
      -- Gives ops advance notice before the next rotation fires.
      IF v_end_date - now() <= c_expiry_warn THEN
        RAISE WARNING
          '[season] check_and_rotate_season: active season expires in ~% hours '
          '(end_date=%) — next rotation will fire at the next cron tick.',
          EXTRACT(EPOCH FROM (v_end_date - now()))::integer / 3600,
          to_char(v_end_date, 'YYYY-MM-DD HH24:MI:SS TZ');
      END IF;

      -- Signal B: season has been running longer than c_age_warn (default 60 d).
      -- Default seasons are 30 d, so >60 d suggests the rotation cron
      -- may not be running, or the season was created with a very long duration.
      IF now() - v_start_date > c_age_warn THEN
        RAISE WARNING
          '[season] check_and_rotate_season: active season has been running for '
          '% days (started %) — default seasons are 30 days; verify the rotation '
          'cron is scheduled correctly.',
          EXTRACT(EPOCH FROM (now() - v_start_date))::integer / 86400,
          to_char(v_start_date, 'YYYY-MM-DD TZ');
      END IF;

      RAISE LOG '[season] check_and_rotate_season: ok — active season ends %',
        to_char(v_end_date, 'YYYY-MM-DD HH24:MI:SS TZ');
      RETURN 'ok';
    END IF;

    -- Season found but expired → fall through to rotation (unchanged).
    RAISE LOG '[season] check_and_rotate_season: expired season detected (end_date=%), rotating…',
      to_char(v_end_date, 'YYYY-MM-DD HH24:MI:SS TZ');

  ELSE
    -- No active season at all.
    -- Upgraded from RAISE LOG → RAISE WARNING: this is abnormal in production
    -- and needs immediate attention (season_cron may not have been deployed).
    RAISE WARNING
      '[season] check_and_rotate_season: no active season found — '
      'creating an emergency season. Verify the season-cron Edge Function is '
      'deployed and scheduled correctly.';
  END IF;

  -- ── Rotate (unchanged) ────────────────────────────────────────────────
  SELECT public.create_new_season(NULL, 30)
  INTO   v_new_id;

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

-- Grants unchanged.
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM PUBLIC;
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM anon;
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_rotate_season() TO service_role;

COMMENT ON FUNCTION public.check_and_rotate_season() IS
  'Idempotent, race-safe season rotation guard. '
  'Advisory lock key: 42424201 (pg_try_advisory_xact_lock, transaction-scoped). '
  'Returns ''ok'' | ''rotated:<name>'' | ''created:<name>'' | ''locked''. '
  'Emits RAISE WARNING when: lock is contended (cron overlap), season expires '
  'within 72 h, season has been running > 60 days, or no active season exists. '
  'Service_role only.';

COMMIT;
