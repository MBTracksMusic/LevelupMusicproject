/*
  # Require active producer subscription for elite promotion

  Why:
  - Elite producer promotion should only be possible for active producers.
  - The admin UI must not be able to grant elite access to inactive producers.

  Scope:
  - Tighten the existing admin RPC used by the frontend.
  - Keep label verification and elite removal unchanged.
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
  v_target public.user_profiles%ROWTYPE;
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

  SELECT *
  INTO v_target
  FROM public.user_profiles up
  WHERE up.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_account_type = 'elite_producer' AND COALESCE(v_target.is_producer_active, false) = false THEN
    RAISE EXCEPTION 'active_producer_subscription_required'
      USING ERRCODE = '23514';
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

COMMIT;
