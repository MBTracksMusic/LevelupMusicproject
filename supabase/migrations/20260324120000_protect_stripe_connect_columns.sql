/*
  # Protect Stripe Connect columns from user manipulation

  Goals:
  - Add explicit RLS protection for stripe_account_id, stripe_account_charges_enabled, stripe_account_details_submitted, stripe_account_created_at
  - Ensure only service_role (webhooks) can update these columns
  - Prevent authenticated users from spoofing account readiness status
*/

BEGIN;

-- Recreate the RLS policy with explicit Stripe Connect column protection
DROP POLICY IF EXISTS "Owner can update own profile" ON public.user_profiles;

CREATE POLICY "Owner can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  AND COALESCE(is_deleted, false) = false
  AND deleted_at IS NULL
)
WITH CHECK (
  id = auth.uid()
  AND COALESCE(is_deleted, false) = false
  AND deleted_at IS NULL
  AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid())
  AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid())
  AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid())
  AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid())
  AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid())
  AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid())
  AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid())
  AND battle_refusal_count IS NOT DISTINCT FROM (SELECT battle_refusal_count FROM public.user_profiles WHERE id = auth.uid())
  AND battles_participated IS NOT DISTINCT FROM (SELECT battles_participated FROM public.user_profiles WHERE id = auth.uid())
  AND battles_completed IS NOT DISTINCT FROM (SELECT battles_completed FROM public.user_profiles WHERE id = auth.uid())
  AND engagement_score IS NOT DISTINCT FROM (SELECT engagement_score FROM public.user_profiles WHERE id = auth.uid())
  AND elo_rating IS NOT DISTINCT FROM (SELECT elo_rating FROM public.user_profiles WHERE id = auth.uid())
  AND battle_wins IS NOT DISTINCT FROM (SELECT battle_wins FROM public.user_profiles WHERE id = auth.uid())
  AND battle_losses IS NOT DISTINCT FROM (SELECT battle_losses FROM public.user_profiles WHERE id = auth.uid())
  AND battle_draws IS NOT DISTINCT FROM (SELECT battle_draws FROM public.user_profiles WHERE id = auth.uid())
  AND is_deleted IS NOT DISTINCT FROM (SELECT is_deleted FROM public.user_profiles WHERE id = auth.uid())
  AND deleted_at IS NOT DISTINCT FROM (SELECT deleted_at FROM public.user_profiles WHERE id = auth.uid())
  AND delete_reason IS NOT DISTINCT FROM (SELECT delete_reason FROM public.user_profiles WHERE id = auth.uid())
  AND deleted_label IS NOT DISTINCT FROM (SELECT deleted_label FROM public.user_profiles WHERE id = auth.uid())
  -- NEW: Stripe Connect columns are immutable via authenticated users
  AND stripe_account_id IS NOT DISTINCT FROM (SELECT stripe_account_id FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_account_charges_enabled IS NOT DISTINCT FROM (SELECT stripe_account_charges_enabled FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_account_details_submitted IS NOT DISTINCT FROM (SELECT stripe_account_details_submitted FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_account_created_at IS NOT DISTINCT FROM (SELECT stripe_account_created_at FROM public.user_profiles WHERE id = auth.uid())
);

COMMIT;
