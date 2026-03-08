import { supabase } from './client';
import type { ReputationRankTier } from './types';

export interface PublicProducerProfileRow {
  user_id: string;
  raw_username?: string | null;
  username: string | null;
  avatar_url: string | null;
  producer_tier: string | null;
  bio: string | null;
  social_links: Record<string, string> | null;
  xp: number;
  level: number;
  rank_tier: ReputationRankTier;
  reputation_score: number;
  is_deleted?: boolean;
  is_producer_active?: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchPublicProducerProfilesMap(
  userIds: Array<string | null | undefined>
): Promise<Map<string, PublicProducerProfileRow>> {
  const uniqueIds = [...new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  let { data, error } = await supabase
    .from('public_producer_profiles')
    .select('user_id, raw_username, username, avatar_url, producer_tier, bio, social_links, xp, level, rank_tier, reputation_score, is_deleted, is_producer_active, created_at, updated_at')
    .in('user_id', uniqueIds);

  if (error) {
    const { data: legacyData, error: legacyError } = await supabase
      .from('public_producer_profiles')
      .select('user_id, username, avatar_url, producer_tier, bio, social_links, xp, level, rank_tier, reputation_score, created_at, updated_at')
      .in('user_id', uniqueIds);

    if (legacyError) {
      throw error;
    }

    data = (legacyData ?? []).map((row) => ({
      ...row,
      raw_username: (row as Record<string, unknown>).username as string | null,
      is_deleted: false,
      is_producer_active: true,
    }));
  }

  const rows = (data as unknown as PublicProducerProfileRow[] | null) ?? [];
  return new Map(rows.map((row) => [row.user_id, row]));
}
