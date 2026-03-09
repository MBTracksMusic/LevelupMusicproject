import { supabase } from './client';
import type { ReputationRankTier } from './types';

export interface ForumPublicProfileRow {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  rank: ReputationRankTier;
  reputation: number;
}

export async function fetchForumPublicProfilesMap(
  userIds: Array<string | null | undefined>
): Promise<Map<string, ForumPublicProfileRow>> {
  const uniqueIds = [...new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('forum_public_profiles_public' as any)
    .select('user_id, username, avatar_url, rank, reputation')
    .in('user_id', uniqueIds);

  if (error) {
    throw error;
  }

  const rows = (data as unknown as ForumPublicProfileRow[] | null) ?? [];
  return new Map(rows.map((row) => [row.user_id, row]));
}
