/*
  # Strategic Launch System — V1

  Adds a production-ready launch gating system with a single source of truth.

  Changes:
  1. public.settings  — add site_access_mode (replaces maintenance_mode as gate)
                      — add three dynamic message columns
  2. public.waitlist  — enrich with status, user_id, source, notes, accepted_at
                      — add RLS policies for admin full-access + user self-read
  3. public.access_whitelist — new table: DB-based whitelist (replaces ENV variable)
  4. get_my_launch_access()  — RPC returning caller's resolved access level
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. settings: single source of truth + dynamic messages
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS site_access_mode text NOT NULL DEFAULT 'private'
    CHECK (site_access_mode IN ('private', 'controlled', 'public')),
  ADD COLUMN IF NOT EXISTS launch_message_public text,
  ADD COLUMN IF NOT EXISTS launch_message_waitlist_pending text,
  ADD COLUMN IF NOT EXISTS launch_message_whitelist text;

COMMENT ON COLUMN public.settings.site_access_mode IS
  'Single source of truth for site access gate: private (whitelist only), controlled (whitelist + accepted waitlist), public (everyone).';
COMMENT ON COLUMN public.settings.launch_message_public IS
  'Headline shown to anonymous or non-listed visitors on the launch page.';
COMMENT ON COLUMN public.settings.launch_message_waitlist_pending IS
  'Message shown to waitlisted users whose access is still pending.';
COMMENT ON COLUMN public.settings.launch_message_whitelist IS
  'Welcome message shown once to newly whitelisted users (toast/banner).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. waitlist: enrich with status + user linkage
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'maintenance_page',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

COMMENT ON COLUMN public.waitlist.status IS
  'Lifecycle of the waitlist entry: pending | accepted | rejected.';
COMMENT ON COLUMN public.waitlist.user_id IS
  'Auth user linked to this entry (set when they sign up after joining).';
COMMENT ON COLUMN public.waitlist.source IS
  'Origin of the signup: maintenance_page | referral | admin | etc.';
COMMENT ON COLUMN public.waitlist.accepted_at IS
  'Timestamp when an admin accepted this entry.';

CREATE INDEX IF NOT EXISTS idx_waitlist_status
  ON public.waitlist (status);

-- Ensures one waitlist row per auth user (allows null for pre-signup entries)
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_user_id
  ON public.waitlist (user_id)
  WHERE user_id IS NOT NULL;

-- Admins: full CRUD on all waitlist rows
DROP POLICY IF EXISTS "Admins manage waitlist" ON public.waitlist;
CREATE POLICY "Admins manage waitlist"
ON public.waitlist
FOR ALL
TO authenticated
USING  (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Authenticated users: read only their own entry (by user_id or matching email)
DROP POLICY IF EXISTS "User reads own waitlist entry" ON public.waitlist;
CREATE POLICY "User reads own waitlist entry"
ON public.waitlist
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR lower(email) = (
    SELECT lower(au.email)
    FROM auth.users au
    WHERE au.id = auth.uid()
    LIMIT 1
  )
);

-- Grant: authenticated users can read (RLS handles row filtering)
GRANT SELECT ON public.waitlist TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. access_whitelist: DB-based whitelist (replaces VITE_MAINTENANCE_WHITELIST)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.access_whitelist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        UNIQUE NOT NULL,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note       text,
  is_active  boolean     NOT NULL DEFAULT true
);

COMMENT ON TABLE public.access_whitelist IS
  'Users with unconditional full access regardless of site_access_mode. Replaces the VITE_MAINTENANCE_WHITELIST environment variable.';
COMMENT ON COLUMN public.access_whitelist.is_active IS
  'Set false to suspend access without deleting the record.';

ALTER TABLE public.access_whitelist ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD
DROP POLICY IF EXISTS "Admins manage access_whitelist" ON public.access_whitelist;
CREATE POLICY "Admins manage access_whitelist"
ON public.access_whitelist
FOR ALL
TO authenticated
USING  (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_whitelist TO authenticated;
GRANT ALL                            ON public.access_whitelist TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: get_my_launch_access()
--    Returns the caller's resolved access level based on site_access_mode.
--    Called by the frontend useLaunchAccess hook.
--    Works for both anonymous (auth.uid() IS NULL) and authenticated callers.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_launch_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid    := auth.uid();
  v_user_email  text;
  v_mode        text;
  v_whitelisted boolean := false;
  v_wl_status   text    := 'none';
  v_access      text;
BEGIN
  -- ── Read site access mode ──────────────────────────────────────────────────
  SELECT site_access_mode INTO v_mode FROM public.settings LIMIT 1;
  v_mode := COALESCE(v_mode, 'private');

  -- ── Public phase: everyone in ─────────────────────────────────────────────
  IF v_mode = 'public' THEN
    RETURN jsonb_build_object(
      'access_level',    'full',
      'waitlist_status', 'none',
      'is_whitelisted',  false,
      'phase',           'public'
    );
  END IF;

  -- ── Anonymous user: show launch page ──────────────────────────────────────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'access_level',    'public',
      'waitlist_status', 'none',
      'is_whitelisted',  false,
      'phase',           v_mode
    );
  END IF;

  -- ── Authenticated: resolve access ──────────────────────────────────────────
  SELECT lower(email) INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  -- Check whitelist (by user_id or email)
  SELECT EXISTS (
    SELECT 1
    FROM public.access_whitelist
    WHERE is_active = true
      AND (user_id = v_user_id OR lower(email) = v_user_email)
  ) INTO v_whitelisted;

  IF v_whitelisted THEN
    RETURN jsonb_build_object(
      'access_level',    'full',
      'waitlist_status', 'none',
      'is_whitelisted',  true,
      'phase',           v_mode
    );
  END IF;

  -- Check waitlist status
  SELECT status INTO v_wl_status
  FROM public.waitlist
  WHERE user_id = v_user_id OR lower(email) = v_user_email
  LIMIT 1;

  v_wl_status := COALESCE(v_wl_status, 'none');

  -- Resolve final access level
  IF v_mode = 'controlled' AND v_wl_status = 'accepted' THEN
    v_access := 'full';
  ELSIF v_wl_status = 'pending' THEN
    v_access := 'waitlist_pending';
  ELSE
    v_access := 'public';
  END IF;

  RETURN jsonb_build_object(
    'access_level',    v_access,
    'waitlist_status', v_wl_status,
    'is_whitelisted',  false,
    'phase',           v_mode
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_launch_access() IS
  'Returns the caller''s resolved access level (full | waitlist_pending | public) based on site_access_mode, access_whitelist, and waitlist.status.';

GRANT EXECUTE ON FUNCTION public.get_my_launch_access() TO anon, authenticated;

COMMIT;
