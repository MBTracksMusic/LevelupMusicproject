-- Capture every auth.users signup into public.waitlist so admins can review
-- accounts that bypassed the LaunchScreen (direct /register, Google OAuth callback,
-- admin-created accounts, etc.).
--
-- Strategy:
--   • AFTER INSERT trigger on auth.users upserts (email, user_id, source, 'pending')
--   • ON CONFLICT (email): only link user_id, never overwrite status — preserves
--     prior admin acceptances and existing waitlist intent.
--   • Trigger never blocks the signup: any failure is logged as WARNING.
--   • One-shot backfill at the bottom marks every pre-existing account as pending.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Trigger function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_waitlist_entry_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email    text;
  v_provider text;
  v_source   text;
BEGIN
  v_email := lower(coalesce(NEW.email, ''));
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  v_provider := coalesce(NEW.raw_app_meta_data->>'provider', 'email');
  v_source   := CASE
                  WHEN v_provider = 'email' THEN 'direct_signup'
                  ELSE 'oauth_' || v_provider
                END;

  INSERT INTO public.waitlist (email, user_id, source, status)
  VALUES (v_email, NEW.id, v_source, 'pending')
  ON CONFLICT (email) DO UPDATE
    SET user_id = COALESCE(public.waitlist.user_id, EXCLUDED.user_id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ensure_waitlist_entry_on_signup failed for user %: %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_waitlist_entry_on_signup() FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Trigger
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_ensure_waitlist_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_ensure_waitlist_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_waitlist_entry_on_signup();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) One-shot backfill of pre-existing auth.users into the waitlist
--    Marks every account with no waitlist row yet as 'pending', source suffixed
--    with '_backfill' so it's easy to distinguish from organic signups.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.waitlist (email, user_id, source, status)
SELECT
  lower(u.email),
  u.id,
  CASE
    WHEN coalesce(u.raw_app_meta_data->>'provider', 'email') = 'email'
      THEN 'direct_signup_backfill'
    ELSE 'oauth_' || (u.raw_app_meta_data->>'provider') || '_backfill'
  END,
  'pending'
FROM auth.users u
LEFT JOIN public.waitlist w ON lower(u.email) = lower(w.email)
WHERE w.id IS NULL
  AND u.email IS NOT NULL
  AND u.email <> ''
ON CONFLICT (email) DO UPDATE
  SET user_id = COALESCE(public.waitlist.user_id, EXCLUDED.user_id);
