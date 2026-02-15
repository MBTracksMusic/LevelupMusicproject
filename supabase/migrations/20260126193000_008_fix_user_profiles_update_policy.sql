/*
  # Fix user_profiles update policy to allow NULL fields

  The previous policy used plain equality checks. When any of the protected
  columns (stripe ids, subscription_status, confirmed_at, producer_verified_at)
  were NULL, the condition evaluated to NULL and the UPDATE was rejected by RLS.

  This migration recreates the policy using IS NOT DISTINCT FROM so that
  unchanged NULL values still satisfy the check.
*/

-- Drop the existing update policy
DROP POLICY IF EXISTS "Users can update own profile limited fields" ON user_profiles;

-- Recreate the update policy with NULL-safe comparisons
CREATE POLICY "Users can update own profile limited fields"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    role IS NOT DISTINCT FROM (SELECT role FROM user_profiles WHERE id = auth.uid()) AND
    is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM user_profiles WHERE id = auth.uid()) AND
    stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM user_profiles WHERE id = auth.uid()) AND
    stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM user_profiles WHERE id = auth.uid()) AND
    subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM user_profiles WHERE id = auth.uid()) AND
    total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM user_profiles WHERE id = auth.uid()) AND
    confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM user_profiles WHERE id = auth.uid()) AND
    producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM user_profiles WHERE id = auth.uid())
  );
