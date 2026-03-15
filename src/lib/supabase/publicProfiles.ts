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

const PUBLIC_PROFILES_SELECT = [
  'user_id',
  'raw_username',
  'username',
  'avatar_url',
  'producer_tier',
  'bio',
  'social_links',
  'xp',
  'level',
  'rank_tier',
  'reputation_score',
  'is_deleted',
  'is_producer_active',
  'created_at',
  'updated_at',
].join(', ');

const LEGACY_PUBLIC_PROFILES_SELECT = [
  'user_id',
  'username',
  'avatar_url',
  'producer_tier',
  'bio',
  'social_links',
  'xp',
  'level',
  'rank_tier',
  'reputation_score',
  'created_at',
  'updated_at',
].join(', ');

const PUBLIC_PROFILES_RPC_FALLBACKS = [
  'get_public_visible_producer_profiles',
  'get_public_producer_profiles_soft',
  'get_public_producer_profiles',
  'get_public_producer_profiles_v2',
] as const;

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return value;
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

const toSocialLinks = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue === 'string')
    .map(([key, entryValue]) => [key, entryValue as string]);

  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
};

const toRankTier = (value: unknown): ReputationRankTier => {
  if (value === 'bronze' || value === 'silver' || value === 'gold' || value === 'platinum' || value === 'diamond') {
    return value;
  }
  return 'bronze';
};

const normalizePublicProducerProfileRow = (value: unknown): PublicProducerProfileRow | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;

  const userId = toNonEmptyString(row.user_id);
  if (!userId) return null;

  const rawUsername = toNullableString(row.raw_username);
  const username = toNullableString(row.username) ?? rawUsername;

  return {
    user_id: userId,
    raw_username: rawUsername,
    username,
    avatar_url: toNullableString(row.avatar_url),
    producer_tier: toNullableString(row.producer_tier),
    bio: toNullableString(row.bio),
    social_links: toSocialLinks(row.social_links),
    xp: toNumber(row.xp),
    level: toNumber(row.level),
    rank_tier: toRankTier(row.rank_tier),
    reputation_score: toNumber(row.reputation_score),
    is_deleted: toBoolean(row.is_deleted, false),
    is_producer_active: toBoolean(row.is_producer_active, true),
    created_at: toNullableString(row.created_at) ?? '',
    updated_at: toNullableString(row.updated_at) ?? '',
  };
};

const addRowsToMap = (
  map: Map<string, PublicProducerProfileRow>,
  allowedIds: Set<string>,
  rows: unknown[]
) => {
  for (const candidate of rows) {
    const normalized = normalizePublicProducerProfileRow(candidate);
    if (!normalized) continue;
    if (!allowedIds.has(normalized.user_id)) continue;
    map.set(normalized.user_id, normalized);
  }
};

export async function fetchPublicProducerProfilesMap(
  userIds: Array<string | null | undefined>
): Promise<Map<string, PublicProducerProfileRow>> {
  const uniqueIds = [...new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const idSet = new Set(uniqueIds);
  const profilesById = new Map<string, PublicProducerProfileRow>();

  const primary = await supabase
    .from('public_producer_profiles')
    .select(PUBLIC_PROFILES_SELECT)
    .in('user_id', uniqueIds);

  if (!primary.error && Array.isArray(primary.data)) {
    addRowsToMap(profilesById, idSet, primary.data);
  }

  if (profilesById.size < idSet.size) {
    const legacy = await supabase
      .from('public_producer_profiles')
      .select(LEGACY_PUBLIC_PROFILES_SELECT)
      .in('user_id', uniqueIds);

    if (!legacy.error && Array.isArray(legacy.data)) {
      addRowsToMap(profilesById, idSet, legacy.data);
    }
  }

  if (profilesById.size < idSet.size) {
    for (const rpcName of PUBLIC_PROFILES_RPC_FALLBACKS) {
      const rpcRes = await supabase.rpc(rpcName as any);
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        addRowsToMap(profilesById, idSet, rpcRes.data as unknown[]);
      }
      if (profilesById.size >= idSet.size) {
        break;
      }
    }
  }

  return profilesById;
}
