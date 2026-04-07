/*
  # Fix Security Advisor: restore security_invoker views + function search_path

  ## Context
  Migration 20260404110055_remote_schema.sql dropped and recreated all views
  via pg_dump. pg_dump does NOT preserve the `security_invoker = true` flag,
  so all previous security_invoker fixes were silently lost.

  ## Watermarking / buyer access: ZERO RISK
  - Views expose only `watermarked_path` (public bucket `beats-watermarked` = preview audio)
  - `master_path` / `master_url` are stripped since migration 086 and absent from all views
  - Post-purchase master access is controlled exclusively by: entitlements table RLS +
    storage policies on private bucket `beats-masters` + edge function signed URLs.
    None of these views participate in that access chain.

  ## Views fixed (security_invoker = true restored)
  - my_user_profile         : already had invoker in migration 080; filters by auth.uid()
  - public_producer_profiles: already had invoker in migration 080; anon column grants on user_profiles
  - admin_battle_quality_latest: underlying table has admin-only RLS (is_admin(auth.uid()))
  - email_delivery_debug_v1 : service_role only; invoker has no risk
  - fallback_payout_monitoring: service_role only; invoker has no risk

  ## Views intentionally kept as SECURITY DEFINER (business logic requires it)
  - public_catalog_products    : explicitly security_invoker=false (migration 197);
                                 anon early_access check requires cross-table joins without
                                 per-table anon RLS on purchases
  - producer_beats_ranked      : joined by security_definer catalog; sales_count drives
                                 performance_score ranking — anon purchase RLS would zero it out
  - producer_revenue_view      : producer reads purchases of own products; no cross-user
                                 purchase RLS policy exists for producer context
  - producer_stats             : cross-table purchase aggregation, no per-role RLS
  - admin_revenue_breakdown    : admin needs full purchase + user_profile rows; no admin
                                 bypass policy on purchases table
  - fallback_payout_alerts     : same as admin_revenue_breakdown
  - admin_battle_campaigns_public: "Anyone can read" policy was dropped in migration 147_harden;
                                   no anon SELECT policy on base table
  - public_products / products_public: legacy views; behavior change risk without policy audit

  ## Function search_path warnings fixed
  - set_updated_at()
  - set_credit_purchase_claims_updated_at()
  - set_user_subscription_updated_at()
  - compute_sales_tier(integer)

  ## Remaining Security Advisor items (out of scope for this migration)
  - 9 views kept as SECURITY DEFINER (documented above; require policy work to fix safely)
  - Extension in Public (pg_net): Supabase managed infrastructure, not user-addressable
  - Leaked Password Protection Disabled: enable in Supabase Auth dashboard settings
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Restore security_invoker = true on safe views
-- ---------------------------------------------------------------------------

-- Own profile: filters WHERE up.id = auth.uid(), RLS on user_profiles applies
ALTER VIEW public.my_user_profile SET (security_invoker = true);

-- Public producer profiles: public data, anon has column-level grants on user_profiles
ALTER VIEW public.public_producer_profiles SET (security_invoker = true);

-- Admin battle quality: battle_quality_snapshots has is_admin(auth.uid()) RLS policy;
-- non-admins get 0 rows, admins get all rows — exactly correct behaviour
ALTER VIEW public.admin_battle_quality_latest SET (security_invoker = true);

-- Email delivery debug: GRANT only to service_role — invoker is safe
ALTER VIEW public.email_delivery_debug_v1 SET (security_invoker = true);

-- Fallback payout monitoring: GRANT only to service_role — invoker is safe
ALTER VIEW public.fallback_payout_monitoring SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 2. Fix function search_path mutable warnings
-- ---------------------------------------------------------------------------

-- Generic updated_at trigger (created in remote_schema 20260330)
ALTER FUNCTION public.set_updated_at()
  SET search_path = public, pg_temp;

-- updated_at trigger for credit_purchase_claims (migration 195)
ALTER FUNCTION public.set_credit_purchase_claims_updated_at()
  SET search_path = public, pg_temp;

-- updated_at trigger for user_subscriptions (migration 192)
ALTER FUNCTION public.set_user_subscription_updated_at()
  SET search_path = public, pg_temp;

-- Sales tier computation (migration 197); IMMUTABLE SQL function, no logic change
ALTER FUNCTION public.compute_sales_tier(integer)
  SET search_path = public, pg_temp;

COMMIT;
