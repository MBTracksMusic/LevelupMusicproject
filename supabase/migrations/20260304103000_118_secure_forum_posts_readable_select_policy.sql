/*
  # Secure forum_posts SELECT policy

  Goal:
  - Deleted posts must only be visible to admins or the post author.
  - Public visibility is limited to non-deleted and visible posts.
  - Keep topic/category access logic unchanged.
*/

DROP POLICY IF EXISTS "Forum posts readable"
ON public.forum_posts;

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
