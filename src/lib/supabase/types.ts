import type { Database as GeneratedDatabase } from './database.types';

export type UserRole = 'visitor' | 'user' | 'confirmed_user' | 'producer' | 'admin';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
export type ProductType = 'beat' | 'exclusive' | 'kit';
export type ProducerTier = 'starter' | 'pro' | 'elite';
export type PurchaseStatus = 'pending' | 'completed' | 'failed' | 'refunded';
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
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
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
  license_type: string;
  created_at: string;
}

export interface CartItemWithProduct extends CartItem {
  product?: ProductWithRelations;
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
