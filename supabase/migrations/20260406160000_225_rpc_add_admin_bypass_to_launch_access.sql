/*
  # get_my_launch_access: add admin bypass

  Root cause:
    The RPC only checked whitelist and waitlist.
    An admin who is not in either list received access_level = 'public',
    causing the LaunchScreen to show after login even for admins.

  Fix:
    Check is_admin() right after the anonymous-user guard.
    Admins always receive access_level = 'full', regardless of whitelist/waitlist.
    (is_admin is SECURITY DEFINER so it bypasses RLS safely.)
*/

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

  -- ── Admin: always full access (skip whitelist/waitlist checks) ────────────
  IF public.is_admin(v_user_id) THEN
    RETURN jsonb_build_object(
      'access_level',    'full',
      'waitlist_status', 'none',
      'is_whitelisted',  false,
      'phase',           v_mode
    );
  END IF;

  -- ── Check whitelist (by user_id or email) ─────────────────────────────────
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

  -- ── Check waitlist status ─────────────────────────────────────────────────
  SELECT status INTO v_wl_status
  FROM public.waitlist
  WHERE user_id = v_user_id OR lower(email) = v_user_email
  LIMIT 1;

  v_wl_status := COALESCE(v_wl_status, 'none');

  -- ── Resolve final access level ────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION public.get_my_launch_access() TO anon, authenticated;
