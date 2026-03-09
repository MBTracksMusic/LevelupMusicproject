/*
  # Keep producer role aligned with active producer subscription

  Why:
  - Some users can end up with is_producer_active = true but role = 'user'.
  - Admin battle campaign apply RPC requires producer/admin role and rejects those profiles.

  What this migration does:
  1) Updates the producer subscription sync trigger function so active subscriptions promote role -> producer.
  2) Backfills existing active profiles that are still user/confirmed_user/visitor.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_user_profile_producer_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.user_profiles
    SET is_producer_active = NEW.is_producer_active,
        role = CASE
          WHEN NEW.is_producer_active = true
            AND role IS DISTINCT FROM 'admin'::public.user_role
          THEN 'producer'::public.user_role
          ELSE role
        END,
        updated_at = now()
    WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

UPDATE public.user_profiles
SET role = 'producer'::public.user_role,
    updated_at = now()
WHERE is_producer_active = true
  AND COALESCE(is_deleted, false) = false
  AND deleted_at IS NULL
  AND role IN ('visitor', 'user', 'confirmed_user');

COMMIT;
