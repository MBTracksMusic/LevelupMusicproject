/*
  # Fix function search_path warnings (Supabase lint: Function Search Path Mutable)

  Strategy:
  - Set search_path to strict `public, pg_temp` for all public plpgsql functions defined in this project.
  - Uses ALTER FUNCTION (idempotent and lightweight) — no change to logic or privileges.
  - Covers all functions found in migrations (products, battles, purchases, audit, stripe helpers, etc.).
*/

BEGIN;

-- Core helpers / triggers
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.check_user_confirmation_status() SET search_path = public, pg_temp;

-- Product & playback
ALTER FUNCTION public.generate_product_slug() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_play_count(uuid) SET search_path = public, pg_temp;

-- Battles
ALTER FUNCTION public.generate_battle_slug() SET search_path = public, pg_temp;
ALTER FUNCTION public.record_battle_vote(uuid, uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.finalize_battle(uuid) SET search_path = public, pg_temp;

-- Purchases / entitlements / locks
ALTER FUNCTION public.cleanup_expired_exclusive_locks() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_exclusive_lock(uuid, uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.complete_exclusive_purchase(uuid, uuid, text, text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.complete_standard_purchase(uuid, uuid, text, text, integer, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.user_has_entitlement(uuid, uuid) SET search_path = public, pg_temp;

-- Stripe / audit
ALTER FUNCTION public.check_stripe_event_processed(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.mark_stripe_event_processed(text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb, jsonb, inet, text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.log_preview_access(uuid, uuid, text, inet, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.can_access_exclusive_preview(uuid) SET search_path = public, pg_temp;

-- Producer subscription helpers
ALTER FUNCTION public.set_producer_subscription_flags() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_user_profile_producer_flag() SET search_path = public, pg_temp;

-- Slug generator for products (already included) and safety for other generators
ALTER FUNCTION public.generate_product_slug() SET search_path = public, pg_temp;

COMMIT;
