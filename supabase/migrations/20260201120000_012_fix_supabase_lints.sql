/*
  # Fix Supabase lints: enforce RLS & invoker security

  - Make view public.producer_stats run as invoker so underlying table RLS applies.
  - Enable RLS and revoke broad grants on public.producer_plan_config (fail-closed).
*/

BEGIN;

-- Ensure producer_stats uses invoker rights (respects RLS of base tables)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'producer_stats' AND c.relkind = 'v'
  ) THEN
    EXECUTE 'ALTER VIEW public.producer_stats SET (security_invoker = true)';
  ELSE
    RAISE NOTICE 'View public.producer_stats not found; skipped ALTER VIEW.';
  END IF;
END
$$;

-- Fail-closed: enable RLS on producer_plan_config
DO $$
DECLARE
  table_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'producer_plan_config' AND c.relkind = 'r'
  ) INTO table_exists;

  IF table_exists THEN
    EXECUTE 'ALTER TABLE public.producer_plan_config ENABLE ROW LEVEL SECURITY';

    -- Revoke direct privileges from anon/authenticated; RLS will block anyway, but keep intent explicit
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON TABLE public.producer_plan_config FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON TABLE public.producer_plan_config FROM authenticated';
    END IF;
  ELSE
    RAISE NOTICE 'Table public.producer_plan_config not found; skipped RLS enable and REVOKE.';
  END IF;
END
$$;

COMMIT;
