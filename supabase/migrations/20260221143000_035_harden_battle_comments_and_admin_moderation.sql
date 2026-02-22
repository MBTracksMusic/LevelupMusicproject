/*
  # Battles comments hardening + admin moderation

  Goals:
  - Keep public read for visible comments.
  - Require confirmed users for comment insertion.
  - Allow admins to read all comments (including hidden).
  - Allow admins to moderate comments (toggle is_hidden / hidden_reason).

  Backward-compatible: policy-only changes.
*/

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can comment" ON public.battle_comments;

CREATE POLICY "Confirmed users can comment"
  ON public.battle_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_confirmed_user(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.battles
      WHERE id = battle_comments.battle_id
        AND status IN ('active', 'voting')
    )
  );

CREATE POLICY "Admins can view all battle comments"
  ON public.battle_comments
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can moderate battle comments"
  ON public.battle_comments
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMIT;
