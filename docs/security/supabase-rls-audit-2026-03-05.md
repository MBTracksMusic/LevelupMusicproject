# Supabase Security Audit — RLS / Policies / Storage / SECURITY DEFINER

Generated: 2026-03-05T17:21:31.429Z
Scope: `supabase/migrations/*`, `supabase/functions/*`, `api/*`, `src/*` (RPC/storage usage cross-check).

## 1) Inventaire tables + état RLS

| Table | RLS activé ? | FORCE RLS ? | Source (migration + ligne) | Commentaire |
|---|---|---|---|---|
| public.admin_action_audit_log | YES | NO | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:17 |  |
| public.admin_notifications | YES | NO | 20260222120000_045_create_ai_admin_tables_and_policies.sql:47 |  |
| public.ai_admin_actions | YES | NO | 20260222120000_045_create_ai_admin_tables_and_policies.sql:14 |  |
| public.ai_training_feedback | YES | NO | 20260222120000_045_create_ai_admin_tables_and_policies.sql:37 |  |
| public.app_settings | YES | NO | 20260223090000_048_add_app_settings_and_battle_duration.sql:12 |  |
| public.audio_processing_jobs | YES | NO | 20260227121500_087_audio_processing_pipeline.sql:163 |  |
| public.audit_logs | YES | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:74 |  |
| public.battle_comments | YES | NO | 20260125151124_004_create_battles_schema.sql:98 |  |
| public.battle_product_snapshots | YES | NO | 20260303113000_105_create_battle_product_snapshots.sql:11 |  |
| public.battle_votes | YES | NO | 20260125151124_004_create_battles_schema.sql:87 |  |
| public.battles | YES | NO | 20260125151124_004_create_battles_schema.sql:63 |  |
| public.cart_items | YES | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:100 |  |
| public.contact_messages | YES | NO | 20260223223000_059_create_contact_messages.sql:12 |  |
| public.download_logs | YES | NO | 20260125151043_003_create_purchases_and_entitlements.sql:118 |  |
| public.elite_interest | YES | NO | 20260225130000_072_update_producer_limits.sql:21 |  |
| public.entitlements | YES | NO | 20260125151043_003_create_purchases_and_entitlements.sql:92 |  |
| public.exclusive_locks | YES | NO | 20260125151043_003_create_purchases_and_entitlements.sql:106 |  |
| public.forum_assistant_jobs | YES | NO | 20260302110000_100_forum_agents_base.sql:53 |  |
| public.forum_categories | YES | NO | 20260301163000_097_create_forum_module.sql:21 | RLS réappliqué plusieurs fois |
| public.forum_likes | YES | NO | 20260301170000_098_create_isolated_forum_module.sql:36 |  |
| public.forum_moderation_logs | YES | NO | 20260302110000_100_forum_agents_base.sql:38 |  |
| public.forum_post_likes | YES | NO | 20260301163000_097_create_forum_module.sql:55 |  |
| public.forum_posts | YES | NO | 20260301163000_097_create_forum_module.sql:45 | RLS réappliqué plusieurs fois |
| public.forum_topics | YES | NO | 20260301163000_097_create_forum_module.sql:31 | RLS réappliqué plusieurs fois |
| public.genres | YES | NO | 20260125151003_002_create_products_schema.sql:68 |  |
| public.licenses | YES | NO | 20260214210000_026_add_licenses_and_license_purchase_rpc.sql:15 |  |
| public.monitoring_alert_events | YES | NO | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:213 |  |
| public.moods | YES | NO | 20260125151003_002_create_products_schema.sql:82 |  |
| public.news_videos | YES | NO | 20260223210000_058_create_news_videos.sql:12 |  |
| public.notification_email_log | YES | NO | 20260223203000_057_add_notification_email_log_and_claim_rpc.sql:11 |  |
| public.preview_access_logs | YES | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:89 |  |
| public.producer_plan_config | YES | NO | 20260126201500_010_producer_subscription_single_plan.sql:94 | RLS activé via SQL dynamique: 20260201120000_012_fix_supabase_lints.sql:39 |
| public.producer_plans | YES | NO | 20260225110000_066_producer_plans_3_tiers.sql:10 |  |
| public.producer_subscriptions | YES | NO | 20260126201500_010_producer_subscription_single_plan.sql:10 |  |
| public.product_files | YES | NO | 20260125151003_002_create_products_schema.sql:132 |  |
| public.products | YES | NO | 20260125151003_002_create_products_schema.sql:96 | RLS réappliqué plusieurs fois |
| public.purchases | YES | NO | 20260125151043_003_create_purchases_and_entitlements.sql:71 |  |
| public.reputation_events | YES | NO | 20260303090000_102_reputation_core.sql:30 |  |
| public.reputation_rules | YES | NO | 20260303090000_102_reputation_core.sql:43 |  |
| public.rpc_rate_limit_counters | YES | NO | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:88 |  |
| public.rpc_rate_limit_hits | YES | NO | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:97 |  |
| public.rpc_rate_limit_rules | YES | NO | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:80 |  |
| public.site_audio_settings | YES | NO | 20260227121500_087_audio_processing_pipeline.sql:16 |  |
| public.stripe_events | YES | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:63 |  |
| public.user_profiles | YES | NO | 20260125150850_001_create_user_roles_and_profiles.sql:59 | RLS réappliqué plusieurs fois |
| public.user_reputation | YES | NO | 20260303090000_102_reputation_core.sql:16 |  |
| public.wishlists | YES | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:111 |  |

Tables créées puis supprimées :

| Table | Created | Dropped |
|---|---|---|
| public.elite_waitlist | 20260224143000_066_create_elite_waitlist.sql:11 | 20260225134000_074_drop_legacy_elite_waitlist.sql:9 |

## 2) Inventaire complet des policies (CREATE POLICY trouvées dans les migrations)

Total CREATE POLICY détectées: **203**

