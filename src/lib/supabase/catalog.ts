import { supabase } from './client';
import type { Database, Json } from './database.types';
import { attachProductLicenses } from '../pricing';
import { isEarlyAccessActive } from '../products/earlyAccess';
import { fetchPublicProducerProfilesMap } from './publicProfiles';
import { GENRE_SAFE_COLUMNS, MOOD_SAFE_COLUMNS, PRODUCT_SAFE_COLUMNS } from './selects';
import type { ProductWithRelations } from './types';

export type CatalogMode = 'beats' | 'exclusives' | 'kits';

export interface CatalogFilters {
  search: string;
  genre: string;
  mood: string;
  bpmMin: string;
  bpmMax: string;
  priceMin: string;
  priceMax: string;
  sort: string;
}

interface FetchCatalogProductsParams {
  mode: CatalogMode;
  filters: CatalogFilters;
  limit?: number;
  offset?: number;
  restrictToActiveProducers?: boolean;
  hasPremiumAccess?: boolean;
}

export interface CatalogPage {
  products: ProductWithRelations[];
  total: number;
}

interface FetchCatalogProductBySlugParams {
  slug: string;
  routePrefix: string;
}

type CatalogProductRow = Database['public']['Views']['public_catalog_products']['Row'];

const CATALOG_SELECT_COLUMNS = [
  'id',
  'producer_id',
  'title',
  'slug',
  'description',
  'product_type',
  'genre_id',
  'genre_name',
  'genre_name_en',
  'genre_name_de',
  'genre_slug',
  'mood_id',
  'mood_name',
  'mood_name_en',
  'mood_name_de',
  'mood_slug',
  'bpm',
  'key_signature',
  'price',
  'early_access_until',
  'watermarked_path',
  'watermarked_bucket',
  'preview_url',
  'exclusive_preview_url',
  'cover_image_url',
  'is_exclusive',
  'is_sold',
  'sold_at',
  'sold_to_user_id',
  'is_published',
  'status',
  'version',
  'original_beat_id',
  'version_number',
  'parent_product_id',
  'archived_at',
  'play_count',
  'tags',
  'duration_seconds',
  'file_format',
  'license_terms',
  'watermark_profile_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'producer_username',
  'producer_raw_username',
  'producer_avatar_url',
  'producer_is_active',
  'sales_count',
  'battle_wins',
  'recency_bonus',
  'performance_score',
  'producer_rank',
  'top_10_flag',
].join(', ');

const DEFAULT_TIMESTAMP = new Date(0).toISOString();

const toProduct = (row: CatalogProductRow): ProductWithRelations => {
  const createdAt = row.created_at ?? DEFAULT_TIMESTAMP;
  const updatedAt = row.updated_at ?? createdAt;
  const producerUsername = row.producer_username ?? row.producer_raw_username ?? null;

  return {
    id: row.id ?? '',
    producer_id: row.producer_id ?? '',
    title: row.title ?? '',
    slug: row.slug ?? '',
    description: row.description,
    product_type: (row.product_type ?? 'beat') as ProductWithRelations['product_type'],
    genre_id: row.genre_id,
    mood_id: row.mood_id,
    bpm: row.bpm,
    key_signature: row.key_signature,
    price: row.price ?? 0,
    early_access_until: row.early_access_until,
    watermarked_path: row.watermarked_path,
    watermarked_bucket: row.watermarked_bucket,
    preview_url: row.preview_url,
    exclusive_preview_url: row.exclusive_preview_url,
    cover_image_url: row.cover_image_url,
    is_exclusive: row.is_exclusive ?? false,
    is_sold: row.is_sold ?? false,
    sold_at: row.sold_at,
    sold_to_user_id: row.sold_to_user_id,
    is_published: row.is_published ?? false,
    status: row.status ?? 'active',
    version: row.version ?? 1,
    original_beat_id: row.original_beat_id,
    version_number: row.version_number ?? 1,
    parent_product_id: row.parent_product_id,
    archived_at: row.archived_at,
    play_count: row.play_count ?? 0,
    tags: row.tags,
    duration_seconds: row.duration_seconds,
    file_format: row.file_format,
    license_terms: (row.license_terms ?? null) as Json,
    watermark_profile_id: row.watermark_profile_id,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: row.deleted_at,
    producer: row.producer_id
      ? {
          id: row.producer_id,
          username: producerUsername,
          avatar_url: row.producer_avatar_url,
        }
      : undefined,
    genre: row.genre_id
      ? {
          id: row.genre_id,
          name: row.genre_name ?? '',
          name_en: row.genre_name_en ?? row.genre_name ?? '',
          name_de: row.genre_name_de ?? row.genre_name ?? '',
          slug: row.genre_slug ?? '',
          description: null,
          icon: null,
          sort_order: 0,
          is_active: true,
          created_at: createdAt,
        }
      : undefined,
    mood: row.mood_id
      ? {
          id: row.mood_id,
          name: row.mood_name ?? '',
          name_en: row.mood_name_en ?? row.mood_name ?? '',
          name_de: row.mood_name_de ?? row.mood_name ?? '',
          slug: row.mood_slug ?? '',
          description: null,
          color: null,
          sort_order: 0,
          is_active: true,
          created_at: createdAt,
        }
      : undefined,
  } as ProductWithRelations;
};

