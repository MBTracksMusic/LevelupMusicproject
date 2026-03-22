import { supabase } from './supabase/client';
import type { License, ProductLicense, ProductWithRelations } from './supabase/types';

type ProductLicenseRow = {
  id: string;
  product_id: string;
  license_id: string;
  license_type: string;
  price: number;
  stripe_price_id: string | null;
  features: ProductLicense['features'];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  license?: License | null;
};

const LICENSE_SELECT_COLUMNS = [
  'id',
  'product_id',
  'license_id',
  'license_type',
  'price',
  'stripe_price_id',
  'features',
  'sort_order',
  'is_active',
  'created_at',
  'updated_at',
  'license:licenses(id, name, description, max_streams, max_sales, youtube_monetization, music_video_allowed, credit_required, exclusive_allowed, price, created_at, updated_at)',
].join(', ');

export function normalizeLicenseType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

export function sortProductLicenses(licenses: ProductLicense[]) {
  return [...licenses].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    if (left.price !== right.price) {
      return left.price - right.price;
    }
    return left.license_type.localeCompare(right.license_type);
  });
}

export function getProductActiveLicenses(product: { licenses?: ProductLicense[] | null } | null | undefined) {
  const licenses = (product?.licenses ?? []).filter((license): license is ProductLicense => Boolean(license));
  return sortProductLicenses(licenses.filter((license) => license.is_active !== false));
}

export function getDefaultProductLicense(product: { licenses?: ProductLicense[] | null } | null | undefined) {
  return getProductActiveLicenses(product)[0] ?? null;
}

export function getDisplayPrice(product: { price?: number | null; licenses?: ProductLicense[] | null } | null | undefined) {
  return product?.price ?? 0;
}

export function hasMultipleLicenses(_product: { licenses?: ProductLicense[] | null } | null | undefined) {
  return false;
}

export function getLicenseDisplayName(
  license: Pick<ProductLicense, 'license_type' | 'license'> | null | undefined
) {
  const licenseName = license?.license?.name?.trim();
  if (licenseName) {
    return licenseName;
  }

  const licenseType = license?.license_type?.trim();
  if (!licenseType) {
    return 'License';
  }

  return licenseType.charAt(0).toUpperCase() + licenseType.slice(1);
}

export function resolveProductLicense(
  product: { licenses?: ProductLicense[] | null } | null | undefined,
  options?: {
    licenseId?: string | null;
    licenseType?: string | null;
  }
) {
  const licenses = getProductActiveLicenses(product);
  if (licenses.length === 0) {
    return null;
  }

  const normalizedId = options?.licenseId?.trim() ?? '';
  if (normalizedId) {
    const matchedById = licenses.find((license) => license.license_id === normalizedId);
    if (matchedById) {
      return matchedById;
    }
  }

  const normalizedType = normalizeLicenseType(options?.licenseType);
  if (normalizedType) {
    const matchedByType = licenses.find((license) => {
      return (
        normalizeLicenseType(license.license_type) === normalizedType ||
        normalizeLicenseType(license.license?.name) === normalizedType
      );
    });
    if (matchedByType) {
      return matchedByType;
    }
  }

  return licenses[0] ?? null;
}

export async function fetchProductLicensesMap(productIds: string[]) {
  const uniqueIds = [...new Set(productIds.filter((productId) => productId.trim().length > 0))];
  const licenseMap = new Map<string, ProductLicense[]>();

  if (uniqueIds.length === 0) {
    return licenseMap;
  }

  try {
    const { data, error } = await supabase
      .from('product_licenses')
      .select(LICENSE_SELECT_COLUMNS)
      .in('product_id', uniqueIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('price', { ascending: true });

    if (error) {
      throw error;
    }

    for (const row of ((data ?? []) as ProductLicenseRow[])) {
      const bucket = licenseMap.get(row.product_id) ?? [];
      bucket.push({
        id: row.id,
        product_id: row.product_id,
        license_id: row.license_id,
        license_type: row.license_type,
        price: row.price,
        stripe_price_id: row.stripe_price_id,
        features: row.features,
        sort_order: row.sort_order,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        license: row.license ?? null,
      });
      licenseMap.set(row.product_id, bucket);
    }

    for (const [productId, licenses] of licenseMap.entries()) {
      licenseMap.set(productId, sortProductLicenses(licenses));
    }

    return licenseMap;
  } catch (error) {
    console.error('pricing license fetch error', error);
    return licenseMap;
  }
}

export function attachLicensesToProducts<T extends { id: string; price: number; licenses?: ProductLicense[] }>(
  products: T[],
  licensesMap: Map<string, ProductLicense[]>
) {
  return products.map((product) => {
    const licenses = licensesMap.get(product.id) ?? [];

    return {
      ...product,
      licenses,
    };
  });
}

export async function attachProductLicenses(products: ProductWithRelations[]) {
  if (products.length === 0) {
    return products;
  }

  const licensesMap = await fetchProductLicensesMap(products.map((product) => product.id));
  return attachLicensesToProducts(products, licensesMap);
}