| Table | Policy | Action | To | USING | WITH CHECK | Source |
|---|---|---|---|---|---|---|
| public.user_profiles | Users can view own profile | SELECT | authenticated |  |  | 20260125150850_001_create_user_roles_and_profiles.sql:103 |
| public.user_profiles | Anyone can view producer profiles | SELECT | authenticated |  |  | 20260125150850_001_create_user_roles_and_profiles.sql:123 |
| public.user_profiles | Users can update own profile limited fields | UPDATE | authenticated | auth.uid() = id |  | 20260125150850_001_create_user_roles_and_profiles.sql:143 |
| public.genres | Anyone can view active genres | SELECT |  | is_active = true |  | 20260125151003_002_create_products_schema.sql:171 |
| public.moods | Anyone can view active moods | SELECT |  | is_active = true |  | 20260125151003_002_create_products_schema.sql:188 |
| public.products | Anyone can view published products | SELECT |  | is_published = true AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false)) |  | 20260125151003_002_create_products_schema.sql:207 |
| public.products | Producers can view own products | SELECT | authenticated | producer_id = auth.uid() |  | 20260125151003_002_create_products_schema.sql:227 |
| public.products | Active producers can create products | INSERT | authenticated |  | producer_id = auth.uid() AND EXISTS ( SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_producer_active = true ) | 20260125151003_002_create_products_schema.sql:245 |
| public.products | Producers can update own unsold products | UPDATE | authenticated | producer_id = auth.uid() AND is_sold = false | producer_id = auth.uid() | 20260125151003_002_create_products_schema.sql:270 |
| public.products | Producers can delete own unsold products | DELETE | authenticated | producer_id = auth.uid() AND is_sold = false |  | 20260125151003_002_create_products_schema.sql:294 |
| public.product_files | Producers can view own product files | SELECT | authenticated | EXISTS ( SELECT 1 FROM products WHERE products.id = product_files.product_id AND products.producer_id = auth.uid() ) |  | 20260125151003_002_create_products_schema.sql:317 |
| public.product_files | Active producers can add product files | INSERT | authenticated |  | EXISTS ( SELECT 1 FROM products p JOIN user_profiles up ON up.id = p.producer_id WHERE p.id = product_files.product_id AND p.producer_id = auth.uid() AND up.is_producer_active = true ) | 20260125151003_002_create_products_schema.sql:341 |
| public.product_files | Producers can delete own product files | DELETE | authenticated | EXISTS ( SELECT 1 FROM products WHERE products.id = product_files.product_id AND products.producer_id = auth.uid() AND products.is_sold = false ) |  | 20260125151003_002_create_products_schema.sql:367 |
| public.purchases | Users can view own purchases | SELECT | authenticated | user_id = auth.uid() |  | 20260125151043_003_create_purchases_and_entitlements.sql:163 |
| public.purchases | Producers can view sales of their products | SELECT | authenticated | producer_id = auth.uid() |  | 20260125151043_003_create_purchases_and_entitlements.sql:178 |
| public.entitlements | Users can view own entitlements | SELECT | authenticated | user_id = auth.uid() |  | 20260125151043_003_create_purchases_and_entitlements.sql:195 |
| public.exclusive_locks | Users can view own locks | SELECT | authenticated | user_id = auth.uid() |  | 20260125151043_003_create_purchases_and_entitlements.sql:212 |
| public.download_logs | Users can view own download logs | SELECT | authenticated | user_id = auth.uid() |  | 20260125151043_003_create_purchases_and_entitlements.sql:229 |
| public.battles | Anyone can view public battles | SELECT |  | status IN ('active', 'voting', 'completed') |  | 20260125151124_004_create_battles_schema.sql:141 |
| public.battles | Producers can view own battles | SELECT | authenticated | producer1_id = auth.uid() OR producer2_id = auth.uid() |  | 20260125151124_004_create_battles_schema.sql:155 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | producer1_id = auth.uid() AND EXISTS ( SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_producer_active = true ) | 20260125151124_004_create_battles_schema.sql:170 |
| public.battles | Producers can update own pending battles | UPDATE | authenticated | (producer1_id = auth.uid() OR producer2_id = auth.uid()) AND status = 'pending' | (producer1_id = auth.uid() OR producer2_id = auth.uid()) | 20260125151124_004_create_battles_schema.sql:192 |
| public.battle_votes | Anyone can view votes | SELECT |  | true |  | 20260125151124_004_create_battles_schema.sql:215 |
| public.battle_votes | Confirmed users can vote | INSERT | authenticated |  | user_id = auth.uid() AND EXISTS ( SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('confirmed_user', 'producer', 'admin') ) AND EXISTS ( SELECT 1 FROM battles WHERE id = battle_votes.battle_id AND status = 'voting' ) AND NOT EXISTS ( SELECT 1 FROM battle_votes bv WHERE bv.battle_id = battle_votes.battle_id AND bv.user_id = auth.uid() ) | 20260125151124_004_create_battles_schema.sql:229 |
| public.battle_comments | Anyone can view visible comments | SELECT |  | is_hidden = false |  | 20260125151124_004_create_battles_schema.sql:263 |
| public.battle_comments | Authenticated users can comment | INSERT | authenticated |  | user_id = auth.uid() AND EXISTS ( SELECT 1 FROM battles WHERE id = battle_comments.battle_id AND status IN ('active', 'voting') ) | 20260125151124_004_create_battles_schema.sql:277 |
| public.battle_comments | Users can update own comments | UPDATE | authenticated | user_id = auth.uid() | user_id = auth.uid() AND is_hidden = false | 20260125151124_004_create_battles_schema.sql:299 |
| public.battle_comments | Users can delete own comments | DELETE | authenticated | user_id = auth.uid() |  | 20260125151124_004_create_battles_schema.sql:315 |
| public.audit_logs | Users can view own audit logs | SELECT | authenticated | user_id = auth.uid() |  | 20260125151158_005_create_stripe_and_audit_schema.sql:169 |
| public.preview_access_logs | Users can view own preview access logs | SELECT | authenticated | user_id = auth.uid() |  | 20260125151158_005_create_stripe_and_audit_schema.sql:185 |
| public.cart_items | Users can view own cart | SELECT | authenticated | user_id = auth.uid() |  | 20260125151158_005_create_stripe_and_audit_schema.sql:200 |
| public.cart_items | Users can add to cart | INSERT | authenticated |  | user_id = auth.uid() AND EXISTS ( SELECT 1 FROM products WHERE id = cart_items.product_id AND is_published = true AND (is_exclusive = false OR is_sold = false) ) | 20260125151158_005_create_stripe_and_audit_schema.sql:214 |
| public.cart_items | Users can remove from cart | DELETE | authenticated | user_id = auth.uid() |  | 20260125151158_005_create_stripe_and_audit_schema.sql:236 |
| public.wishlists | Users can view own wishlist | SELECT | authenticated | user_id = auth.uid() |  | 20260125151158_005_create_stripe_and_audit_schema.sql:251 |
| public.wishlists | Users can add to wishlist | INSERT | authenticated |  | user_id = auth.uid() | 20260125151158_005_create_stripe_and_audit_schema.sql:265 |
| public.wishlists | Users can remove from wishlist | DELETE | authenticated | user_id = auth.uid() |  | 20260125151158_005_create_stripe_and_audit_schema.sql:279 |
| public.user_profiles | Auth service can insert profiles | INSERT | supabase_auth_admin, service_role |  | true | 20260125153600_006_user_profiles_insert_policy.sql:22 |
| public.user_profiles | Authenticated can insert own profile | INSERT | authenticated |  | auth.uid() = id | 20260125153600_006_user_profiles_insert_policy.sql:40 |
| public.user_profiles | Auth service can insert profiles | INSERT | supabase_auth_admin, service_role |  | true | 20260125175303_006_user_profiles_insert_policy.sql:22 |
| public.user_profiles | Authenticated can insert own profile | INSERT | authenticated |  | auth.uid() = id | 20260125175303_006_user_profiles_insert_policy.sql:40 |
| public.user_profiles | Users can update own profile limited fields | UPDATE | authenticated | auth.uid() = id | auth.uid() = id AND role IS NOT DISTINCT FROM (SELECT role FROM user_profiles WHERE id = auth.uid()) AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM user_profiles WHERE id = auth.uid()) AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM user_profiles WHERE id = auth.uid()) AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM user_profiles WHERE id = auth.uid()) AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM user_profiles WHERE id = auth.uid()) AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM user_profiles WHERE id = auth.uid()) AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM user_profiles WHERE id = auth.uid()) AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM user_profiles WHERE id = auth.uid()) | 20260126193000_008_fix_user_profiles_update_policy.sql:23 |
| public.producer_subscriptions | Producer subscriptions: owner can read | SELECT | authenticated | auth.uid() = user_id |  | 20260126201500_010_producer_subscription_single_plan.sql:78 |
| public.producer_plan_config | Producer plan readable | SELECT | anon, authenticated | true |  | 20260201123000_013_producer_plan_read_policy.sql:49 |
| public.stripe_events | Stripe events deny clients | ALL | anon, authenticated | false | false | 20260201124500_014_stripe_events_rls_policy.sql:48 |
| public.user_profiles | Admins can view all profiles | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260201130000_015_grant_admin_role.sql:43 |
| storage.objects | Producers can upload audio | INSERT | authenticated |  | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:89 |
| storage.objects | Producers can update their audio | UPDATE | authenticated | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:109 |
| storage.objects | Producers can delete their audio | DELETE | authenticated | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' |  | 20260207120000_017_create_storage_buckets.sql:135 |
| storage.objects | Producers can read their audio | SELECT | authenticated | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) |  | 20260207120000_017_create_storage_buckets.sql:155 |
| storage.objects | Producers can upload covers | INSERT | authenticated |  | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:191 |
| storage.objects | Producers can update their covers | UPDATE | authenticated | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:211 |
| storage.objects | Producers can delete their covers | DELETE | authenticated | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' |  | 20260207120000_017_create_storage_buckets.sql:237 |
| storage.objects | Anyone can view covers | SELECT | anon, authenticated | bucket_id = 'beats-covers' |  | 20260207120000_017_create_storage_buckets.sql:257 |
| storage.objects | Authenticated users can read beats audio | SELECT | authenticated | bucket_id = 'beats-audio' |  | 20260213110000_018_allow_authenticated_audio_read.sql:34 |
| public.products | Buyers can view purchased products | SELECT | authenticated | EXISTS ( SELECT 1 FROM public.entitlements e WHERE e.product_id = products.id AND e.user_id = auth.uid() AND e.is_active = true AND (e.expires_at IS NULL OR e.expires_at > now()) ) |  | 20260213123000_019_allow_buyers_view_purchased_products.sql:21 |
| storage.objects | Buyers can read own contracts | SELECT | authenticated | bucket_id = 'contracts' AND EXISTS ( SELECT 1 FROM public.purchases p WHERE p.user_id = auth.uid() AND p.contract_pdf_path IS NOT NULL AND p.contract_pdf_path = storage.objects.name ) |  | 20260214143000_020_add_contract_pdf_and_contracts_bucket.sql:61 |
| storage.objects | Authenticated users can read beats audio | SELECT | authenticated | bucket_id = 'beats-audio' |  | 20260214193000_025_rollback_to_pre_023_024_audio_model.sql:69 |
| storage.objects | Producers can read their audio | SELECT | authenticated | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) |  | 20260214193000_025_rollback_to_pre_023_024_audio_model.sql:83 |
| public.licenses | Anyone can read licenses | SELECT | anon, authenticated | true |  | 20260214210000_026_add_licenses_and_license_purchase_rpc.sql:44 |
| public.products | Producers can delete own unsold products | DELETE | authenticated | producer_id = auth.uid() AND is_sold = false AND NOT EXISTS ( SELECT 1 FROM public.purchases WHERE purchases.product_id = products.id ) |  | 20260220120000_028_block_product_delete_when_purchased.sql:20 |
| public.products | Anyone can view published products | SELECT |  | deleted_at IS NULL AND is_published = true AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false)) |  | 20260220123000_029_soft_delete_products.sql:26 |
| public.products | Producers can view own products | SELECT | authenticated | deleted_at IS NULL AND producer_id = auth.uid() |  | 20260220123000_029_soft_delete_products.sql:45 |
| public.user_profiles | Users can update own profile limited fields | UPDATE | authenticated | auth.uid() = id | auth.uid() = id AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid()) AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid()) AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid()) AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid()) AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid()) AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid()) AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid()) AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid()) AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid()) | 20260221120000_030_add_is_confirmed_flag_and_compat.sql:64 |
| public.battle_votes | Confirmed users can vote | INSERT | authenticated |  | user_id = auth.uid() AND public.is_confirmed_user(auth.uid()) AND EXISTS ( SELECT 1 FROM public.battles WHERE id = battle_votes.battle_id AND status = 'voting' ) AND NOT EXISTS ( SELECT 1 FROM public.battle_votes bv WHERE bv.battle_id = battle_votes.battle_id AND bv.user_id = auth.uid() ) | 20260221123000_031_use_is_confirmed_helper_for_access.sql:22 |
| public.battle_votes | Confirmed users can vote | INSERT | authenticated |  | user_id = auth.uid() AND public.is_confirmed_user(auth.uid()) AND voted_for_producer_id != auth.uid() AND EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_votes.battle_id AND b.status = 'voting' ) AND NOT EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_votes.battle_id AND ( b.producer1_id = auth.uid() OR b.producer2_id = auth.uid() ) ) AND NOT EXISTS ( SELECT 1 FROM public.battle_votes bv WHERE bv.battle_id = battle_votes.battle_id AND bv.user_id = auth.uid() ) | 20260221130000_032_prevent_battle_vote_conflicts.sql:22 |
| public.battle_votes | Confirmed users can vote | INSERT | authenticated |  | user_id = auth.uid() AND public.is_confirmed_user(auth.uid()) AND voted_for_producer_id != auth.uid() AND EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_votes.battle_id AND b.status IN ('active', 'voting') AND b.producer1_id IS NOT NULL AND b.producer2_id IS NOT NULL AND ( voted_for_producer_id = b.producer1_id OR voted_for_producer_id = b.producer2_id ) AND auth.uid() != b.producer1_id AND auth.uid() != b.producer2_id ) AND NOT EXISTS ( SELECT 1 FROM public.battle_votes bv WHERE bv.battle_id = battle_votes.battle_id AND bv.user_id = auth.uid() ) | 20260221140000_034_secure_battles_vote_rpc_and_execute.sql:45 |
| public.battle_comments | Confirmed users can comment | INSERT | authenticated |  | user_id = auth.uid() AND public.is_confirmed_user(auth.uid()) AND EXISTS ( SELECT 1 FROM public.battles WHERE id = battle_comments.battle_id AND status IN ('active', 'voting') ) | 20260221143000_035_harden_battle_comments_and_admin_moderation.sql:24 |
| public.battle_comments | Admins can view all battle comments | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260221143000_035_harden_battle_comments_and_admin_moderation.sql:48 |
| public.battle_comments | Admins can moderate battle comments | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260221143000_035_harden_battle_comments_and_admin_moderation.sql:63 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | producer1_id = auth.uid() AND status = 'pending' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND ( producer2_id IS NULL OR producer2_id != auth.uid() ) AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND ( producer2_id IS NULL OR EXISTS ( SELECT 1 FROM public.user_profiles up2 WHERE up2.id = producer2_id AND up2.is_producer_active = true ) ) AND ( product1_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p1 WHERE p1.id = product1_id AND p1.producer_id = auth.uid() AND p1.deleted_at IS NULL ) ) AND ( product2_id IS NULL OR ( producer2_id IS NOT NULL AND EXISTS ( SELECT 1 FROM public.products p2 WHERE p2.id = product2_id AND p2.producer_id = producer2_id AND p2.deleted_at IS NULL ) ) ) | 20260221150000_036_add_battles_management_rpc_and_admin_policies.sql:27 |
| public.battles | Admins can view all battles | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260221150000_036_add_battles_management_rpc_and_admin_policies.sql:95 |
| public.battles | Admins can update all battles | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260221150000_036_add_battles_management_rpc_and_admin_policies.sql:113 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | producer1_id = auth.uid() AND producer2_id IS NOT NULL AND producer1_id != producer2_id AND status = 'pending_acceptance' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND accepted_at IS NULL AND rejected_at IS NULL AND admin_validated_at IS NULL AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND EXISTS ( SELECT 1 FROM public.user_profiles up2 WHERE up2.id = producer2_id AND up2.is_producer_active = true ) AND ( product1_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p1 WHERE p1.id = product1_id AND p1.producer_id = auth.uid() AND p1.deleted_at IS NULL ) ) AND ( product2_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p2 WHERE p2.id = product2_id AND p2.producer_id = producer2_id AND p2.deleted_at IS NULL ) ) | 20260221161000_039_enforce_pending_acceptance_on_battle_creation.sql:22 |
| public.battle_votes | Confirmed users can vote | INSERT | authenticated |  | user_id = auth.uid() AND public.is_confirmed_user(auth.uid()) AND voted_for_producer_id != auth.uid() AND EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_votes.battle_id AND b.status = 'active' AND b.producer1_id IS NOT NULL AND b.producer2_id IS NOT NULL AND ( voted_for_producer_id = b.producer1_id OR voted_for_producer_id = b.producer2_id ) AND auth.uid() != b.producer1_id AND auth.uid() != b.producer2_id ) AND NOT EXISTS ( SELECT 1 FROM public.battle_votes bv WHERE bv.battle_id = battle_votes.battle_id AND bv.user_id = auth.uid() ) | 20260221164000_042_harden_active_vote_only_and_completion_engagement.sql:21 |
| public.battles | Producers can update own pending battles | UPDATE | authenticated | (producer1_id = auth.uid() OR producer2_id = auth.uid()) AND status = 'pending' | (producer1_id = auth.uid() OR producer2_id = auth.uid()) AND status = 'pending' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND accepted_at IS NULL AND rejected_at IS NULL AND admin_validated_at IS NULL | 20260221165000_043_harden_producer_battle_update_policy.sql:21 |
| public.battle_votes | Confirmed users can vote | INSERT | authenticated |  | user_id = auth.uid() AND public.is_email_verified_user(auth.uid()) AND voted_for_producer_id != auth.uid() AND EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_votes.battle_id AND b.status = 'active' AND b.producer1_id IS NOT NULL AND b.producer2_id IS NOT NULL AND ( voted_for_producer_id = b.producer1_id OR voted_for_producer_id = b.producer2_id ) AND auth.uid() != b.producer1_id AND auth.uid() != b.producer2_id ) AND NOT EXISTS ( SELECT 1 FROM public.battle_votes bv WHERE bv.battle_id = battle_votes.battle_id AND bv.user_id = auth.uid() ) | 20260222110000_044_allow_email_verified_votes_and_comments.sql:50 |
| public.battle_comments | Confirmed users can comment | INSERT | authenticated |  | user_id = auth.uid() AND public.is_email_verified_user(auth.uid()) AND EXISTS ( SELECT 1 FROM public.battles WHERE id = battle_comments.battle_id AND status IN ('active', 'voting') ) | 20260222110000_044_allow_email_verified_votes_and_comments.sql:92 |
| public.ai_admin_actions | Admins can read ai admin actions | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260222120000_045_create_ai_admin_tables_and_policies.sql:83 |
| public.ai_admin_actions | Admins can insert ai admin actions | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260222120000_045_create_ai_admin_tables_and_policies.sql:98 |
| public.ai_admin_actions | Admins can update ai admin actions | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260222120000_045_create_ai_admin_tables_and_policies.sql:113 |
| public.ai_training_feedback | Admins can read ai training feedback | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260222120000_045_create_ai_admin_tables_and_policies.sql:133 |
| public.ai_training_feedback | Admins can insert ai training feedback | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260222120000_045_create_ai_admin_tables_and_policies.sql:148 |
| public.ai_training_feedback | Admins can update ai training feedback | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260222120000_045_create_ai_admin_tables_and_policies.sql:163 |
| public.admin_notifications | Admins can read own notifications | SELECT | authenticated | user_id = auth.uid() AND public.is_admin(auth.uid()) |  | 20260222120000_045_create_ai_admin_tables_and_policies.sql:182 |
| public.admin_notifications | Admins can update own notifications | UPDATE | authenticated | user_id = auth.uid() AND public.is_admin(auth.uid()) | user_id = auth.uid() AND public.is_admin(auth.uid()) | 20260222120000_045_create_ai_admin_tables_and_policies.sql:197 |
| public.app_settings | Anyone can read app settings | SELECT | anon, authenticated | true |  | 20260223090000_048_add_app_settings_and_battle_duration.sql:31 |
| public.app_settings | Admins can insert app settings | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260223090000_048_add_app_settings_and_battle_duration.sql:46 |
| public.app_settings | Admins can update app settings | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260223090000_048_add_app_settings_and_battle_duration.sql:61 |
| public.battle_votes | Admins can read all battle votes | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223130000_052_restrict_battle_votes_select_policy.sql:23 |
| public.battle_votes | Users can read own battle votes | SELECT | authenticated | user_id = auth.uid() |  | 20260223130000_052_restrict_battle_votes_select_policy.sql:38 |
| public.admin_action_audit_log | Admins can read centralized admin action audit log | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:69 |
| public.rpc_rate_limit_rules | Admins can read rpc rate limit rules | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:131 |
| public.rpc_rate_limit_rules | Admins can insert rpc rate limit rules | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:146 |
| public.rpc_rate_limit_rules | Admins can update rpc rate limit rules | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:161 |
| public.rpc_rate_limit_counters | Admins can read rpc rate limit counters | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:177 |
| public.rpc_rate_limit_hits | Admins can read rpc rate limit hits | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:192 |
| public.monitoring_alert_events | Admins can read monitoring alert events | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:245 |
| public.monitoring_alert_events | Admins can update monitoring alert events | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:260 |
| public.notification_email_log | Service role can manage notification email log | ALL | service_role | true | true | 20260223203000_057_add_notification_email_log_and_claim_rpc.sql:40 |
| public.news_videos | Public can read published news videos | SELECT | anon, authenticated | is_published = true |  | 20260223210000_058_create_news_videos.sql:48 |
| public.news_videos | Admins can read all news videos | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223210000_058_create_news_videos.sql:64 |
| public.news_videos | Admins can insert news videos | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260223210000_058_create_news_videos.sql:80 |
| public.news_videos | Admins can update news videos | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260223210000_058_create_news_videos.sql:96 |
| public.news_videos | Admins can delete news videos | DELETE | authenticated | public.is_admin(auth.uid()) |  | 20260223210000_058_create_news_videos.sql:113 |
| public.contact_messages | Public can insert contact messages | INSERT | anon, authenticated |  | ( auth.uid() IS NULL AND user_id IS NULL AND email IS NOT NULL AND length(btrim(email)) > 0 ) OR ( auth.uid() IS NOT NULL AND user_id = auth.uid() ) | 20260223223000_059_create_contact_messages.sql:54 |
| public.contact_messages | Authenticated users can read own contact messages | SELECT | authenticated | user_id = auth.uid() |  | 20260223223000_059_create_contact_messages.sql:81 |
| public.contact_messages | Admins can read all contact messages | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260223223000_059_create_contact_messages.sql:97 |
| public.contact_messages | Admins can update contact messages | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260223223000_059_create_contact_messages.sql:113 |
| public.contact_messages | Admins can delete contact messages | DELETE | authenticated | public.is_admin(auth.uid()) |  | 20260223223000_059_create_contact_messages.sql:130 |
| public.products | Active producers can create products | INSERT | authenticated |  | producer_id = auth.uid() AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND public.can_create_product(auth.uid()) | 20260224133000_065_attach_tier_limits_to_insert_policies.sql:25 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | producer1_id = auth.uid() AND producer2_id IS NOT NULL AND producer1_id != producer2_id AND status = 'pending_acceptance' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND accepted_at IS NULL AND rejected_at IS NULL AND admin_validated_at IS NULL AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND public.can_create_battle(auth.uid()) AND EXISTS ( SELECT 1 FROM public.user_profiles up2 WHERE up2.id = producer2_id AND up2.is_producer_active = true ) AND ( product1_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p1 WHERE p1.id = product1_id AND p1.producer_id = auth.uid() AND p1.deleted_at IS NULL ) ) AND ( product2_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p2 WHERE p2.id = product2_id AND p2.producer_id = producer2_id AND p2.deleted_at IS NULL ) ) | 20260224133000_065_attach_tier_limits_to_insert_policies.sql:45 |
| public.elite_waitlist | Authenticated can insert elite waitlist | INSERT | authenticated |  | auth.uid() IS NOT NULL AND user_id = auth.uid() AND length(btrim(email)) > 0 | 20260224143000_066_create_elite_waitlist.sql:27 |
| public.elite_waitlist | Anonymous can insert elite waitlist | INSERT | anon |  | auth.uid() IS NULL AND user_id IS NULL AND length(btrim(email)) > 0 | 20260224143000_066_create_elite_waitlist.sql:38 |
| public.elite_waitlist | Anonymous can insert elite waitlist | INSERT | anon |  | user_id IS NULL AND length(btrim(email)) > 0 | 20260224144000_067_fix_elite_waitlist_anon_policy.sql:12 |
| public.producer_plans | Anyone can view active producer plans | SELECT |  | is_active = true |  | 20260225110000_066_producer_plans_3_tiers.sql:43 |
| public.products | Active producers can create products | INSERT | authenticated |  | producer_id = auth.uid() AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND ( NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL) OR public.can_publish_beat(auth.uid(), NULL) ) | 20260225111000_067_enforce_beats_quota_insert_update.sql:151 |
| public.products | Producers can update own unsold products | UPDATE | authenticated | producer_id = auth.uid() AND is_sold = false | producer_id = auth.uid() AND is_sold = false AND ( NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL) OR public.can_publish_beat(auth.uid(), id) ) | 20260225111000_067_enforce_beats_quota_insert_update.sql:170 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | producer1_id = auth.uid() AND producer2_id IS NOT NULL AND producer1_id != producer2_id AND status = 'pending_acceptance' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND accepted_at IS NULL AND rejected_at IS NULL AND admin_validated_at IS NULL AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND public.can_create_battle(auth.uid()) AND EXISTS ( SELECT 1 FROM public.user_profiles up2 WHERE up2.id = producer2_id AND up2.is_producer_active = true ) AND ( product1_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p1 WHERE p1.id = product1_id AND p1.producer_id = auth.uid() AND p1.deleted_at IS NULL ) ) AND ( product2_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p2 WHERE p2.id = product2_id AND p2.producer_id = producer2_id AND p2.deleted_at IS NULL ) ) | 20260225112000_068_enforce_battles_quota_and_created_at.sql:61 |
| public.user_profiles | Users can update own profile limited fields | UPDATE | authenticated | auth.uid() = id | auth.uid() = id AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid()) AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid()) AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid()) AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid()) AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid()) AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid()) AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid()) AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid()) AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid()) AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid()) | 20260225113000_069_lock_producer_tier.sql:11 |
| public.elite_interest | Elite interest insertable | INSERT | anon, authenticated |  | length(trim(email)) > 3 | 20260225130000_072_update_producer_limits.sql:42 |
| public.user_profiles | Public can view producer public profile | SELECT | anon, authenticated | is_producer_active = true |  | 20260226100000_076_public_producer_profiles_anon.sql:12 |
| storage.objects | Users can upload avatars | INSERT | authenticated |  | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' | 20260226104000_077_add_avatars_bucket_and_policies.sql:56 |
| storage.objects | Users can update own avatars | UPDATE | authenticated | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' | 20260226104000_077_add_avatars_bucket_and_policies.sql:66 |
| storage.objects | Users can delete own avatars | DELETE | authenticated | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' |  | 20260226104000_077_add_avatars_bucket_and_policies.sql:81 |
| storage.objects | Anyone can view avatars | SELECT | anon, authenticated | bucket_id = 'avatars' |  | 20260226104000_077_add_avatars_bucket_and_policies.sql:91 |
| public.user_profiles | Public can view producer public profile | SELECT | anon | is_producer_active = true |  | 20260226123000_077_secure_public_profiles_view_and_policies.sql:46 |
| public.products | Producers can update own unsold products | UPDATE | authenticated | producer_id = auth.uid() AND is_sold = false AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) | producer_id = auth.uid() AND is_sold = false AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND ( NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL) OR public.can_publish_beat(auth.uid(), id) ) | 20260226124000_078_require_active_producer_for_product_updates.sql:12 |
| public.user_profiles | Public can view producer public profile | SELECT | anon | is_producer_active = true |  | 20260226133000_080_fix_security_definer_views.sql:18 |
| public.user_profiles | Owner can select own profile | SELECT | authenticated | id = auth.uid() |  | 20260226140000_081_make_user_profiles_private.sql:30 |
| public.user_profiles | Owner can update own profile | UPDATE | authenticated | id = auth.uid() | id = auth.uid() AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid()) AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid()) AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid()) AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid()) AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid()) AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid()) AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid()) AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid()) AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid()) AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid()) | 20260226140000_081_make_user_profiles_private.sql:36 |
| public.user_profiles | Owner can insert own profile | INSERT | authenticated |  | id = auth.uid() | 20260226140000_081_make_user_profiles_private.sql:55 |
| storage.objects | Producers can upload masters | INSERT | authenticated |  | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260227103000_086_secure_master_access_and_storage_split.sql:208 |
| storage.objects | Producers can update own masters | UPDATE | authenticated | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260227103000_086_secure_master_access_and_storage_split.sql:219 |
| storage.objects | Producers can delete own masters | DELETE | authenticated | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' |  | 20260227103000_086_secure_master_access_and_storage_split.sql:236 |
| storage.objects | Public can read watermarked audio | SELECT | anon, authenticated | bucket_id = 'beats-watermarked' |  | 20260227103000_086_secure_master_access_and_storage_split.sql:247 |
| public.site_audio_settings | Admins can view site audio settings | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260227121500_087_audio_processing_pipeline.sql:41 |
| public.site_audio_settings | Admins can insert site audio settings | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260227121500_087_audio_processing_pipeline.sql:47 |
| public.site_audio_settings | Admins can update site audio settings | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260227121500_087_audio_processing_pipeline.sql:53 |
| public.site_audio_settings | Admins can delete site audio settings | DELETE | authenticated | public.is_admin(auth.uid()) |  | 20260227121500_087_audio_processing_pipeline.sql:60 |
| public.audio_processing_jobs | Admins can view audio processing jobs | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260227121500_087_audio_processing_pipeline.sql:195 |
| storage.objects | Admins can read watermark assets | SELECT | authenticated | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) |  | 20260227121500_087_audio_processing_pipeline.sql:524 |
| storage.objects | Admins can upload watermark assets | INSERT | authenticated |  | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' | 20260227121500_087_audio_processing_pipeline.sql:533 |
| storage.objects | Admins can update watermark assets | UPDATE | authenticated | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' | 20260227121500_087_audio_processing_pipeline.sql:543 |
| storage.objects | Admins can delete watermark assets | DELETE | authenticated | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' |  | 20260227121500_087_audio_processing_pipeline.sql:558 |
| public.products | Anyone can view published products | SELECT |  | deleted_at IS NULL AND status = 'active' AND is_published = true AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false)) |  | 20260301133000_091_add_marketplace_beat_lifecycle.sql:205 |
| public.products | Producers can view own products | SELECT | authenticated | deleted_at IS NULL AND producer_id = auth.uid() |  | 20260301133000_091_add_marketplace_beat_lifecycle.sql:216 |
| public.products | Buyers can view purchased products | SELECT | authenticated | deleted_at IS NULL AND EXISTS ( SELECT 1 FROM public.purchases pu WHERE pu.product_id = products.id AND pu.user_id = auth.uid() AND pu.status IN ('completed', 'refunded') ) |  | 20260301133000_091_add_marketplace_beat_lifecycle.sql:226 |
| public.products | Producers can update own unsold products | UPDATE | authenticated | producer_id = auth.uid() AND NOT EXISTS ( SELECT 1 FROM public.purchases pu WHERE pu.product_id = products.id AND pu.status IN ('completed', 'refunded') ) | producer_id = auth.uid() | 20260301133000_091_add_marketplace_beat_lifecycle.sql:242 |
| public.products | Public can view active products | SELECT |  | deleted_at IS NULL AND status = 'active' AND is_published = true AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false)) |  | 20260301140000_092_fix_products_select_policies_and_grants.sql:24 |
| public.products | Producer can view own products | SELECT | authenticated | auth.uid() = producer_id AND deleted_at IS NULL |  | 20260301140000_092_fix_products_select_policies_and_grants.sql:36 |
| public.products | Buyers can view purchased products | SELECT | authenticated | deleted_at IS NULL AND EXISTS ( SELECT 1 FROM public.purchases pu WHERE pu.product_id = products.id AND pu.user_id = auth.uid() AND pu.status IN ('completed', 'refunded') ) |  | 20260301140000_092_fix_products_select_policies_and_grants.sql:46 |
| public.products | Public can view active products | SELECT | anon, authenticated | deleted_at IS NULL AND status = 'active' AND ( is_published IS DISTINCT FROM false ) AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false)) |  | 20260301143000_093_product_versioning_self_root.sql:236 |
| public.products | Producer can view own products | SELECT | authenticated | auth.uid() = producer_id AND deleted_at IS NULL |  | 20260301143000_093_product_versioning_self_root.sql:251 |
| public.products | Buyers can view purchased products | SELECT | authenticated | deleted_at IS NULL AND EXISTS ( SELECT 1 FROM public.purchases pu WHERE pu.product_id = products.id AND pu.user_id = auth.uid() AND pu.status IN ('completed', 'refunded') ) |  | 20260301143000_093_product_versioning_self_root.sql:261 |
| public.products | Producers can update own unsold products | UPDATE | authenticated | producer_id = auth.uid() AND deleted_at IS NULL AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND NOT EXISTS ( SELECT 1 FROM public.purchases pu WHERE pu.product_id = products.id AND pu.status IN ('completed', 'refunded') ) | producer_id = auth.uid() AND deleted_at IS NULL AND EXISTS ( SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_producer_active = true ) AND NOT EXISTS ( SELECT 1 FROM public.purchases pu WHERE pu.product_id = products.id AND pu.status IN ('completed', 'refunded') ) AND ( NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL) OR public.can_publish_beat(auth.uid(), id) ) | 20260301153000_095_add_product_editability_rules.sql:121 |
| public.forum_categories | Forum categories readable | SELECT | anon, authenticated | is_premium_only = false OR public.forum_has_active_subscription(auth.uid()) |  | 20260301163000_097_create_forum_module.sql:296 |
| public.forum_topics | Forum topics readable | SELECT | anon, authenticated | public.forum_can_access_category(category_id, auth.uid()) |  | 20260301163000_097_create_forum_module.sql:309 |
| public.forum_topics | Authenticated users can create forum topics | INSERT | authenticated |  | user_id = auth.uid() AND public.forum_can_access_category(category_id, auth.uid()) | 20260301163000_097_create_forum_module.sql:318 |
| public.forum_topics | Authors or admins can delete forum topics | DELETE | authenticated | user_id = auth.uid() OR public.is_admin(auth.uid()) |  | 20260301163000_097_create_forum_module.sql:328 |
| public.forum_posts | Forum posts readable | SELECT | anon, authenticated | EXISTS ( SELECT 1 FROM public.forum_topics ft WHERE ft.id = forum_posts.topic_id AND public.forum_can_access_category(ft.category_id, auth.uid()) ) |  | 20260301163000_097_create_forum_module.sql:341 |
| public.forum_posts | Authenticated users can create forum posts | INSERT | authenticated |  | user_id = auth.uid() AND public.forum_can_write_topic(topic_id, auth.uid()) | 20260301163000_097_create_forum_module.sql:355 |
| public.forum_posts | Authors or admins can edit forum posts | UPDATE | authenticated | ( user_id = auth.uid() AND EXISTS ( SELECT 1 FROM public.forum_topics ft WHERE ft.id = forum_posts.topic_id AND ft.is_locked = false ) ) OR public.is_admin(auth.uid()) | ( user_id = auth.uid() AND public.forum_can_write_topic(topic_id, auth.uid()) ) OR public.is_admin(auth.uid()) | 20260301163000_097_create_forum_module.sql:365 |
| public.forum_posts | Authors or admins can delete forum posts | DELETE | authenticated | user_id = auth.uid() OR public.is_admin(auth.uid()) |  | 20260301163000_097_create_forum_module.sql:390 |
| public.forum_post_likes | Forum post likes readable | SELECT | anon, authenticated | EXISTS ( SELECT 1 FROM public.forum_posts fp JOIN public.forum_topics ft ON ft.id = fp.topic_id WHERE fp.id = forum_post_likes.post_id AND public.forum_can_access_category(ft.category_id, auth.uid()) ) |  | 20260301163000_097_create_forum_module.sql:403 |
| public.forum_post_likes | Authenticated users can like forum posts | INSERT | authenticated |  | user_id = auth.uid() AND EXISTS ( SELECT 1 FROM public.forum_posts fp JOIN public.forum_topics ft ON ft.id = fp.topic_id WHERE fp.id = forum_post_likes.post_id AND fp.is_deleted = false AND public.forum_can_write_topic(ft.id, auth.uid()) ) | 20260301163000_097_create_forum_module.sql:418 |
| public.forum_post_likes | Users or admins can unlike forum posts | DELETE | authenticated | user_id = auth.uid() OR public.is_admin(auth.uid()) |  | 20260301163000_097_create_forum_module.sql:435 |
| public.forum_categories | Forum categories are publicly readable | SELECT | anon, authenticated | true |  | 20260301170000_098_create_isolated_forum_module.sql:133 |
| public.forum_topics | Forum topics are publicly readable | SELECT | anon, authenticated | true |  | 20260301170000_098_create_isolated_forum_module.sql:140 |
| public.forum_topics | Authenticated users can create forum topics | INSERT | authenticated |  | auth.uid() = user_id | 20260301170000_098_create_isolated_forum_module.sql:147 |
| public.forum_topics | Owners can update forum topics | UPDATE | authenticated | auth.uid() = user_id | auth.uid() = user_id | 20260301170000_098_create_isolated_forum_module.sql:154 |
| public.forum_topics | Owners or admins can delete forum topics | DELETE | authenticated | auth.uid() = user_id OR public.is_admin(auth.uid()) |  | 20260301170000_098_create_isolated_forum_module.sql:162 |
| public.forum_posts | Forum posts are publicly readable | SELECT | anon, authenticated | true |  | 20260301170000_098_create_isolated_forum_module.sql:169 |
| public.forum_posts | Authenticated users can create forum posts | INSERT | authenticated |  | auth.uid() = user_id | 20260301170000_098_create_isolated_forum_module.sql:176 |
| public.forum_posts | Owners can update forum posts | UPDATE | authenticated | auth.uid() = user_id | auth.uid() = user_id | 20260301170000_098_create_isolated_forum_module.sql:183 |
| public.forum_posts | Owners or admins can delete forum posts | DELETE | authenticated | auth.uid() = user_id OR public.is_admin(auth.uid()) |  | 20260301170000_098_create_isolated_forum_module.sql:191 |
| public.forum_likes | Forum likes are publicly readable | SELECT | anon, authenticated | true |  | 20260301170000_098_create_isolated_forum_module.sql:198 |
| public.forum_likes | Authenticated users can like forum posts | INSERT | authenticated |  | auth.uid() = user_id | 20260301170000_098_create_isolated_forum_module.sql:205 |
| public.forum_likes | Owners or admins can delete forum likes | DELETE | authenticated | auth.uid() = user_id OR public.is_admin(auth.uid()) |  | 20260301170000_098_create_isolated_forum_module.sql:212 |
| public.forum_categories | Authenticated admins can create forum categories | INSERT | authenticated |  | public.is_admin(auth.uid()) | 20260302090000_099_secure_forum_categories_admin_writes.sql:14 |
| public.forum_categories | Authenticated admins can update forum categories | UPDATE | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260302090000_099_secure_forum_categories_admin_writes.sql:21 |
| public.forum_categories | Authenticated admins can delete forum categories | DELETE | authenticated | public.is_admin(auth.uid()) |  | 20260302090000_099_secure_forum_categories_admin_writes.sql:29 |
| public.forum_categories | Forum categories readable | SELECT | anon, authenticated | is_premium_only = false OR public.forum_has_active_subscription(auth.uid()) |  | 20260302110000_100_forum_agents_base.sql:364 |
| public.forum_topics | Forum topics readable | SELECT | anon, authenticated | public.forum_can_access_category(category_id, auth.uid()) AND ( ( forum_topics.is_deleted = false AND EXISTS ( SELECT 1 FROM public.forum_posts fp WHERE fp.topic_id = forum_topics.id AND ( fp.is_deleted = true OR (fp.is_deleted = false AND fp.is_visible = true) ) ) ) OR forum_topics.user_id = auth.uid() OR public.is_admin(auth.uid()) ) |  | 20260302110000_100_forum_agents_base.sql:380 |
| public.forum_posts | Forum posts readable | SELECT | anon, authenticated | EXISTS ( SELECT 1 FROM public.forum_topics ft WHERE ft.id = forum_posts.topic_id AND ft.is_deleted = false AND public.forum_can_access_category(ft.category_id, auth.uid()) ) AND ( public.is_admin(auth.uid()) OR forum_posts.user_id = auth.uid() OR forum_posts.is_deleted = true OR forum_posts.is_visible = true ) |  | 20260302110000_100_forum_agents_base.sql:412 |
| public.forum_moderation_logs | Admins can read forum moderation logs | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260302110000_100_forum_agents_base.sql:433 |
| public.forum_assistant_jobs | Admins can read forum assistant jobs | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260302110000_100_forum_agents_base.sql:440 |
| public.forum_topics | Forum topics readable | SELECT | anon, authenticated | public.forum_can_access_category(category_id, auth.uid()) AND ( COALESCE(is_deleted, false) = false OR user_id = auth.uid() OR public.is_admin(auth.uid()) ) |  | 20260302183000_101_fix_forum_rls_recursion.sql:21 |
| public.user_reputation | User reputation readable | SELECT | anon, authenticated | true |  | 20260303090000_102_reputation_core.sql:735 |
| public.reputation_events | Reputation events readable by owner or admin | SELECT | authenticated | user_id = auth.uid() OR public.is_admin(auth.uid()) |  | 20260303090000_102_reputation_core.sql:742 |
| public.reputation_rules | Reputation rules readable | SELECT | anon, authenticated | true |  | 20260303090000_102_reputation_core.sql:752 |
| public.reputation_rules | Admins can manage reputation rules | ALL | authenticated | public.is_admin(auth.uid()) | public.is_admin(auth.uid()) | 20260303090000_102_reputation_core.sql:759 |
| public.battle_product_snapshots | Anyone can view public battle product snapshots | SELECT | anon, authenticated | EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_product_snapshots.battle_id AND b.status IN ('active', 'voting', 'completed') ) |  | 20260303113000_105_create_battle_product_snapshots.sql:34 |
| public.battle_product_snapshots | Participants can view own battle product snapshots | SELECT | authenticated | EXISTS ( SELECT 1 FROM public.battles b WHERE b.id = battle_product_snapshots.battle_id AND (b.producer1_id = auth.uid() OR b.producer2_id = auth.uid()) ) |  | 20260303113000_105_create_battle_product_snapshots.sql:48 |
| public.battle_product_snapshots | Admins can view all battle product snapshots | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260303113000_105_create_battle_product_snapshots.sql:62 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | auth.uid() IS NOT NULL AND producer1_id = auth.uid() AND producer2_id IS NOT NULL AND producer1_id != producer2_id AND status = 'pending_acceptance' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND accepted_at IS NULL AND rejected_at IS NULL AND admin_validated_at IS NULL AND public.can_create_battle(auth.uid()) = true AND EXISTS ( SELECT 1 FROM public.user_profiles up2 WHERE up2.id = producer2_id AND up2.is_producer_active = true ) AND ( product1_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p1 WHERE p1.id = product1_id AND p1.producer_id = auth.uid() AND p1.deleted_at IS NULL ) ) AND ( product2_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p2 WHERE p2.id = product2_id AND p2.producer_id = producer2_id AND p2.deleted_at IS NULL ) ) | 20260303123000_111_harden_battles_insert_policy_to_tier_quota.sql:119 |
| public.battles | Active producers can create battles | INSERT | authenticated |  | auth.uid() IS NOT NULL AND producer1_id = auth.uid() AND producer2_id IS NOT NULL AND producer1_id != producer2_id AND status = 'pending_acceptance' AND winner_id IS NULL AND votes_producer1 = 0 AND votes_producer2 = 0 AND accepted_at IS NULL AND rejected_at IS NULL AND admin_validated_at IS NULL AND public.can_create_battle(auth.uid()) = true AND EXISTS ( SELECT 1 FROM public.public_producer_profiles pp2 WHERE pp2.user_id = producer2_id ) AND ( product1_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p1 WHERE p1.id = product1_id AND p1.producer_id = auth.uid() AND p1.deleted_at IS NULL ) ) AND ( product2_id IS NULL OR EXISTS ( SELECT 1 FROM public.products p2 WHERE p2.id = product2_id AND p2.producer_id = producer2_id AND p2.deleted_at IS NULL ) ) | 20260303125000_113_fix_battles_insert_policy_invited_producer_lookup.sql:22 |
| public.user_profiles | Authenticated can insert own profile safely | INSERT | authenticated |  | id = auth.uid() AND role = 'user'::public.user_role AND is_producer_active = false AND is_confirmed = false | 20260304100000_115_secure_user_profiles_insert_policy.sql:21 |
| public.forum_posts | Forum posts readable | SELECT | anon, authenticated | EXISTS ( SELECT 1 FROM public.forum_topics ft WHERE ft.id = forum_posts.topic_id AND ft.is_deleted = false AND public.forum_can_access_category(ft.category_id, auth.uid()) ) AND ( public.is_admin(auth.uid()) OR forum_posts.user_id = auth.uid() OR ( forum_posts.is_deleted = false AND forum_posts.is_visible = true ) ) |  | 20260304102000_117_secure_forum_posts_readable_policy.sql:12 |
| public.forum_posts | Forum posts readable | SELECT | anon, authenticated | EXISTS ( SELECT 1 FROM public.forum_topics ft WHERE ft.id = forum_posts.topic_id AND ft.is_deleted = false AND public.forum_can_access_category(ft.category_id, auth.uid()) ) AND ( public.is_admin(auth.uid()) OR forum_posts.user_id = auth.uid() OR ( forum_posts.is_deleted = false AND forum_posts.is_visible = true ) ) |  | 20260304103000_118_secure_forum_posts_readable_select_policy.sql:13 |
| public.app_settings | Public can read safe app settings | SELECT | anon, authenticated | key = ANY (ARRAY['social_links']) |  | 20260304104000_119_harden_app_settings_select_policies.sql:12 |
| public.app_settings | Admins can read all app settings | SELECT | authenticated | public.is_admin(auth.uid()) |  | 20260304104000_119_harden_app_settings_select_policies.sql:20 |
| storage.objects | Authenticated users can read specific audio file | SELECT | authenticated | bucket_id = 'beats-audio' AND name IS NOT NULL |  | 20260304105000_120_restrict_beats_audio_select_policy.sql:12 |
| storage.objects | Producers can read their audio | SELECT | authenticated | bucket_id = 'beats-audio' AND owner = auth.uid() AND public.is_active_producer(auth.uid()) |  | 20260304110000_121_secure_beats_audio_private_and_owner_read.sql:23 |

