/*
  # Leaderboard season automation

  Goals:
  - Add create_new_season() → archives current season + resets ELO + starts a new one.
  - Add check_and_rotate_season() → idempotent, called by pg_cron or season-cron Edge Function.
  - Guarantee exactly one active season with a future end_date exists after this migration.

  Safety:
  - Additive only (no DROP, no schema changes).
  - create_new_season() is admin + service_role gated.
  - check_and_rotate_season() is service_role only.
  - All three season-lifecycle functions (this + reset_elo_for_new_season) share the same
    permission model and can be chained safely inside a single transaction.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. create_new_season(name, duration_days)
--
--    Admin or service_role can call this.
--    If a season is currently active:
--      a) archives results + soft-resets ELO via reset_elo_for_new_season()
--      b) marks it inactive
--    Then inserts a new season with is_active = true.
--    Returns the new season uuid.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_new_season(
  p_name         text,
  p_duration_days integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor     uuid   := auth.uid();
  v_jwt_role  text   := COALESCE(
                          auth.jwt()->>'role',
                          current_setting('request.jwt.claim.role', true),
                          ''
                        );
  v_old_id    uuid;
  v_new_id    uuid;
BEGIN
  -- Auth guard
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- Validate inputs
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'season_name_required';
  END IF;

  p_duration_days := GREATEST(7, COALESCE(p_duration_days, 30));

  -- If there is a current active season → archive it first, then deactivate.
  -- Order matters: reset_elo_for_new_season() needs is_active = true to find it.
  v_old_id := public.get_active_season();

  IF v_old_id IS NOT NULL THEN
    -- Archive season_results + soft-reset ELO for all active producers.
    -- This function already checks admin/service_role; it will pass because
    -- the caller's JWT context is inherited through SECURITY DEFINER.
    PERFORM public.reset_elo_for_new_season();

    -- Deactivate the old season (releases the unique index for the next INSERT).
    UPDATE public.competitive_seasons
    SET    is_active   = false,
           updated_at  = now()
    WHERE  id = v_old_id;
  END IF;

  -- Create the new season.
  INSERT INTO public.competitive_seasons (name, start_date, end_date, is_active)
  VALUES (
    btrim(p_name),
    now(),
    now() + (p_duration_days || ' days')::interval,
    true
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL  ON FUNCTION public.create_new_season(text, integer) FROM PUBLIC;
REVOKE ALL  ON FUNCTION public.create_new_season(text, integer) FROM anon;
REVOKE ALL  ON FUNCTION public.create_new_season(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_new_season(text, integer) TO service_role;
-- Admins call it via authenticated client (is_admin() check inside).
GRANT EXECUTE ON FUNCTION public.create_new_season(text, integer) TO authenticated;

COMMENT ON FUNCTION public.create_new_season(text, integer) IS
  'Archives the current active season (reset ELO + season_results) then starts a new one. '
  'Admin or service_role only. Minimum duration: 7 days.';

-- ---------------------------------------------------------------------------
-- 2. check_and_rotate_season()
--
--    Service_role only — meant for pg_cron or the season-cron Edge Function.
--    Idempotent: safe to call every hour.
--    Returns:
--      'ok'                  → active season still running
--      'rotated:<name>'      → expired season archived, new one started
--      'created:<name>'      → no active season found, one was created
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_and_rotate_season()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role   text        := COALESCE(
                               auth.jwt()->>'role',
                               current_setting('request.jwt.claim.role', true),
                               ''
                             );
  v_end_date   timestamptz;
  v_new_name   text;
  v_new_id     uuid;
BEGIN
  -- Only pg_cron / Edge Function (service_role) may trigger rotation.
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  -- Check for a valid (non-expired) active season.
  SELECT end_date
  INTO   v_end_date
  FROM   public.competitive_seasons
  WHERE  is_active = true
  ORDER  BY start_date DESC
  LIMIT  1;

  IF FOUND AND v_end_date > now() THEN
    -- Nothing to do.
    RETURN 'ok';
  END IF;

  -- Compute next season name: "Season N" where N = total seasons + 1.
  SELECT 'Season ' || (COUNT(*) + 1)::text
  INTO   v_new_name
  FROM   public.competitive_seasons;

  -- create_new_season() handles archiving + ELO reset + deactivation of old season.
  SELECT public.create_new_season(v_new_name, 30)
  INTO   v_new_id;

  IF FOUND AND v_old_id IS DISTINCT FROM NULL THEN
    RETURN 'rotated:' || v_new_name;
  END IF;

  RETURN CASE
    WHEN NOT FOUND THEN 'created:' || v_new_name
    ELSE 'rotated:' || v_new_name
  END;
END;
$$;

-- Simplify: remove ambiguous v_old_id reference, use a flag instead.
CREATE OR REPLACE FUNCTION public.check_and_rotate_season()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role   text        := COALESCE(
                               auth.jwt()->>'role',
                               current_setting('request.jwt.claim.role', true),
                               ''
                             );
  v_end_date   timestamptz;
  v_had_active boolean     := false;
  v_new_name   text;
  v_new_id     uuid;
BEGIN
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT end_date
  INTO   v_end_date
  FROM   public.competitive_seasons
  WHERE  is_active = true
  ORDER  BY start_date DESC
  LIMIT  1;

  IF FOUND THEN
    v_had_active := true;
    IF v_end_date > now() THEN
      -- Active season still running → nothing to do.
      RETURN 'ok';
    END IF;
  END IF;

  -- Season missing or expired → rotate.
  SELECT 'Season ' || (COUNT(*) + 1)::text
  INTO   v_new_name
  FROM   public.competitive_seasons;

  SELECT public.create_new_season(v_new_name, 30)
  INTO   v_new_id;

  RETURN CASE WHEN v_had_active THEN 'rotated:' || v_new_name
              ELSE                   'created:' || v_new_name
         END;
END;
$$;

REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM PUBLIC;
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM anon;
REVOKE ALL  ON FUNCTION public.check_and_rotate_season() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_rotate_season() TO service_role;

COMMENT ON FUNCTION public.check_and_rotate_season() IS
  'Idempotent season rotation guard. Intended for pg_cron or the season-cron Edge Function. '
  'Returns ''ok'' when the current season is still running, ''rotated:<name>'' when an expired '
  'season was archived and a new one started, or ''created:<name>'' when no active season existed.';

-- ---------------------------------------------------------------------------
-- 3. Bootstrap guard
--
--    Runs once at migration time.
--    Ensures there is exactly one active season whose end_date is in the future.
--    If the current active season is expired → deactivate it and create a new one.
--    If no active season at all → create one.
--    ELO is NOT reset here (we don't want to penalise producers just because the
--    Season 3 seed expired passively — the admin can call create_new_season()
--    explicitly if a proper archive is desired).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_has_valid  boolean;
  v_new_name   text;
BEGIN
  -- Is there a currently active season with a future end_date?
  SELECT EXISTS (
    SELECT 1 FROM public.competitive_seasons
    WHERE  is_active = true AND end_date > now()
  ) INTO v_has_valid;

  IF v_has_valid THEN
    RAISE NOTICE 'Season bootstrap: active season found, nothing to do.';
    RETURN;
  END IF;

  -- Deactivate any expired active season (respects the unique index).
  UPDATE public.competitive_seasons
  SET    is_active  = false,
         updated_at = now()
  WHERE  is_active  = true;

  -- Compute next name.
  SELECT 'Season ' || (COUNT(*) + 1)::text
  INTO   v_new_name
  FROM   public.competitive_seasons;

  -- Insert a fresh 60-day season (longer first boot window).
  INSERT INTO public.competitive_seasons (name, start_date, end_date, is_active)
  VALUES (v_new_name, now(), now() + interval '60 days', true);

  RAISE NOTICE 'Season bootstrap: created new season "%".', v_new_name;
END;
$$;

COMMIT;
