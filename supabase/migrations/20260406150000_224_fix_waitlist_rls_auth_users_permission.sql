/*
  # Fix waitlist RLS: replace auth.users subquery with auth.email()

  Root cause:
    The "User reads own waitlist entry" policy (migration 221) contained a
    subquery on auth.users:
      SELECT lower(au.email) FROM auth.users au WHERE au.id = auth.uid()

    PostgreSQL evaluates ALL permissive policies before OR-ing them. The
    authenticated role cannot SELECT from auth.users, so the subquery throws
    "permission denied for table users" — even for admins, because the failing
    policy error propagates before the admin policy can pass.

  Fix:
    Replace the subquery with auth.email() — a Supabase built-in that returns
    the caller's email directly from their JWT without touching auth.users.

  Same fix applied to get_my_launch_access() RPC for consistency.
*/

BEGIN;

-- ── waitlist: fix self-read policy ────────────────────────────────────────────

DROP POLICY IF EXISTS "User reads own waitlist entry" ON public.waitlist;
CREATE POLICY "User reads own waitlist entry"
ON public.waitlist
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR lower(email) = lower(auth.email())
);

-- ── get_my_launch_access(): fix auth.users subquery ───────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_launch_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid    := auth.uid();
  v_user_email  text    := lower(auth.email());
  v_mode        text;
  v_whitelisted boolean := false;
  v_wl_status   text    := 'none';
  v_access      text;
BEGIN
  SELECT site_access_mode INTO v_mode FROM public.settings LIMIT 1;
  v_mode := COALESCE(v_mode, 'private');

  IF v_mode = 'public' THEN
    RETURN jsonb_build_object('access_level','full','waitlist_status','none','is_whitelisted',false,'phase','public');
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('access_level','public','waitlist_status','none','is_whitelisted',false,'phase',v_mode);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.access_whitelist
    WHERE is_active = true
      AND (user_id = v_user_id OR lower(email) = v_user_email)
  ) INTO v_whitelisted;

  IF v_whitelisted THEN
    RETURN jsonb_build_object('access_level','full','waitlist_status','none','is_whitelisted',true,'phase',v_mode);
  END IF;

  SELECT status INTO v_wl_status
  FROM public.waitlist
  WHERE user_id = v_user_id OR lower(email) = v_user_email
  LIMIT 1;

  v_wl_status := COALESCE(v_wl_status, 'none');

  IF v_mode = 'controlled' AND v_wl_status = 'accepted' THEN
    v_access := 'full';
  ELSIF v_wl_status = 'pending' THEN
    v_access := 'waitlist_pending';
  ELSE
    v_access := 'public';
  END IF;

  RETURN jsonb_build_object('access_level',v_access,'waitlist_status',v_wl_status,'is_whitelisted',false,'phase',v_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_launch_access() TO anon, authenticated;

COMMIT;