## 3) Patterns dangereux détectés (état final effectif)

Policies effectives (après DROP/CREATE): **127**

### A) SELECT permissif `USING (true)`

| Table | Policy | To | Source |
|---|---|---|---|
| public.forum_likes | Forum likes are publicly readable | anon, authenticated | 20260301170000_098_create_isolated_forum_module.sql:198 |
| public.licenses | Anyone can read licenses | anon, authenticated | 20260214210000_026_add_licenses_and_license_purchase_rpc.sql:44 |
| public.reputation_rules | Reputation rules readable | anon, authenticated | 20260303090000_102_reputation_core.sql:752 |
| public.user_reputation | User reputation readable | anon, authenticated | 20260303090000_102_reputation_core.sql:735 |

### B) UPDATE/DELETE permissif `USING (true)`

- Aucun

### C) INSERT sans garde robuste

| Table | Policy | To | WITH CHECK | Source |
|---|---|---|---|---|
| public.user_profiles | Auth service can insert profiles | supabase_auth_admin, service_role | true | 20260125175303_006_user_profiles_insert_policy.sql:22 |

### E) Tables sans RLS

Aucune table active créée par migration n'est restée sans RLS après application complète des migrations.

## 4) Cohérence routes/fonctions vs RLS

| Fonction Edge | Utilise service_role ? | Tables touchées | RPC touchées | Buckets touchés |
|---|---|---|---|---|
| supabase/functions/_shared/forumAgents.ts | YES | admin_notifications, app_settings, forum_categories, forum_topics, user_profiles | check_rpc_rate_limit, rpc_apply_reputation_event |  |
| supabase/functions/admin-upload-watermark/index.ts | YES | site_audio_settings, user_profiles, watermark-assets |  | watermark-assets |
| supabase/functions/agent-finalize-expired-battles/index.ts | YES |  | agent_finalize_expired_battles |  |
| supabase/functions/ai-evaluate-battle/index.ts | YES | ai_admin_actions, battles | is_admin |  |
| supabase/functions/ai-moderate-comment/index.ts | YES | ai_admin_actions, battle_comments | is_admin |  |
| supabase/functions/broadcast-news/index.ts | YES | news_videos, notification_email_log, producer_subscriptions, user_profiles | claim_notification_email_send, is_admin |  |
| supabase/functions/contact-submit/index.ts | YES | contact_messages |  |  |
| supabase/functions/create-checkout/index.ts | YES | exclusive_locks, licenses, products, user_profiles |  |  |
| supabase/functions/create-portal-session/index.ts | YES | producer_subscriptions |  |  |
| supabase/functions/enqueue-preview-reprocess/index.ts | YES | user_profiles | enqueue_reprocess_all_previews |  |
| supabase/functions/get-contract-url/index.ts | YES | purchases |  |  |
| supabase/functions/get-master-url/index.ts | YES | entitlements, products, purchases |  |  |
| supabase/functions/process-audio-jobs/index.ts | YES | audio_processing_jobs, products, site_audio_settings | claim_audio_processing_jobs |  |
| supabase/functions/producer-checkout/index.ts | YES | producer_plans, producer_subscriptions, user_profiles |  |  |
| supabase/functions/stripe-webhook/index.ts | YES | licenses, notification_email_log, producer_plans, producer_subscriptions, purchases, stripe_events, user_profiles | claim_notification_email_send, complete_exclusive_purchase, complete_license_purchase, complete_standard_purchase, log_audit_event |  |

