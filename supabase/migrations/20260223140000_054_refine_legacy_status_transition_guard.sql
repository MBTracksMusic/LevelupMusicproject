/*
  # Refine legacy status guard to transitions-only (additive)

  Purpose:
  - Keep legacy-status protection for new transitions into:
      pending, approved, voting
  - Do not block INSERTs that carry historical/legacy statuses.
  - Do not block updates of non-status fields on already-legacy rows.
  - Keep transitions out of legacy allowed (ex: voting -> completed/cancelled).

  Manual smoke tests (run in SQL editor if needed):
  -- 1) Should allow non-status update on legacy row:
  --    UPDATE public.battles SET updated_at = now() WHERE id = '<legacy_battle_id>';
  --
  -- 2) Should allow transition OUT of legacy:
  --    UPDATE public.battles SET status = 'completed' WHERE id = '<legacy_voting_battle_id>';
  --
  -- 3) Should reject transition INTO legacy:
  --    UPDATE public.battles SET status = 'voting' WHERE id = '<active_battle_id>';
  --    -- expect: legacy_battle_status_transition_forbidden
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_legacy_battle_status_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text IN ('pending', 'approved', 'voting') THEN
    RAISE EXCEPTION 'legacy_battle_status_transition_forbidden';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_legacy_battle_status_assignments() IS
  'Blocks only transitions into legacy statuses pending/approved/voting. Allows non-status updates and transitions out of legacy statuses.';

COMMIT;
