/*
  # Public producer profiles V2 indexes (additive)

  Improves common public profile reads without changing data contracts:
  - username lookup (case-insensitive path support)
  - active producer listing sorted by recency
  - optional tier + recency filtering
*/

BEGIN;

CREATE INDEX IF NOT EXISTS idx_user_profiles_active_lower_username
  ON public.user_profiles (lower(username))
  WHERE is_producer_active = true
    AND username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_active_updated_at_desc
  ON public.user_profiles (updated_at DESC)
  WHERE is_producer_active = true;

CREATE INDEX IF NOT EXISTS idx_user_profiles_active_tier_updated_at_desc
  ON public.user_profiles (producer_tier, updated_at DESC)
  WHERE is_producer_active = true;

COMMIT;