## 5) Audit RPC / SECURITY DEFINER

| Fonction | SECURITY DEFINER | search_path fixé ? | Contrôles d’accès explicites ? | Grants EXECUTE | Source |
|---|---|---|---|---|---|
| public.admin_adjust_reputation | YES | YES | YES | authenticated, service_role | 20260303090000_102_reputation_core.sql:493 |
| public.admin_cancel_battle | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:923 |
| public.admin_extend_battle_duration | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1230 |
| public.admin_validate_battle | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:739 |
| public.agent_finalize_expired_battles | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1442 |
| public.apply_reputation_event_internal | YES | YES | NO | service_role | 20260303090000_102_reputation_core.sql:175 |
| public.can_access_exclusive_preview | YES | YES | NO |  | 20260221123000_031_use_is_confirmed_helper_for_access.sql:98 |
| public.can_create_battle | YES | YES | YES | authenticated, service_role | 20260303124000_112_add_battles_quota_status_rpc_and_elite_cap.sql:89 |
| public.can_create_product | YES | YES | NO | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:113 |
| public.can_edit_product | YES | YES | YES | authenticated, service_role | 20260303114000_106_harden_product_history_guards.sql:36 |
| public.can_publish_beat | YES | YES | NO | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:69 |
| public.capture_battle_product_snapshots | YES | YES | NO |  | 20260303113000_105_create_battle_product_snapshots.sql:154 |
| public.check_rpc_rate_limit | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:423 |
| public.check_stripe_event_processed | YES | YES | NO |  | 20260125151158_005_create_stripe_and_audit_schema.sql:287 |
| public.check_user_confirmation_status | YES | YES | NO |  | 20260125150850_001_create_user_roles_and_profiles.sql:222 |
| public.claim_audio_processing_jobs | YES | YES | YES | authenticated, service_role | 20260227121500_087_audio_processing_pipeline.sql:340 |
| public.claim_notification_email_send | YES | YES | NO | service_role | 20260223203000_057_add_notification_email_log_and_claim_rpc.sql:49 |
| public.classify_battle_comment_rule_based | YES | YES | NO | service_role | 20260222122000_047_add_rule_based_comment_moderation_trigger.sql:11 |
| public.cleanup_expired_exclusive_locks | YES | YES | NO |  | 20260125151043_003_create_purchases_and_entitlements.sql:237 |
| public.cleanup_rpc_rate_limit_counters | YES | YES | NO | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:511 |
| public.complete_exclusive_purchase | YES | YES | NO | service_role | 20260125151043_003_create_purchases_and_entitlements.sql:282 |
| public.complete_license_purchase | YES | YES | NO | service_role | 20260303110000_104_fix_marketplace_checkout_price_source.sql:11 |
| public.complete_standard_purchase | YES | YES | NO | service_role | 20260125151043_003_create_purchases_and_entitlements.sql:350 |
| public.create_exclusive_lock | YES | YES | NO | service_role | 20260125151043_003_create_purchases_and_entitlements.sql:245 |
| public.create_new_version_from_beat | YES | YES | NO | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:525 |
| public.delete_beat_if_no_sales | YES | YES | NO | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:507 |
| public.detect_admin_action_anomalies | YES | YES | NO | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:531 |
| public.enqueue_admin_notifications_for_ai_action | YES | YES | NO |  | 20260222120000_045_create_ai_admin_tables_and_policies.sql:206 |
| public.enqueue_audio_processing_job | YES | YES | NO | authenticated, service_role | 20260227121500_087_audio_processing_pipeline.sql:270 |
| public.enqueue_product_preview_job | YES | YES | NO |  | 20260227121500_087_audio_processing_pipeline.sql:299 |
| public.enqueue_reprocess_all_previews | YES | YES | YES | authenticated, service_role | 20260303115000_107_fix_enqueue_reprocess_all_previews_dedup.sql:11 |
| public.ensure_user_reputation_row | YES | YES | NO | service_role | 20260303090000_102_reputation_core.sql:131 |
| public.finalize_battle | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1024 |
| public.finalize_expired_battles | YES | YES | YES | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1369 |
| public.force_reprocess_all_previews | YES | YES | YES |  | 20260301120000_089_force_reprocess_all_previews.sql:1 |
| public.forum_admin_delete_category | YES | YES | YES | authenticated, service_role | 20260303093000_103_forum_reputation_rules_and_integrations.sql:542 |
| public.forum_admin_set_post_state | YES | YES | YES | authenticated, service_role | 20260302110000_100_forum_agents_base.sql:759 |
| public.forum_admin_set_topic_deleted | YES | YES | YES | authenticated, service_role | 20260302110000_100_forum_agents_base.sql:865 |
| public.forum_admin_upsert_category | YES | YES | YES | authenticated, service_role | 20260303093000_103_forum_reputation_rules_and_integrations.sql:366 |
| public.forum_touch_updated_at | YES | YES | NO |  | 20260302110000_100_forum_agents_base.sql:118 |
| public.generate_battle_slug | YES | YES | NO |  | 20260125151124_004_create_battles_schema.sql:335 |
| public.get_admin_business_metrics | YES | YES | YES | authenticated, service_role | 20260223234500_061_add_admin_pilotage_v2_rpcs.sql:194 |
| public.get_admin_metrics_timeseries | YES | YES | YES | authenticated, service_role | 20260223234500_061_add_admin_pilotage_v2_rpcs.sql:104 |
| public.get_admin_pilotage_deltas | YES | YES | YES | authenticated, service_role | 20260223234500_061_add_admin_pilotage_v2_rpcs.sql:12 |
| public.get_admin_pilotage_metrics | YES | YES | YES | authenticated, service_role | 20260226153000_083_add_admin_pilotage_subscription_kpis.sql:42 |
| public.get_advanced_producer_stats | YES | YES | YES | authenticated, service_role | 20260303122000_110_rename_producer_tier_enum_values_and_finalize_rules.sql:135 |
| public.get_battles_quota_status | YES | YES | YES | authenticated, service_role | 20260303124000_112_add_battles_quota_status_rpc_and_elite_cap.sql:160 |
| public.get_forum_public_profiles | YES | YES | NO | authenticated, service_role | 20260303093000_103_forum_reputation_rules_and_integrations.sql:183 |
| public.get_home_stats | YES | YES | NO | anon, authenticated, service_role | 20260223165000_056_add_get_home_stats_rpc.sql:12 |
| public.get_plan_limits | YES | YES | NO | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:45 |
| public.get_producer_tier | YES | YES | YES | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:14 |
| public.get_public_producer_profiles | YES | YES | NO | anon, authenticated, service_role | 20260303093000_103_forum_reputation_rules_and_integrations.sql:122 |
| public.get_public_producer_profiles_v2 | YES | YES | NO | anon, authenticated, service_role | 20260226170000_084_public_producer_profiles_v2.sql:13 |
| public.get_request_headers_jsonb | YES | YES | NO |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:272 |
| public.guard_product_editability | YES | YES | NO |  | 20260303114000_106_harden_product_history_guards.sql:94 |
| public.guard_product_hard_delete | YES | YES | NO |  | 20260303114000_106_harden_product_history_guards.sql:161 |
| public.handle_forum_post_stats | YES | YES | NO | service_role | 20260302110000_100_forum_agents_base.sql:264 |
| public.handle_new_user | YES | YES | NO |  | 20260125180123_007_fix_handle_new_user_function.sql:20 |
| public.has_producer_tier | YES | YES | YES | authenticated, service_role | 20260303122000_110_rename_producer_tier_enum_values_and_finalize_rules.sql:97 |
| public.increment_play_count | YES | YES | NO |  | 20260125151158_005_create_stripe_and_audit_schema.sql:365 |
| public.is_email_verified_user | YES | YES | YES | authenticated, service_role | 20260222110000_044_allow_email_verified_votes_and_comments.sql:13 |
| public.log_admin_action_audit | YES | YES | YES |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:295 |
| public.log_audit_event | YES | YES | NO |  | 20260125151158_005_create_stripe_and_audit_schema.sql:307 |
| public.log_monitoring_alert | YES | YES | NO |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:382 |
| public.log_preview_access | YES | YES | NO |  | 20260125151158_005_create_stripe_and_audit_schema.sql:335 |
| public.mark_stripe_event_processed | YES | YES | NO |  | 20260125151158_005_create_stripe_and_audit_schema.sql:295 |
| public.normalize_product_version_lineage | YES | YES | NO |  | 20260301143000_093_product_versioning_self_root.sql:109 |
| public.on_admin_action_audit_monitoring | YES | YES | NO |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:670 |
| public.on_battle_completed_reputation | YES | YES | NO |  | 20260303126000_114_fix_battle_completed_reputation_enum_cast.sql:19 |
| public.on_forum_post_like_reputation | YES | YES | NO |  | 20260303093000_103_forum_reputation_rules_and_integrations.sql:304 |
| public.on_rpc_rate_limit_hit_create_alert | YES | YES | NO |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:632 |
| public.populate_purchase_snapshots | YES | YES | NO |  | 20260301133000_091_add_marketplace_beat_lifecycle.sql:82 |
| public.prepare_product_preview_processing | YES | YES | NO |  | 20260227121500_087_audio_processing_pipeline.sql:225 |
| public.prevent_legacy_battle_status_assignments | YES | YES | NO |  | 20260223140000_054_refine_legacy_status_transition_guard.sql:25 |
| public.process_ai_comment_moderation | YES | YES | NO | service_role | 20260222122000_047_add_rule_based_comment_moderation_trigger.sql:93 |
| public.producer_publish_battle | YES | YES | YES | service_role | 20260221150000_036_add_battles_management_rpc_and_admin_policies.sql:126 |
| public.producer_start_battle_voting | YES | YES | YES | service_role | 20260221150000_036_add_battles_management_rpc_and_admin_policies.sql:173 |
| public.product_has_terminated_battle | YES | YES | NO | authenticated, service_role | 20260303114000_106_harden_product_history_guards.sql:19 |
| public.recalculate_engagement | YES | YES | NO | authenticated, service_role | 20260221162000_040_add_respond_to_battle_and_engagement_functions.sql:11 |
| public.recalculate_forum_topic_stats | YES | YES | NO | service_role | 20260302110000_100_forum_agents_base.sql:225 |
| public.record_battle_vote | YES | YES | YES | authenticated, service_role | 20260222110000_044_allow_email_verified_votes_and_comments.sql:109 |
| public.remove_beat_from_sale | YES | YES | NO | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:516 |
| public.reputation_touch_updated_at | YES | YES | NO |  | 20260303090000_102_reputation_core.sql:68 |
| public.respond_to_battle | YES | YES | YES | authenticated | 20260221162000_040_add_respond_to_battle_and_engagement_functions.sql:37 |
| public.rpc_admin_get_reputation_overview | YES | YES | YES | authenticated, service_role | 20260303090000_102_reputation_core.sql:648 |
| public.rpc_apply_reputation_event | YES | YES | YES | authenticated, service_role | 20260303090000_102_reputation_core.sql:444 |
| public.rpc_archive_product | YES | YES | YES | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:417 |
| public.rpc_create_product_version | YES | YES | YES | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:279 |
| public.rpc_delete_product_if_no_sales | YES | YES | YES | authenticated, service_role | 20260303114000_106_harden_product_history_guards.sql:199 |
| public.rpc_forum_create_post | YES | YES | YES | service_role | 20260302110000_100_forum_agents_base.sql:611 |
| public.rpc_forum_create_topic | YES | YES | YES | service_role | 20260302110000_100_forum_agents_base.sql:449 |
| public.rpc_get_leaderboard | YES | YES | NO | authenticated, service_role | 20260303090000_102_reputation_core.sql:565 |
| public.rpc_publish_product_version | YES | YES | YES | authenticated, service_role | 20260301150000_094_publish_product_version_without_phantom.sql:11 |
| public.should_flag_battle_refusal_risk | YES | YES | NO | authenticated, service_role | 20260221164000_042_harden_active_vote_only_and_completion_engagement.sql:245 |
| public.sync_executed_ai_actions_to_admin_action_audit_log | YES | YES | NO |  | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:584 |
| public.sync_user_reputation_row | YES | YES | NO |  | 20260303090000_102_reputation_core.sql:157 |
| public.upsert_battle_product_snapshot | YES | YES | NO | service_role | 20260303113000_105_create_battle_product_snapshots.sql:78 |
| public.user_has_entitlement | YES | YES | NO |  | 20260125151043_003_create_purchases_and_entitlements.sql:397 |

