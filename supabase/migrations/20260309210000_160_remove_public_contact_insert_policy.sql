/*
  # Remove direct public inserts on contact_messages

  Security hardening:
  - force all public contact writes through the contact-submit Edge Function
  - keep existing read/admin policies unchanged
*/

BEGIN;

DROP POLICY IF EXISTS "Public can insert contact messages" ON public.contact_messages;

COMMIT;
