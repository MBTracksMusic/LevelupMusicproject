import type { Database as GeneratedDatabase } from './database.types';

export type UserRole = 'visitor' | 'user' | 'confirmed_user' | 'producer' | 'admin';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
export type ProductType = 'beat' | 'exclusive' | 'kit';
export type ProductLifecycleStatus = 'active' | 'archived';
export type ProducerTier = 'starter' | 'pro' | 'elite';
export type ReputationRankTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type PurchaseStatus = 'pending' | 'completed' | 'failed' | 'refunded';
export type PurchaseSource = 'stripe_checkout' | 'credits';
export type EntitlementType = 'purchase' | 'subscription' | 'promo' | 'admin_grant';
export type BattleStatus =
  | 'pending'
  | 'pending_acceptance'
  | 'awaiting_admin'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'voting'
  | 'completed'
  | 'cancelled';
export type AiAdminActionType =
  | 'battle_validate'
  | 'battle_cancel'
  | 'battle_finalize'
  | 'comment_moderation'
  | 'match_recommendation'
  | 'battle_duration_set'
  | 'battle_duration_extended';
export type AiAdminEntityType = 'battle' | 'comment' | 'other';
export type AiAdminActionStatus = 'proposed' | 'executed' | 'failed' | 'overridden';
export type AdminBattleRpcName =
  | 'admin_validate_battle'
  | 'admin_cancel_battle'
  | 'finalize_battle'
  | 'admin_extend_battle_duration';

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  // Transitional IAM flag. May be undefined until the migration is applied everywhere.
  is_confirmed?: boolean;
  is_producer_active: boolean;
  producer_tier?: ProducerTier | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  total_purchases: number;
  confirmed_at: string | null;
  producer_verified_at: string | null;
  battle_refusal_count: number;
  battles_participated: number;
  battles_completed: number;
  engagement_score: number;
  language: 'fr' | 'en' | 'de';
  bio: string | null;
  website_url: string | null;
  social_links: Record<string, string>;
  is_deleted?: boolean;
  deleted_at?: string | null;
  delete_reason?: string | null;
  deleted_label?: string | null;
  // Founding Producer trial fields (computed by my_user_profile view)
  is_founding_producer?: boolean;
  founding_trial_start?: string | null;
  founding_trial_end?: string | null;
  founding_trial_active?: boolean;
  founding_trial_expired?: boolean;
  can_access_producer_features?: boolean;
  // Campaign system (migration 222)
  producer_campaign_type?: string | null;
  producer_campaign_label?: string | null;
  campaign_trial_duration?: string | null;
  xp?: number;
  level?: number;
  rank_tier?: ReputationRankTier | null;
  forum_xp?: number;
  battle_xp?: number;
  commerce_xp?: number;
  reputation_score?: number;
  created_at: string;
  updated_at: string;
}

