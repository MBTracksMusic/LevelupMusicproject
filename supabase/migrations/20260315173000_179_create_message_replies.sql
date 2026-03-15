/*
  # Add admin reply thread for contact messages

  - Stores admin replies linked to contact_messages
  - Keeps strict admin-only RLS for read/insert
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.message_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.contact_messages(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reply text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_replies_message_created_at
  ON public.message_replies (message_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_message_replies_admin_id
  ON public.message_replies (admin_id);

ALTER TABLE public.message_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read message replies" ON public.message_replies;
CREATE POLICY "Admins can read message replies"
ON public.message_replies
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert message replies" ON public.message_replies;
CREATE POLICY "Admins can insert message replies"
ON public.message_replies
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin(auth.uid())
  AND admin_id = auth.uid()
);

COMMIT;
