/*
  # Harden SECURITY DEFINER execute grants without changing business visibility

  Supabase linter reports SECURITY DEFINER functions callable through PostgREST
  by anon/authenticated roles. This migration does not rewrite business logic or
  convert visibility-sensitive functions to SECURITY INVOKER. Instead it makes
  the existing RPC exposure model explicit:

  - public catalogue/home/profile/leaderboard RPCs stay callable by visitors.
  - authenticated user/admin/product/forum RPCs stay callable by signed-in users.
  - worker, trigger, event, email, Stripe, scheduler, and maintenance functions
    are callable only by service_role.
  - service_role keeps access to every public SECURITY DEFINER function.

  Remaining Supabase Auth "Leaked Password Protection Disabled" is a dashboard
  Auth setting, not a SQL migration setting.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Move pg_net out of public when the installed build allows relocation.
--    Some Supabase pg_net builds are not relocatable; in that case we avoid a
--    destructive drop/recreate because cron/webhook business flows use net.*.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_net'
      AND n.nspname = 'public'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'pg_net'
        AND extrelocatable = true
    ) THEN
      ALTER EXTENSION pg_net SET SCHEMA extensions;
    ELSE
      RAISE NOTICE 'pg_net is installed in public but is not relocatable on this build; leaving extension in place to avoid breaking net.* jobs.';
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Remove implicit callable-by-everyone grants from every public SECURITY
--    DEFINER function, then give service_role the baseline internal access.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn.signature);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END
$$;

-- Prevent future SECURITY DEFINER/RPC functions created by migrations from
-- inheriting PostgreSQL's default PUBLIC execute grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Re-grant visitor-visible RPCs. These power public pages and existing
--    fallbacks, so anon visibility is intentionally preserved.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _security_definer_rpc_grants (
  role_name text NOT NULL,
  function_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO _security_definer_rpc_grants (role_name, function_name)
SELECT role_name, function_name
FROM unnest(ARRAY['anon', 'authenticated']::text[]) AS roles(role_name)
CROSS JOIN unnest(ARRAY[
  'get_active_season',
  'get_active_season_details',
  'get_beats_with_priority',
  'get_forum_categories_with_stats',
  'get_forum_public_profiles_public',
  'get_home_stats',
  'get_leaderboard_producers',
  'get_producer_top_beats',
  'get_public_battle_of_the_day',
  'get_public_home_battles_preview',
  'get_public_home_featured_beats',
  'get_public_home_top_producers',
  'get_public_producer_profiles',
  'get_public_producer_profiles_soft',
  'get_public_producer_profiles_v2',
  'get_public_visible_producer_profiles',
  'get_weekly_leaderboard'
]::text[]) AS funcs(function_name);

-- ---------------------------------------------------------------------------
-- 4. Re-grant authenticated user, producer, cart, forum, battle, reputation,
--    and admin RPCs. These functions already contain their own auth.uid(),
--    service_role, or is_admin(...) guards; this keeps the existing business
--    checks in place while removing anon access.
-- ---------------------------------------------------------------------------
INSERT INTO _security_definer_rpc_grants (role_name, function_name)
SELECT 'authenticated', function_name
FROM unnest(ARRAY[
  -- Admin UI and admin Edge functions that deliberately call as the user.
  'admin_activate_founding_producer',
  'admin_adjust_reputation',
  'admin_approve_label_request',
  'admin_assign_producer_campaign',
  'admin_cancel_battle',
  'admin_delete_rejected_label_request',
  'admin_extend_battle_duration',
  'admin_get_products_for_campaign',
  'admin_launch_battle_campaign',
  'admin_list_campaign_producers',
  'admin_list_campaign_producers_safe',
  'admin_request_campaign_application_update',
  'admin_revoke_label_request',
  'admin_set_campaign_selection',
  'admin_set_private_access_profile',
  'admin_set_product_elite_status',
  'admin_unassign_producer_campaign',
  'admin_validate_battle',
  'create_new_season',
  'detect_admin_action_anomalies',
  'finalize_battle',
  'finalize_expired_battles',
  'forum_admin_delete_category',
  'forum_admin_hard_delete_post',
  'forum_admin_hard_delete_topic',
  'forum_admin_set_post_state',
  'forum_admin_set_topic_deleted',
  'forum_admin_upsert_category',
  'get_admin_business_metrics',
  'get_admin_metrics_timeseries',
  'get_admin_pilotage_deltas',
  'get_admin_pilotage_metrics',
  'is_admin',
  'mark_fallback_payout_processed',
  'reset_elo_for_new_season',
  'rpc_admin_get_beat_feedback_overview',
  'rpc_admin_get_reputation_overview',

  -- Authenticated user/product/battle flows and RLS helper functions.
  'apply_to_admin_battle_campaign',
  'assert_battle_skill_gap',
  'can_access_exclusive_preview',
  'can_create_active_battle',
  'can_create_battle',
  'can_create_product',
  'can_edit_product',
  'can_publish_beat',
  'check_daily_battle_refusals',
  'check_rpc_rate_limit',
  'cleanup_rpc_rate_limit_counters',
  'current_product_is_elite',
  'delete_my_account',
  'enqueue_audio_processing_job',
  'get_advanced_producer_stats',
  'get_battles_quota_status',
  'get_matchmaking_opponents',
  'get_my_credit_balance',
  'get_my_credit_history',
  'get_my_launch_access',
  'get_my_user_subscription_status',
  'get_plan_limits',
  'get_producer_tier',
  'get_user_battle_quota',
  'get_user_subscription_type',
  'has_producer_tier',
  'hash_request_value',
  'increment_play_count',
  'is_active_battle_opponent',
  'is_email_verified_user',
  'is_founding_trial_active',
  'log_fraud_event',
  'product_has_terminated_battle',
  'product_lineage_has_completed_sales',
  'product_lineage_has_public_marketplace_history',
  'purchase_beat_with_credits',
  'recalculate_engagement',
  'respond_to_battle',
  'rpc_archive_product',
  'rpc_compute_battle_quality_snapshot',
  'rpc_create_battle_comment',
  'rpc_create_product_version',
  'rpc_delete_product_if_no_sales',
  'rpc_get_leaderboard',
  'rpc_like_forum_post',
  'rpc_publish_product_version',
  'rpc_vote_with_feedback',
  'should_flag_battle_refusal_risk',
  'suggest_opponents',
  'user_can_add_product_to_cart',
  'user_has_elite_catalog_access',
  'user_has_entitlement',

  -- Forum/category helpers used from RLS and internal forum workflows.
  'forum_can_access_category',
  'forum_can_write_topic',
  'forum_get_user_rank_tier',
  'forum_has_active_subscription',
  'forum_is_assistant_user',
  'forum_is_verified_label',
  'forum_user_meets_rank_requirement'
]::text[]) AS funcs(function_name);

-- ---------------------------------------------------------------------------
-- 5. Apply the allowlist grants to all overloads that exist in this database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  grant_row record;
  fn record;
BEGIN
  FOR grant_row IN
    SELECT DISTINCT role_name, function_name
    FROM _security_definer_rpc_grants
  LOOP
    FOR fn IN
      SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = grant_row.function_name
        AND p.prosecdef = true
    LOOP
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO %I',
        fn.signature,
        grant_row.role_name
      );
    END LOOP;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Search-path pins for old trigger/helpers recreated by remote_schema dumps.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname = ANY (ARRAY[
        'check_user_confirmation_status',
        'handle_new_user',
        'handle_auth_user_profile_sync',
        'sync_email_confirmed_to_profile',
        'sync_user_profile_producer_flag',
        'sync_user_reputation_row',
        'touch_settings_updated_at',
        'forum_touch_updated_at',
        'reputation_touch_updated_at'
      ]::text[])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.signature);
  END LOOP;
END
$$;

COMMIT;