Sous-ensemble à surveiller (SECURITY DEFINER exposées anon/authenticated sans check explicite dans le corps):

| Fonction | Grants | Source |
|---|---|---|
| public.can_create_product | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:113 |
| public.can_publish_beat | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:69 |
| public.cleanup_rpc_rate_limit_counters | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:511 |
| public.create_new_version_from_beat | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:525 |
| public.delete_beat_if_no_sales | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:507 |
| public.detect_admin_action_anomalies | authenticated, service_role | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:531 |
| public.enqueue_audio_processing_job | authenticated, service_role | 20260227121500_087_audio_processing_pipeline.sql:270 |
| public.get_forum_public_profiles | authenticated, service_role | 20260303093000_103_forum_reputation_rules_and_integrations.sql:183 |
| public.get_home_stats | anon, authenticated, service_role | 20260223165000_056_add_get_home_stats_rpc.sql:12 |
| public.get_plan_limits | authenticated, service_role | 20260225111000_067_enforce_beats_quota_insert_update.sql:45 |
| public.get_public_producer_profiles | anon, authenticated, service_role | 20260303093000_103_forum_reputation_rules_and_integrations.sql:122 |
| public.get_public_producer_profiles_v2 | anon, authenticated, service_role | 20260226170000_084_public_producer_profiles_v2.sql:13 |
| public.product_has_terminated_battle | authenticated, service_role | 20260303114000_106_harden_product_history_guards.sql:19 |
| public.recalculate_engagement | authenticated, service_role | 20260221162000_040_add_respond_to_battle_and_engagement_functions.sql:11 |
| public.remove_beat_from_sale | authenticated, service_role | 20260301143000_093_product_versioning_self_root.sql:516 |
| public.rpc_get_leaderboard | authenticated, service_role | 20260303090000_102_reputation_core.sql:565 |
| public.should_flag_battle_refusal_risk | authenticated, service_role | 20260221164000_042_harden_active_vote_only_and_completion_engagement.sql:245 |

