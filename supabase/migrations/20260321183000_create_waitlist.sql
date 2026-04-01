-- Create public.waitlist for maintenance-page email capture.
-- Access is intended through the join-waitlist Edge Function.
-- pgcrypto is the repo standard for UUID defaults.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_key
  ON public.waitlist (email);

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at_desc
  ON public.waitlist (created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
