-- Migration 230: RPC pour suppression définitive d'un topic forum par un admin
-- Cascade automatique sur forum_posts via ON DELETE CASCADE.

CREATE OR REPLACE FUNCTION public.forum_admin_hard_delete_topic(p_topic_id uuid)
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

  DELETE FROM public.forum_topics WHERE id = p_topic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic_not_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.forum_admin_hard_delete_topic(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.forum_admin_hard_delete_topic(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.forum_admin_hard_delete_topic(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_hard_delete_topic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_hard_delete_topic(uuid) TO service_role;
