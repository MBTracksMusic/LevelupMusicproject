import { supabase } from './client';
import type { Database } from './database.types';
import type { LabelRequest, ProductWithRelations } from './types';
import { fetchPublicProducerProfilesMap } from './publicProfiles';
import { GENRE_SAFE_COLUMNS, MOOD_SAFE_COLUMNS, PRODUCT_SAFE_COLUMNS } from './selects';

type EliteProductRow = Database['public']['Tables']['products']['Row'];
type GenreRow = Database['public']['Tables']['genres']['Row'];
type MoodRow = Database['public']['Tables']['moods']['Row'];

type LabelRequestRow = Database['public']['Tables']['label_requests']['Row'];

export interface EliteAdminProfileSummary {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  role: string;
  account_type: string;
  is_verified: boolean;
  is_producer_active: boolean;
  updated_at: string;
}

export interface EliteAdminProductSummary {
  id: string;
  producer_id: string;
  title: string;
  slug: string;
  is_elite: boolean;
  is_published: boolean;
  status: string;
  created_at: string;
}

const ELITE_PRODUCT_COLUMNS = [
  PRODUCT_SAFE_COLUMNS,
  'is_elite',
].join(', ');

const ADMIN_PROFILE_COLUMNS = [
  'id',
  'email',
  'username',
  'full_name',
  'role',
  'account_type',
  'is_verified',
  'is_producer_active',
  'updated_at',
].join(', ');

const ADMIN_PRODUCT_COLUMNS = [
  'id',
  'producer_id',
  'title',
  'slug',
  'is_elite',
  'is_published',
  'status',
  'created_at',
].join(', ');

export async function fetchEliteProducts(): Promise<ProductWithRelations[]> {
  const { data, error } = await (supabase.from('elite_catalog_products' as any) as any)
    .select(ELITE_PRODUCT_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data as unknown as EliteProductRow[] | null) ?? [];
  const genreIds = Array.from(new Set(rows.map((row) => row.genre_id).filter((id): id is string => Boolean(id))));
  const moodIds = Array.from(new Set(rows.map((row) => row.mood_id).filter((id): id is string => Boolean(id))));

  const [producerProfiles, genresById, moodsById] = await Promise.all([
    fetchPublicProducerProfilesMap(rows.map((row) => row.producer_id)),
    fetchGenresMap(genreIds),
    fetchMoodsMap(moodIds),
  ]);

  return rows.map((row) => {
    const producerProfile = producerProfiles.get(row.producer_id);

    return {
      ...(row as ProductWithRelations),
      genre: row.genre_id ? genresById.get(row.genre_id) : undefined,
      mood: row.mood_id ? moodsById.get(row.mood_id) : undefined,
      producer: row.producer_id
        ? {
            id: row.producer_id,
            username: producerProfile?.username ?? producerProfile?.raw_username ?? null,
            avatar_url: producerProfile?.avatar_url ?? null,
          }
        : undefined,
    } as ProductWithRelations;
  });
}

async function fetchGenresMap(ids: string[]): Promise<Map<string, GenreRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('genres')
    .select(GENRE_SAFE_COLUMNS as any)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return new Map((((data as unknown as GenreRow[] | null) ?? []).map((genre) => [genre.id, genre])));
}

async function fetchMoodsMap(ids: string[]): Promise<Map<string, MoodRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('moods')
    .select(MOOD_SAFE_COLUMNS as any)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return new Map((((data as unknown as MoodRow[] | null) ?? []).map((mood) => [mood.id, mood])));
}

export async function fetchOwnLabelRequests(userId: string): Promise<LabelRequest[]> {
  const { data, error } = await supabase
    .from('label_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data as LabelRequestRow[] | null) ?? []) as LabelRequest[];
}

export async function createLabelRequest(input: {
  user_id: string;
  company_name: string;
  email: string;
  message: string;
}): Promise<LabelRequest> {
  const payload: Database['public']['Tables']['label_requests']['Insert'] = {
    user_id: input.user_id,
    company_name: input.company_name.trim(),
    email: input.email.trim(),
    message: input.message.trim(),
  };

  const { data, error } = await supabase
    .from('label_requests')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as LabelRequest;
}

export async function listLabelRequestsAdmin(): Promise<LabelRequest[]> {
  const { data, error } = await supabase
    .from('label_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data as LabelRequestRow[] | null) ?? []) as LabelRequest[];
}

export async function listEliteProfilesAdmin(): Promise<EliteAdminProfileSummary[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(ADMIN_PROFILE_COLUMNS)
    .or('role.eq.producer,is_producer_active.eq.true,account_type.eq.producer,account_type.eq.elite_producer,account_type.eq.label')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  return ((data as unknown as EliteAdminProfileSummary[] | null) ?? []);
}

export async function listEliteProductsAdmin(): Promise<EliteAdminProductSummary[]> {
  const { data, error } = await supabase
    .from('products')
    .select(ADMIN_PRODUCT_COLUMNS)
    .eq('product_type', 'beat')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  return ((data as unknown as EliteAdminProductSummary[] | null) ?? []);
}

export async function approveLabelRequest(options: {
  requestId: string;
  userId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_approve_label_request', {
    p_request_id: options.requestId,
    p_user_id: options.userId,
  });

  if (error) {
    throw error;
  }
}

export async function setEliteProducerStatus(userId: string, isElite: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_private_access_profile', {
    p_user_id: userId,
    p_account_type: isElite ? 'elite_producer' : 'producer',
  });

  if (error) {
    throw error;
  }
}

export async function toggleEliteProduct(productId: string, isElite: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_product_elite_status', {
    p_product_id: productId,
    p_is_elite: isElite,
  });

  if (error) {
    throw error;
  }
}
