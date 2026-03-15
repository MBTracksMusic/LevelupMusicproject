/*
  # Allow authenticated users to read replies on their own contact messages

  Safe additive change:
  - keeps admin read/insert policies unchanged
  - grants SELECT only when reply belongs to a contact message owned by auth.uid()
*/

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can read own message replies" ON public.message_replies;

CREATE POLICY "Authenticated users can read own message replies"
ON public.message_replies
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.contact_messages cm
    WHERE cm.id = message_replies.message_id
      AND cm.user_id = auth.uid()
  )
);

COMMIT;
