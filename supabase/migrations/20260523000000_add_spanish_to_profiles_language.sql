-- Adds 'es' (Spanish) to the allowed values for user_profiles.language.
-- The previous CHECK constraint (from migration 20260125150850_001) only allowed
-- 'fr', 'en', 'de'. Postgres named it user_profiles_language_check (default name
-- for the inline CHECK at table creation).

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_language_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_language_check
  CHECK (language IN ('fr', 'en', 'de', 'es'));