export interface UserReputation {
  user_id: string;
  xp: number;
  level: number;
  rank_tier: ReputationRankTier;
  forum_xp: number;
  battle_xp: number;
  commerce_xp: number;
  reputation_score: number;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Genre {
  id: string;
  name: string;
  name_en: string;
  name_de: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Mood {
  id: string;
  name: string;
  name_en: string;
  name_de: string;
  slug: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export type Product = GeneratedDatabase['public']['Tables']['products']['Row'];

export interface ProductWithRelations extends Product {
  producer?: UserProfile;
  genre?: Genre;
  mood?: Mood;
  licenses?: ProductLicense[];
}

export interface License {
  id: string;
  name: string;
  description: string | null;
  max_streams: number | null;
  max_sales: number | null;
  youtube_monetization: boolean;
  music_video_allowed: boolean;
  credit_required: boolean;
  exclusive_allowed: boolean;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface ProductLicense {
  id: string;
  product_id: string;
  license_id: string;
  license_type: string;
  price: number;
  stripe_price_id: string | null;
  features: GeneratedDatabase['public']['Tables']['product_licenses']['Row']['features'];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  license?: License | null;
}

export interface ProductFile {
  id: string;
  product_id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  file_type: string | null;
  sort_order: number;
  created_at: string;
}

export interface Purchase {
  id: string;
  user_id: string;
  product_id: string;
  producer_id: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  amount: number;
  currency: string;
  status: PurchaseStatus;
  license_type: string;
  license_id: string | null;
  is_exclusive: boolean;
  download_count: number;
  max_downloads: number;
  download_expires_at: string | null;
  contract_pdf_path: string | null;
  beat_title_snapshot: string | null;
  beat_slug_snapshot: string | null;
  audio_path_snapshot: string | null;
  cover_image_url_snapshot: string | null;
  beat_version_snapshot: number | null;
  price_snapshot: number | null;
  currency_snapshot: string | null;
  producer_display_name_snapshot: string | null;
  license_type_snapshot: string | null;
  license_name_snapshot: string | null;
  purchase_source: PurchaseSource;
  credits_spent: number | null;
  credit_unit_value_cents_snapshot: number | null;
  gross_reference_amount_cents: number | null;
  producer_share_cents_snapshot: number | null;
  platform_share_cents_snapshot: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  plan_code: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  subscription_status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCreditLedgerEntry {
  id: string;
  user_id: string;
  subscription_id: string | null;
  purchase_id: string | null;
  entry_type: 'monthly_allocation' | 'purchase_debit' | 'reversal' | 'admin_adjustment' | 'migration_adjustment';
  direction: 'credit' | 'debit';
  credits_amount: number;
  balance_delta: number;
  running_balance: number | null;
  reason: string;
  stripe_invoice_id: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PurchaseWithRelations extends Purchase {
  product?: Product;
  producer?: UserProfile;
  license?: License | null;
}

export interface Entitlement {
  id: string;
  user_id: string;
  product_id: string;
  purchase_id: string | null;
  entitlement_type: EntitlementType;
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export interface Battle {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  producer1_id: string;
  producer2_id: string | null;
  product1_id: string | null;
  product2_id: string | null;
  status: BattleStatus;
  accepted_at: string | null;
  rejected_at: string | null;
  admin_validated_at: string | null;
  rejection_reason: string | null;
  response_deadline: string | null;
  submission_deadline: string | null;
  starts_at: string | null;
  voting_ends_at: string | null;
  custom_duration_days: number | null;
  extension_count: number;
  winner_id: string | null;
  votes_producer1: number;
  votes_producer2: number;
  featured: boolean;
  prize_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface BattleWithRelations extends Battle {
  producer1?: UserProfile;
  producer2?: UserProfile;
  product1?: Product;
  product2?: Product;
  winner?: UserProfile;
}

export type BattleProductSnapshot = GeneratedDatabase['public']['Tables']['battle_product_snapshots']['Row'];

export interface BattleVote {
  id: string;
  battle_id: string;
  user_id: string;
  voted_for_producer_id: string;
  created_at: string;
}

export interface BattleComment {
  id: string;
  battle_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  is_hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface BattleCommentWithUser extends BattleComment {
  user?: UserProfile;
}

export interface AiAdminAction {
  id: string;
  action_type: AiAdminActionType;
  entity_type: AiAdminEntityType;
  entity_id: string;
  ai_decision: Record<string, unknown>;
  confidence_score: number | null;
  reason: string | null;
  status: AiAdminActionStatus;
  human_override: boolean;
  reversible: boolean;
  created_at: string;
  executed_at: string | null;
  executed_by: string | null;
  error: string | null;
}

export interface AiTrainingFeedback {
  id: string;
  action_id: string;
  ai_prediction: Record<string, unknown>;
  human_decision: Record<string, unknown>;
  delta: number | null;
  created_at: string;
  created_by: string | null;
}

export interface ForumAuthor {
  id: string;
  username: string | null;
  avatar_url: string | null;
  xp?: number;
  level?: number;
  rank_tier?: ReputationRankTier | null;
  reputation_score?: number;
}

export interface ForumCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_premium_only: boolean;
  position: number;
  xp_multiplier?: number;
  moderation_strictness?: 'low' | 'normal' | 'high';
  is_competitive?: boolean;
  required_rank_tier?: ReputationRankTier | null;
  allow_links?: boolean;
  allow_media?: boolean;
  created_at: string;
  topic_count: number;
  post_count: number;
}

export interface ForumTopic {
  id: string;
  category_id: string;
  user_id: string;
  title: string;
  slug: string;
  is_pinned: boolean;
  is_locked: boolean;
  is_deleted?: boolean;
  created_at: string;
  last_post_at: string;
  post_count: number;
  last_ai_reply_at?: string | null;
  author?: ForumAuthor;
}

export interface ForumPost {
  id: string;
  topic_id: string;
  user_id: string;
  content: string;
  edited_at: string | null;
  is_deleted: boolean;
  moderation_status?: 'pending' | 'allowed' | 'review' | 'blocked';
  is_visible?: boolean;
  is_flagged?: boolean;
  moderation_score?: number | null;
  moderation_reason?: string | null;
  moderated_at?: string | null;
  moderation_model?: string | null;
  is_ai_generated?: boolean;
  ai_agent_name?: string | null;
  source_post_id?: string | null;
  created_at: string;
  author?: ForumAuthor;
}

export interface LatestForumTopic extends ForumTopic {
  category_name: string;
  category_slug: string;
  category_is_premium_only: boolean;
}

export interface AdminNotification {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface CartItem {
  id: string;
  user_id: string;
  product_id: string;
  license_type: string | null;
  license_id: string | null;
  created_at: string;
}

export interface CartItemWithProduct extends CartItem {
  product?: ProductWithRelations;
  selected_license?: ProductLicense | null;
}

export interface WishlistItem {
  id: string;
  user_id: string;
  product_id: string;
  created_at: string;
}

export interface WishlistItemWithProduct extends WishlistItem {
  product?: ProductWithRelations;
}

export interface AppSetting {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export type { Database, Json } from './database.types';
