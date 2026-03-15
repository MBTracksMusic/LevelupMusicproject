/*
  # Allow authenticated users to delete their own closed contact messages

  Safe additive policy:
  - keeps admin delete policy unchanged
  - user can delete only own rows and only when status is closed
*/

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can delete own closed contact messages" ON public.contact_messages;

CREATE POLICY "Authenticated users can delete own closed contact messages"
ON public.contact_messages
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND status = 'closed'
);

COMMIT;