const hasMissingProducerIdentity = (product: ProductWithRelations) => {
  if (!product.producer_id) return false;
  const username = product.producer?.username;
  if (typeof username !== 'string') return true;
  return username.trim().length === 0;
};

const enrichMissingProducerIdentities = async (
  products: ProductWithRelations[]
): Promise<ProductWithRelations[]> => {
  const missingProducerIds = [
    ...new Set(
      products
        .filter(hasMissingProducerIdentity)
        .map((product) => product.producer_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    ),
  ];

  if (missingProducerIds.length === 0) {
    return products;
  }

  try {
    const profilesMap = await fetchPublicProducerProfilesMap(missingProducerIds);
    if (profilesMap.size === 0) return products;

    return products.map((product) => {
      if (!product.producer_id) return product;
      const profile = profilesMap.get(product.producer_id);
      if (!profile) return product;

      return {
        ...product,
        producer: {
          id: product.producer_id,
          username: profile.username ?? profile.raw_username ?? product.producer?.username ?? null,
          avatar_url: profile.avatar_url ?? product.producer?.avatar_url ?? null,
        } as ProductWithRelations['producer'],
      } as ProductWithRelations;
    });
  } catch (error) {
    console.error('catalog producer identity enrich error', error);
    return products;
  }
};

const applyProducerVisibility = async (
  products: ProductWithRelations[],
  restrictToActiveProducers: boolean
): Promise<ProductWithRelations[]> => {
  if (!restrictToActiveProducers) {
    return enrichMissingProducerIdentities(products);
  }

  const producerIds = [
    ...new Set(
      products
        .map((product) => product.producer_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    ),
  ];

  if (producerIds.length === 0) {
    return products;
  }

  try {
    const profilesMap = await fetchPublicProducerProfilesMap(producerIds);

    const visibleProducts = products.filter((product) => {
      const profile = profilesMap.get(product.producer_id);
      return profile?.is_producer_active === true;
    });

    return visibleProducts.map((product) => {
      const profile = profilesMap.get(product.producer_id);
      if (!profile) return product;

      return {
        ...product,
        producer: {
          id: product.producer_id,
          username: profile.username ?? profile.raw_username ?? product.producer?.username ?? null,
          avatar_url: profile.avatar_url ?? product.producer?.avatar_url ?? null,
        } as ProductWithRelations['producer'],
      } as ProductWithRelations;
    });
  } catch (error) {
    console.error('catalog producer visibility enrich error', error);
    return enrichMissingProducerIdentities(products);
  }
};

const fetchLegacyCatalogProducts = async ({
  mode,
  filters,
  limit,
  offset,
  restrictToActiveProducers,
  hasPremiumAccess,
}: FetchCatalogProductsParams): Promise<CatalogPage> => {
  let query = supabase
    .from('products')
    .select(`
      ${PRODUCT_SAFE_COLUMNS},
      genre:genres(${GENRE_SAFE_COLUMNS}),
      mood:moods(${MOOD_SAFE_COLUMNS})
    ` as any)
    .eq('is_published', true);

  if (mode === 'exclusives') {
    query = query.eq('product_type', 'exclusive').eq('is_sold', false);
  } else if (mode === 'kits') {
    query = query.eq('product_type', 'kit');
  } else {
    query = query.eq('product_type', 'beat');
  }

  if (filters.genre) {
    query = query.eq('genre_id', filters.genre);
  }
  if (filters.mood) {
    query = query.eq('mood_id', filters.mood);
  }
  if (filters.bpmMin) {
    query = query.gte('bpm', Number.parseInt(filters.bpmMin, 10));
  }
  if (filters.bpmMax) {
    query = query.lte('bpm', Number.parseInt(filters.bpmMax, 10));
  }
  if (filters.priceMin) {
    query = query.gte('price', Number.parseInt(filters.priceMin, 10) * 100);
  }
  if (filters.priceMax) {
    query = query.lte('price', Number.parseInt(filters.priceMax, 10) * 100);
  }
  if (filters.search) {
    const escaped = filters.search.replace(/,/g, '');
    query = query.or(`title.ilike.%${escaped}%,tags.cs.{${escaped}}`);
  }

  switch (filters.sort) {
    case 'popular':
      query = query.order('play_count', { ascending: false });
      break;
    case 'price_asc':
      query = query.order('price', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price', { ascending: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  const off = offset ?? 0;
  const lim = limit ?? 50;
  const { data, error } = await query.range(off, off + lim - 1);
  if (error) {
    throw error;
  }

  const rows = (data as unknown as ProductWithRelations[] | null) ?? [];
  const earlyAccessFilteredRows = hasPremiumAccess
    ? rows
    : rows.filter((row) => !isEarlyAccessActive(row.early_access_until));
  const visibleProducts = await applyProducerVisibility(earlyAccessFilteredRows, restrictToActiveProducers ?? false);
  return { products: visibleProducts, total: visibleProducts.length };
};

const fetchLegacyCatalogProductBySlug = async ({
  slug,
  routePrefix,
}: FetchCatalogProductBySlugParams): Promise<ProductWithRelations | null> => {
  let query = supabase
    .from('products')
    .select(`
      ${PRODUCT_SAFE_COLUMNS},
      genre:genres(${GENRE_SAFE_COLUMNS}),
      mood:moods(${MOOD_SAFE_COLUMNS})
    ` as any)
    .eq('slug', slug)
    .eq('is_published', true);

  if (routePrefix === 'exclusives') {
    query = query.eq('is_exclusive', true);
  } else if (routePrefix === 'kits') {
    query = query.eq('product_type', 'kit');
  } else if (routePrefix === 'beats') {
    query = query.eq('product_type', 'beat').eq('is_exclusive', false);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }

  const row = (data as unknown as ProductWithRelations | null) ?? null;
  if (!row) return null;

  const [enriched] = await enrichMissingProducerIdentities([row]);
  const [withLicenses] = await attachProductLicenses([enriched ?? row]);
  return withLicenses ?? enriched ?? row;
};

export async function fetchCatalogProducts({
  mode,
  filters,
  limit = 50,
  offset = 0,
  restrictToActiveProducers = false,
  hasPremiumAccess = false,
}: FetchCatalogProductsParams): Promise<CatalogPage> {
  let query = supabase
    .from('public_catalog_products')
    .select(CATALOG_SELECT_COLUMNS, { count: 'exact' })
    .eq('is_published', true);

  if (mode === 'exclusives') {
    query = query.eq('product_type', 'exclusive').eq('is_sold', false);
  } else if (mode === 'kits') {
    query = query.eq('product_type', 'kit');
  } else {
    query = query.eq('product_type', 'beat');
  }

  if (filters.genre) {
    query = query.eq('genre_id', filters.genre);
  }
  if (filters.mood) {
    query = query.eq('mood_id', filters.mood);
  }
  if (filters.bpmMin) {
    query = query.gte('bpm', Number.parseInt(filters.bpmMin, 10));
  }
  if (filters.bpmMax) {
    query = query.lte('bpm', Number.parseInt(filters.bpmMax, 10));
  }
  if (filters.priceMin) {
    query = query.gte('price', Number.parseInt(filters.priceMin, 10) * 100);
  }
  if (filters.priceMax) {
    query = query.lte('price', Number.parseInt(filters.priceMax, 10) * 100);
  }
  if (filters.search) {
    const escaped = filters.search.replace(/,/g, '');
    query = query.or(`title.ilike.%${escaped}%,producer_username.ilike.%${escaped}%,tags.cs.{${escaped}}`);
  }

  if (mode === 'beats') {
    query = query.order('top_10_flag', { ascending: false });
    query = query.order('performance_score', { ascending: false });
  }

  switch (filters.sort) {
    case 'popular':
      query = query.order('play_count', { ascending: false });
      query = query.order('created_at', { ascending: false });
      break;
    case 'price_asc':
      query = query.order('price', { ascending: true });
      query = query.order('created_at', { ascending: false });
      break;
    case 'price_desc':
      query = query.order('price', { ascending: false });
      query = query.order('created_at', { ascending: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  if (restrictToActiveProducers) {
    query = query.eq('producer_is_active', true);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    console.warn('public_catalog_products query failed, falling back to products query', error);
    return fetchLegacyCatalogProducts({ mode, filters, limit, offset, restrictToActiveProducers, hasPremiumAccess });
  }

  const rows = (data as unknown as CatalogProductRow[] | null) ?? [];
  const products = rows.map(toProduct);
  const visibleProducts = await applyProducerVisibility(products, restrictToActiveProducers);
  return { products: visibleProducts, total: count ?? visibleProducts.length };
}

export async function fetchCatalogProductBySlug({
  slug,
  routePrefix,
}: FetchCatalogProductBySlugParams): Promise<ProductWithRelations | null> {
  let query = supabase
    .from('public_catalog_products')
    .select(CATALOG_SELECT_COLUMNS)
    .eq('slug', slug)
    .eq('is_published', true);

  if (routePrefix === 'exclusives') {
    query = query.eq('is_exclusive', true);
  } else if (routePrefix === 'kits') {
    query = query.eq('product_type', 'kit');
  } else if (routePrefix === 'beats') {
    query = query.eq('product_type', 'beat').eq('is_exclusive', false);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn('public_catalog_products detail query failed, falling back to products query', error);
    return fetchLegacyCatalogProductBySlug({ slug, routePrefix });
  }

  const row = (data as unknown as CatalogProductRow | null) ?? null;
  if (!row) {
    const fallbackRow = await fetchLegacyCatalogProductBySlug({ slug, routePrefix });
    if (!fallbackRow) {
      return null;
    }

    return isEarlyAccessActive(fallbackRow.early_access_until) ? fallbackRow : null;
  }

  const product = toProduct(row);
  const [enriched] = await enrichMissingProducerIdentities([product]);
  const [withLicenses] = await attachProductLicenses([enriched ?? product]);
  return withLicenses ?? enriched ?? product;
}
