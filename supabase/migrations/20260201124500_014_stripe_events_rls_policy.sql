/*
  # Stripe events table: add explicit fail-closed RLS policy

  Context:
  - Table public.stripe_events has RLS enabled but no policies -> lint "RLS Enabled No Policy".
  - This table is server-only (written/read with service_role via webhooks). service_role bypasses RLS.
  Decision:
  - Add a deny-all policy for anon/authenticated to keep data private.
  - Revoke any accidental grants to client roles.
*/

BEGIN;

DO $$
DECLARE
  t_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'stripe_events'
      AND c.relkind = 'r'
  ) INTO t_exists;

  IF NOT t_exists THEN
    RAISE NOTICE 'Table public.stripe_events not found; skipped policy.';
    RETURN;
  END IF;

  -- Revoke client grants (belt and suspenders; service_role unaffected)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.stripe_events FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.stripe_events FROM authenticated';
  END IF;

  -- Deny-all policy to satisfy lint while staying locked down
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_events'
      AND policyname = 'Stripe events deny clients'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Stripe events deny clients"
        ON public.stripe_events
        FOR ALL
        TO anon, authenticated
        USING (false)
        WITH CHECK (false);
    $policy$;
  END IF;
END
$$;

COMMIT;
