-- Migration 239: sync auth.users.email_confirmed_at → user_profiles.confirmed_at
--
-- Problem: handle_new_user sets confirmed_at only at INSERT time (for OAuth users).
-- When an email/password user clicks the confirmation link, auth.users.email_confirmed_at
-- is set but user_profiles.confirmed_at stays NULL forever.
--
-- Fix:
--   1. Trigger on auth.users UPDATE to sync confirmed_at + is_confirmed.
--   2. Backfill existing users whose email is confirmed in auth but not in user_profiles.

-- ── 1. Trigger function ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_email_confirmed_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only act when email_confirmed_at transitions from NULL → non-NULL
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.user_profiles
    SET
      confirmed_at = NEW.email_confirmed_at,
      is_confirmed = true,
      updated_at   = now()
    WHERE id = NEW.id
      AND confirmed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed_sync_profile ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed_sync_profile
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.sync_email_confirmed_to_profile();

-- ── 2. Backfill existing confirmed users ─────────────────────────────────────

UPDATE public.user_profiles up
SET
  confirmed_at = au.email_confirmed_at,
  is_confirmed = true,
  updated_at   = now()
FROM auth.users au
WHERE up.id            = au.id
  AND au.email_confirmed_at IS NOT NULL
  AND up.confirmed_at  IS NULL
  AND up.is_deleted     = false;
