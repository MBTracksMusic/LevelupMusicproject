import { supabase } from './client';
import type { Database } from './database.types';
import type { LabelRequest, ProductWithRelations } from './types';
import { fetchPublicProducerProfilesMap } from './publicProfiles';
import { GENRE_SAFE_COLUMNS, MOOD_SAFE_COLUMNS, PRODUCT_SAFE_COLUMNS } from './selects';

type EliteProductRow = Database['public']['Tables']['products']['Row'] & {
  genre: Database['public']['Tables']['genres']['Row'] | null;
  mood: Database['public']['Tables']['moods']['Row'] | null;
};

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
  `genre:genres(${GENRE_SAFE_COLUMNS})`,
  `mood:moods(${MOOD_SAFE_COLUMNS})`,
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
  const { data, error } = await supabase
    .from('products')
    .select(ELITE_PRODUCT_COLUMNS as any)
    .eq('product_type', 'beat')
    .eq('is_published', true)
    .eq('status', 'active')
    .eq('is_elite', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data as unknown as EliteProductRow[] | null) ?? [];
  const producerProfiles = await fetchPublicProducerProfilesMap(rows.map((row) => row.producer_id));

  return rows.map((row) => {
    const producerProfile = producerProfiles.get(row.producer_id);

    return {
      ...(row as ProductWithRelations),
      genre: row.genre ?? undefined,
      mood: row.mood ?? undefined,
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
  reviewerId: string;
}): Promise<void> {
  const reviewedAt = new Date().toISOString();

  const { error: profileError } = await supabase
    .from('user_profiles')
    .update({
      account_type: 'label',
      is_verified: true,
    })
    .eq('id', options.userId);

  if (profileError) {
    throw profileError;
  }

  const { error: requestError } = await supabase
    .from('label_requests')
    .update({
      status: 'approved',
      reviewed_at: reviewedAt,
      reviewed_by: options.reviewerId,
    })
    .eq('id', options.requestId);

  if (requestError) {
    throw requestError;
  }
}

export async function promoteEliteProducer(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({
      account_type: 'elite_producer',
    })
    .eq('id', userId);

  if (error) {
    throw error;
  }
}

export async function toggleEliteProduct(productId: string, isElite: boolean): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({
      is_elite: isElite,
    })
    .eq('id', productId);

  if (error) {
    throw error;
  }
}
