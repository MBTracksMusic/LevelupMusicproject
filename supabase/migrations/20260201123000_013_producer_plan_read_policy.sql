/*
  # Allow read-only access to producer_plan_config for pricing page

  Context:
  - RLS was enabled and grants revoked to fail-closed.
  - Front web page fetches producer_plan_config with anon/authenticated Supabase client.
  - Table only stores public pricing data (stripe_price_id, amount, currency).
  Fix:
  - Grant SELECT to anon/authenticated and add a read-only RLS policy.
  - No insert/update/delete policy: still write-protected for client roles.
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
      AND c.relname = 'producer_plan_config'
      AND c.relkind = 'r'
  ) INTO t_exists;

  IF NOT t_exists THEN
    RAISE NOTICE 'Table public.producer_plan_config not found; skipped policy and grants.';
    RETURN;
  END IF;

  -- Minimal privilege: read-only for client roles
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.producer_plan_config TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.producer_plan_config TO authenticated';
  END IF;

  -- Idempotent creation of SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'producer_plan_config'
      AND policyname = 'Producer plan readable'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producer plan readable"
        ON public.producer_plan_config
        FOR SELECT
        TO anon, authenticated
        USING (true);
    $policy$;
  END IF;
END
$$;

COMMIT;
