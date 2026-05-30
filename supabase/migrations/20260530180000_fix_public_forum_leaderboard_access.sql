/*
  # Fix public forum and weekly leaderboard read access

  The public forum page and homepage weekly leaderboard are visitor-facing.
  Recent hardening made helper grants too narrow and converted the weekly
  leaderboard RPC/view path to invoker mode, causing anon PostgREST calls to
  fail with 401 permission errors.

  This migration keeps private tables protected while restoring the intended
  public read surface:
  - forum RLS uses a no-argument current-user admin helper instead of exposing
    arbitrary is_admin(uuid) checks to anon callers;
  - forum helper functions needed by anon RLS are explicitly executable;
  - weekly_leaderboard is exposed through a definer view/RPC wrapper.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.forum_current_user_is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE(public.is_admin(v_actor), false);
END;
$$;

REVOKE ALL ON FUNCTION public.forum_current_user_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_current_user_is_admin() FROM anon;
REVOKE ALL ON FUNCTION public.forum_current_user_is_admin() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_current_user_is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.forum_current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_current_user_is_admin() TO service_role;

GRANT EXECUTE ON FUNCTION public.forum_has_active_subscription(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forum_is_verified_label(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forum_can_access_category(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forum_user_meets_rank_requirement(uuid, text) TO anon, authenticated, service_role;

GRANT SELECT ON TABLE public.forum_categories TO anon, authenticated;
GRANT SELECT ON TABLE public.forum_topics TO anon, authenticated;

DROP POLICY IF EXISTS "Forum categories readable" ON public.forum_categories;
CREATE POLICY "Forum categories readable"
  ON public.forum_categories
  FOR SELECT
  TO anon, authenticated
  USING (
    COALESCE(is_premium_only, false) = false
    OR public.forum_has_active_subscription((SELECT auth.uid()))
    OR (
      slug = 'annonces-label'
      AND public.forum_is_verified_label((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Forum topics readable" ON public.forum_topics;
CREATE POLICY "Forum topics readable"
  ON public.forum_topics
  FOR SELECT
  TO anon, authenticated
  USING (
    public.forum_can_access_category(category_id, (SELECT auth.uid()))
    AND (
      COALESCE(is_deleted, false) = false
      OR user_id = (SELECT auth.uid())
      OR public.forum_current_user_is_admin()
    )
  );

DROP POLICY IF EXISTS "Forum posts readable" ON public.forum_posts;
CREATE POLICY "Forum posts readable"
  ON public.forum_posts
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.forum_topics ft
      WHERE ft.id = forum_posts.topic_id
        AND COALESCE(ft.is_deleted, false) = false
        AND public.forum_can_access_category(ft.category_id, (SELECT auth.uid()))
    )
    AND (
      public.forum_current_user_is_admin()
      OR forum_posts.user_id = (SELECT auth.uid())
      OR (
        COALESCE(forum_posts.is_deleted, false) = false
        AND COALESCE(forum_posts.is_visible, true) = true
      )
    )
  );

GRANT SELECT ON TABLE public.weekly_leaderboard TO anon, authenticated, service_role;
ALTER VIEW public.weekly_leaderboard SET (security_invoker = false);
ALTER FUNCTION public.get_weekly_leaderboard(integer) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(integer) TO anon, authenticated, service_role;

COMMIT;
