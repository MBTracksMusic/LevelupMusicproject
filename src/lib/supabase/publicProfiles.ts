import { supabase } from './client';

export interface PublicProducerProfileRow {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  producer_tier: string | null;
  bio: string | null;
  social_links: Record<string, string> | null;
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

  const { data, error } = await supabase
    .from('public_producer_profiles')
    .select('user_id, username, avatar_url, producer_tier, bio, social_links, created_at, updated_at')
    .in('user_id', uniqueIds);

  if (error) {
    throw error;
  }

  const rows = (data as PublicProducerProfileRow[] | null) ?? [];
  return new Map(rows.map((row) => [row.user_id, row]));
}
