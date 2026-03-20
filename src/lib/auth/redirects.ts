const DEFAULT_PRODUCTION_SITE_URL = 'https://www.beatelion.com';

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function getCanonicalSiteUrl(): string {
  const configuredSiteUrl = import.meta.env.VITE_SITE_URL as string | undefined;

  if (typeof window !== 'undefined' && isLocalhostHostname(window.location.hostname)) {
    return normalizeBaseUrl(window.location.origin);
  }

  if (configuredSiteUrl?.trim()) {
    return normalizeBaseUrl(configuredSiteUrl);
  }

  return DEFAULT_PRODUCTION_SITE_URL;
}

export function getAuthRedirectUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getCanonicalSiteUrl()}${normalizedPath}`;
}