RPC appelées par le code applicatif (cross-check):

| RPC | SECURITY DEFINER | search_path | checks explicites | Grant anon/auth/public | Grant authenticated | Source |
|---|---|---|---|---|---|---|
| admin_adjust_reputation | YES | YES | YES | NO | YES | 20260303090000_102_reputation_core.sql:493 |
| admin_extend_battle_duration | YES | YES | YES | NO | YES | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1230 |
| agent_finalize_expired_battles | YES | YES | YES | NO | YES | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1442 |
| can_edit_product | YES | YES | YES | NO | YES | 20260303114000_106_harden_product_history_guards.sql:36 |
| check_rpc_rate_limit | YES | YES | YES | NO | YES | 20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:423 |
| claim_audio_processing_jobs | YES | YES | YES | NO | YES | 20260227121500_087_audio_processing_pipeline.sql:340 |
| claim_notification_email_send | YES | YES | NO | NO | NO | 20260223203000_057_add_notification_email_log_and_claim_rpc.sql:49 |
| complete_exclusive_purchase | YES | YES | NO | NO | NO | 20260125151043_003_create_purchases_and_entitlements.sql:282 |
| complete_license_purchase | YES | YES | NO | NO | NO | 20260303110000_104_fix_marketplace_checkout_price_source.sql:11 |
| complete_standard_purchase | YES | YES | NO | NO | NO | 20260125151043_003_create_purchases_and_entitlements.sql:350 |
| enqueue_reprocess_all_previews | YES | YES | YES | NO | YES | 20260303115000_107_fix_enqueue_reprocess_all_previews_dedup.sql:11 |
| forum_admin_delete_category | YES | YES | YES | NO | YES | 20260303093000_103_forum_reputation_rules_and_integrations.sql:542 |
| forum_admin_set_post_state | YES | YES | YES | NO | YES | 20260302110000_100_forum_agents_base.sql:759 |
| forum_admin_set_topic_deleted | YES | YES | YES | NO | YES | 20260302110000_100_forum_agents_base.sql:865 |
| forum_admin_upsert_category | YES | YES | YES | NO | YES | 20260303093000_103_forum_reputation_rules_and_integrations.sql:366 |
| get_admin_business_metrics | YES | YES | YES | NO | YES | 20260223234500_061_add_admin_pilotage_v2_rpcs.sql:194 |
| get_admin_metrics_timeseries | YES | YES | YES | NO | YES | 20260223234500_061_add_admin_pilotage_v2_rpcs.sql:104 |
| get_admin_pilotage_deltas | YES | YES | YES | NO | YES | 20260223234500_061_add_admin_pilotage_v2_rpcs.sql:12 |
| get_admin_pilotage_metrics | YES | YES | YES | NO | YES | 20260226153000_083_add_admin_pilotage_subscription_kpis.sql:42 |
| get_advanced_producer_stats | YES | YES | YES | NO | YES | 20260303122000_110_rename_producer_tier_enum_values_and_finalize_rules.sql:135 |
| get_battles_quota_status | YES | YES | YES | NO | YES | 20260303124000_112_add_battles_quota_status_rpc_and_elite_cap.sql:160 |
| get_home_stats | YES | YES | NO | YES | YES | 20260223165000_056_add_get_home_stats_rpc.sql:12 |
| increment_play_count | YES | YES | NO | NO | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:365 |
| is_admin | NO | YES | YES | NO | NO | 20260226153000_083_add_admin_pilotage_subscription_kpis.sql:17 |
| log_audit_event | YES | YES | NO | NO | NO | 20260125151158_005_create_stripe_and_audit_schema.sql:307 |
| record_battle_vote | YES | YES | YES | NO | YES | 20260222110000_044_allow_email_verified_votes_and_comments.sql:109 |
| respond_to_battle | YES | YES | YES | NO | YES | 20260221162000_040_add_respond_to_battle_and_engagement_functions.sql:37 |
| rpc_admin_get_reputation_overview | YES | YES | YES | NO | YES | 20260303090000_102_reputation_core.sql:648 |
| rpc_apply_reputation_event | YES | YES | YES | NO | YES | 20260303090000_102_reputation_core.sql:444 |
| rpc_archive_product | YES | YES | YES | NO | YES | 20260301143000_093_product_versioning_self_root.sql:417 |
| rpc_delete_product_if_no_sales | YES | YES | YES | NO | YES | 20260303114000_106_harden_product_history_guards.sql:199 |
| rpc_forum_create_post | YES | YES | YES | NO | NO | 20260302110000_100_forum_agents_base.sql:611 |
| rpc_forum_create_topic | YES | YES | YES | NO | NO | 20260302110000_100_forum_agents_base.sql:449 |
| rpc_get_leaderboard | YES | YES | NO | NO | YES | 20260303090000_102_reputation_core.sql:565 |
| rpc_publish_product_version | YES | YES | YES | NO | YES | 20260301150000_094_publish_product_version_without_phantom.sql:11 |

