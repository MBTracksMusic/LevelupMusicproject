/*
  # Optional orchestration helper: finalize expired battles

  - Non-blocking: no pg_cron job is created automatically.
  - Can be called manually by admin (authenticated) or service_role.
  - Uses existing `finalize_battle` checks and logic.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  FOR v_row IN
    SELECT b.id
    FROM public.battles b
    WHERE b.status = 'voting'
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    PERFORM public.finalize_battle(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_battles(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_battles(integer) TO service_role;

COMMIT;
