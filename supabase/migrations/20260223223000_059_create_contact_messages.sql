/*
  # Create contact_messages table for public support/contact flow

  Additive migration:
  - stores contact/support messages submitted from public website
  - enables admin triage (status/priority)
  - keeps strict RLS boundaries (owner read, admin full access)
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text,
  email text,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'support' CHECK (category IN ('support', 'battle', 'payment', 'partnership', 'other')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  origin_page text,
  user_agent text,
  ip_address inet
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_user_id
  ON public.contact_messages (user_id);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status
  ON public.contact_messages (status);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at_desc
  ON public.contact_messages (created_at DESC);

DROP TRIGGER IF EXISTS update_contact_messages_updated_at ON public.contact_messages;
CREATE TRIGGER update_contact_messages_updated_at
  BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can insert contact messages" ON public.contact_messages;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'contact_messages'
    AND policyname = 'Public can insert contact messages'
  ) THEN
    CREATE POLICY "Public can insert contact messages"
  ON public.contact_messages
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (
      auth.uid() IS NULL
      AND user_id IS NULL
      AND email IS NOT NULL
      AND length(btrim(email)) > 0
    )
    OR (
      auth.uid() IS NOT NULL
      AND user_id = auth.uid()
    )
  );
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can read own contact messages" ON public.contact_messages;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'contact_messages'
    AND policyname = 'Authenticated users can read own contact messages'
  ) THEN
    CREATE POLICY "Authenticated users can read own contact messages"
  ON public.contact_messages
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can read all contact messages" ON public.contact_messages;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'contact_messages'
    AND policyname = 'Admins can read all contact messages'
  ) THEN
    CREATE POLICY "Admins can read all contact messages"
  ON public.contact_messages
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can update contact messages" ON public.contact_messages;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'contact_messages'
    AND policyname = 'Admins can update contact messages'
  ) THEN
    CREATE POLICY "Admins can update contact messages"
  ON public.contact_messages
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can delete contact messages" ON public.contact_messages;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'contact_messages'
    AND policyname = 'Admins can delete contact messages'
  ) THEN
    CREATE POLICY "Admins can delete contact messages"
  ON public.contact_messages
  FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
  END IF;
END $$;

COMMIT;
