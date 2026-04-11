-- Migration 229: RPC pour suppression définitive d'un post forum par un admin
-- Le DELETE direct est révoqué pour le rôle authenticated (migration 100),
-- on passe donc par une fonction SECURITY DEFINER réservée aux admins.

CREATE OR REPLACE FUNCTION public.forum_admin_hard_delete_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  DELETE FROM public.forum_posts WHERE id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.forum_admin_hard_delete_post(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.forum_admin_hard_delete_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.forum_admin_hard_delete_post(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_hard_delete_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_hard_delete_post(uuid) TO service_role;
