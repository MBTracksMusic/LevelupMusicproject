/*
  # Admin RPCs for Elite / Label private access actions

  Why:
  - The admin UI currently performs direct table updates from the frontend.
  - Those actions depend on table grants + RLS staying perfectly aligned.
  - A dedicated SECURITY DEFINER RPC is more robust for admin-only mutations.

  Scope:
  - Add an admin RPC to set private-access profile state on user_profiles.
  - Add an admin RPC to approve a label request atomically.
  - Keep the existing architecture and table design intact.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_private_access_profile(
  p_user_id uuid,
  p_account_type text,
  p_is_verified boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_account_type text := lower(btrim(COALESCE(p_account_type, '')));
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_admin(v_actor), false) THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required'
      USING ERRCODE = '23502';
  END IF;

  IF v_account_type NOT IN ('user', 'producer', 'elite_producer', 'label') THEN
    RAISE EXCEPTION 'invalid_account_type'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'user_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.user_profiles
  SET account_type = v_account_type,
      is_verified = COALESCE(
        p_is_verified,
        CASE
          WHEN v_account_type = 'label' THEN true
          ELSE false
        END
      )
  WHERE id = p_user_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_private_access_profile(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_private_access_profile(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_private_access_profile(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_private_access_profile(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_approve_label_request(
  p_request_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.label_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_admin(v_actor), false) THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'label_request_arguments_required'
      USING ERRCODE = '23502';
  END IF;

  SELECT *
  INTO v_request
  FROM public.label_requests lr
  WHERE lr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'label_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.user_id <> p_user_id THEN
    RAISE EXCEPTION 'label_request_user_mismatch'
      USING ERRCODE = '22023';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'label_request_not_pending'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.admin_set_private_access_profile(
    p_user_id,
    'label',
    true
  );

  UPDATE public.label_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_actor
  WHERE id = p_request_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_approve_label_request(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_approve_label_request(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_label_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_label_request(uuid, uuid) TO service_role;

COMMIT;