## 6) Audit Storage

| Table | Policy | Action | To | USING | WITH CHECK | Source |
|---|---|---|---|---|---|---|
| storage.objects | Admins can delete watermark assets | DELETE | authenticated | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' |  | 20260227121500_087_audio_processing_pipeline.sql:558 |
| storage.objects | Admins can read watermark assets | SELECT | authenticated | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) |  | 20260227121500_087_audio_processing_pipeline.sql:524 |
| storage.objects | Admins can update watermark assets | UPDATE | authenticated | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' | 20260227121500_087_audio_processing_pipeline.sql:543 |
| storage.objects | Admins can upload watermark assets | INSERT | authenticated |  | bucket_id = 'watermark-assets' AND public.is_admin(auth.uid()) AND name LIKE 'admin/%' | 20260227121500_087_audio_processing_pipeline.sql:533 |
| storage.objects | Anyone can view avatars | SELECT | anon, authenticated | bucket_id = 'avatars' |  | 20260226104000_077_add_avatars_bucket_and_policies.sql:91 |
| storage.objects | Anyone can view covers | SELECT | anon, authenticated | bucket_id = 'beats-covers' |  | 20260207120000_017_create_storage_buckets.sql:257 |
| storage.objects | Buyers can read own contracts | SELECT | authenticated | bucket_id = 'contracts' AND EXISTS ( SELECT 1 FROM public.purchases p WHERE p.user_id = auth.uid() AND p.contract_pdf_path IS NOT NULL AND p.contract_pdf_path = storage.objects.name ) |  | 20260214143000_020_add_contract_pdf_and_contracts_bucket.sql:61 |
| storage.objects | Producers can delete own masters | DELETE | authenticated | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' |  | 20260227103000_086_secure_master_access_and_storage_split.sql:236 |
| storage.objects | Producers can delete their audio | DELETE | authenticated | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' |  | 20260207120000_017_create_storage_buckets.sql:135 |
| storage.objects | Producers can delete their covers | DELETE | authenticated | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' |  | 20260207120000_017_create_storage_buckets.sql:237 |
| storage.objects | Producers can read their audio | SELECT | authenticated | bucket_id = 'beats-audio' AND owner = auth.uid() AND public.is_active_producer(auth.uid()) |  | 20260304110000_121_secure_beats_audio_private_and_owner_read.sql:23 |
| storage.objects | Producers can update own masters | UPDATE | authenticated | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260227103000_086_secure_master_access_and_storage_split.sql:219 |
| storage.objects | Producers can update their audio | UPDATE | authenticated | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:109 |
| storage.objects | Producers can update their covers | UPDATE | authenticated | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:211 |
| storage.objects | Producers can upload audio | INSERT | authenticated |  | bucket_id = 'beats-audio' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:89 |
| storage.objects | Producers can upload covers | INSERT | authenticated |  | bucket_id = 'beats-covers' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260207120000_017_create_storage_buckets.sql:191 |
| storage.objects | Producers can upload masters | INSERT | authenticated |  | bucket_id = 'beats-masters' AND auth.uid() = owner AND public.is_active_producer(auth.uid()) AND name LIKE auth.uid()::text \|\| '/%' | 20260227103000_086_secure_master_access_and_storage_split.sql:208 |
| storage.objects | Public can read watermarked audio | SELECT | anon, authenticated | bucket_id = 'beats-watermarked' |  | 20260227103000_086_secure_master_access_and_storage_split.sql:247 |
| storage.objects | Users can delete own avatars | DELETE | authenticated | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' |  | 20260226104000_077_add_avatars_bucket_and_policies.sql:81 |
| storage.objects | Users can update own avatars | UPDATE | authenticated | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' | 20260226104000_077_add_avatars_bucket_and_policies.sql:66 |
| storage.objects | Users can upload avatars | INSERT | authenticated |  | bucket_id = 'avatars' AND auth.uid() = owner AND name LIKE auth.uid()::text \|\| '/%' | 20260226104000_077_add_avatars_bucket_and_policies.sql:56 |

