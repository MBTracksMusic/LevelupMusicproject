/*
  # Secure forum_posts SELECT visibility

  Fix:
  - Remove deleted-post exposure to non-admin/non-owner users.
  - Keep category access gate unchanged.
*/

DROP POLICY IF EXISTS "Forum posts readable"
ON public.forum_posts;

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
      AND ft.is_deleted = false
      AND public.forum_can_access_category(ft.category_id, auth.uid())
  )
  AND (
    public.is_admin(auth.uid())
    OR forum_posts.user_id = auth.uid()
    OR (
      forum_posts.is_deleted = false
      AND forum_posts.is_visible = true
    )
  )
);
