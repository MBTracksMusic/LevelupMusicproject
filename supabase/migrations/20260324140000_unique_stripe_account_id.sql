/*
  # Enforce uniqueness of Stripe Connect accounts (safe production version)

  Goals:
  - Prevent multiple users sharing same Stripe account
  - Allow NULL values
  - Avoid table locking
  - Ensure performance

  Strategy:
  - Use PARTIAL UNIQUE INDEX
  - Exclude NULL values
  - Use CONCURRENTLY to avoid table locks
*/

-- IMPORTANT:
-- Do NOT wrap in BEGIN/COMMIT (required for CONCURRENTLY)

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS user_profiles_stripe_account_id_unique
ON user_profiles (stripe_account_id)
WHERE stripe_account_id IS NOT NULL;