Usage `upsert: true` détecté côté code :

- `api/contract-handler.ts:271`
- `supabase/functions/get-contract-url/index.ts:178`
- `supabase/functions/process-audio-jobs/index.ts:677`
- `supabase/functions/admin-upload-watermark/index.ts:167`
- `src/pages/Settings.tsx:141`

## 7) Vulnérabilités priorisées + correctifs

### CRITICAL
- Aucune vulnérabilité CRITICAL démontrée sur les tables sensibles listées (elles ont RLS activé).

### HIGH
- Functions SECURITY DEFINER housekeeping/modération exposées à `authenticated` sans garde explicite dans le corps (ex: `cleanup_rpc_rate_limit_counters`, `detect_admin_action_anomalies`).
  - Source grants: `20260223152000_055_add_admin_audit_rate_limit_and_monitoring.sql:1679-1686`
  - Risque: abus possible (tampering monitoring, bruit opérationnel).
  - Correctif: restreindre EXECUTE à `service_role` uniquement, ou ajouter check admin strict au début des fonctions.

### MEDIUM
- Lecture publique `USING (true)` sur `public.user_reputation` (anon/authenticated).
  - Source: `20260303090000_102_reputation_core.sql:735-739`
  - Impact: exposition globale des métriques de réputation utilisateur.
  - Correctif: limiter à vue publique allowlist ou scope owner/admin selon besoin produit.

- Lecture publique `USING (true)` sur `public.forum_likes`.
  - Source: `20260301170000_098_create_isolated_forum_module.sql:197-202`
  - Impact: enumeration des likes (faible sensibilité mais corrélable).
  - Correctif: restreindre via `EXISTS` sur topics/posts visibles ou déplacer vers vue publique agrégée.

- `contact-submit` garde `service_role` sur endpoint public (durci, mais reste à haute valeur).
  - Source: `supabase/functions/contact-submit/index.ts:306-330`
  - Mitigations présentes: rate limit + captcha optionnel + validation stricte.
  - Correctif durci recommandé: migrer vers client anon + policy INSERT dédiée si possible.

### LOW
- Absence de `FORCE ROW LEVEL SECURITY` sur les tables (aucune table forcée).
  - Impact: faible dans Supabase standard, mais hardening supplémentaire possible.
  - Correctif: activer FORCE RLS sur tables très sensibles après validation service-role/RPC.

## 8) SQL de correction proposés

```sql
-- A) Restreindre les fonctions housekeeping à service_role
REVOKE EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) TO service_role;
```

```sql
-- B) Réduire exposition user_reputation si non souhaitée publiquement
DROP POLICY IF EXISTS "User reputation readable" ON public.user_reputation;
CREATE POLICY "Owner or admin can read user reputation"
  ON public.user_reputation
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
```

## 9) Checklist tests post-correction

1. `anon` peut lire uniquement les tables/vues explicitement publiques attendues.
2. `authenticated` non-admin ne peut pas exécuter les RPC admin/housekeeping.
3. `producer_plan_config` reste lisible côté pricing après activation RLS.
4. `user_reputation` non-owner renvoie 0 ligne si policy durcie appliquée.
5. Upload/storage: vérifier qu’aucun utilisateur ne peut overwrite un objet hors namespace owner.
6. `contact-submit`: 429 après dépassement limite, 403 captcha invalide si `HCAPTCHA_SECRET` activé.
7. `stripe-webhook`: signature invalide => 400, signature valide => traitement normal.
