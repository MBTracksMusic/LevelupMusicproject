-- Adds 'es' (Spanish) to the allowed values for user_profiles.language.
-- The previous CHECK constraint (from migration 20260125150850_001) only allowed 'fr', 'en', 'de'.
-- The original constraint was declared inline at table creation, so Postgres assigned the
-- default name user_profiles_language_check. We drop it dynamically (in case the name
-- ever differed) and recreate it including 'es'.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname
    INTO constraint_name
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE c.contype = 'c'
     AND n.nspname = 'public'
     AND c.conrelid = 'public.user_profiles'::regclass
     AND pg_get_constraintdef(c.oid) ILIKE '%language%IN%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_profiles DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_language_check
  CHECK (language IN ('fr', 'en', 'de', 'es'));
