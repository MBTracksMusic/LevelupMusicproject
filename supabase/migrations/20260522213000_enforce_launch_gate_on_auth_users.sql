-- Enforce launch access for every auth.users creation path.
--
-- auth-signup already calls public.can_email_register(p_email) before creating
-- an Auth user. This trigger applies the same gate globally so direct Supabase
-- Auth signup, OAuth, and any other auth.users insert path cannot bypass the
-- launch access mode.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_launch_gate_on_auth_user_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.can_email_register(NEW.email) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'registration_not_allowed',
      DETAIL = 'Email is not authorized to register under the current launch access mode.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_launch_gate_on_auth_user_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_launch_gate_on_auth_user_insert() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_launch_gate_on_auth_user_insert() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_launch_gate_on_auth_user_insert() FROM service_role;

DROP TRIGGER IF EXISTS trg_enforce_launch_gate_on_auth_user_insert ON auth.users;
CREATE TRIGGER trg_enforce_launch_gate_on_auth_user_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_launch_gate_on_auth_user_insert();

REVOKE EXECUTE ON FUNCTION public.accept_waitlist_entry(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_waitlist_entry(uuid) FROM anon;

COMMIT;
