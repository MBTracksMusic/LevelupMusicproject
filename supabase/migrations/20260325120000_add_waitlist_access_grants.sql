/*
  Add missing GRANT statements for waitlist table

  PROBLEM: Migration 20260321183000 enabled RLS but didn't add GRANT statements
  Result: service_role couldn't INSERT (permission denied for table waitlist)

  SOLUTION: Add table-level grants for service_role access
*/

BEGIN;

-- Allow service_role to perform all operations (INSERT needed for join-waitlist edge function)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.waitlist TO service_role;

-- Optionally: Allow anonymous read access (for displaying waitlist count on frontend)
-- GRANT SELECT ON TABLE public.waitlist TO anon, authenticated;

COMMIT;
