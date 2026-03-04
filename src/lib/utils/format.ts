const LANGUAGE_LOCALE_MAP = {
  fr: 'fr-FR',
  en: 'en-US',
  de: 'de-DE',
} as const;

function resolveActiveLocale(locale?: string): string {
  if (locale) return locale;

  if (typeof document !== 'undefined') {
    const documentLanguage = document.documentElement.lang.trim().toLowerCase();
    if (documentLanguage in LANGUAGE_LOCALE_MAP) {
      return LANGUAGE_LOCALE_MAP[documentLanguage as keyof typeof LANGUAGE_LOCALE_MAP];
    }
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }

  return LANGUAGE_LOCALE_MAP.en;
}

export function formatPrice(cents: number, currency = 'EUR', locale?: string): string {
  const amount = cents / 100;
  return new Intl.NumberFormat(resolveActiveLocale(locale), {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatDate(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(resolveActiveLocale(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

export function formatDateTime(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(resolveActiveLocale(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatRelativeTime(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  const resolvedLocale = resolveActiveLocale(locale);

  const rtf = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: 'auto' });

  if (diffInSeconds < 60) {
    return rtf.format(-diffInSeconds, 'second');
  }
  if (diffInSeconds < 3600) {
    return rtf.format(-Math.floor(diffInSeconds / 60), 'minute');
  }
  if (diffInSeconds < 86400) {
    return rtf.format(-Math.floor(diffInSeconds / 3600), 'hour');
  }
  if (diffInSeconds < 2592000) {
    return rtf.format(-Math.floor(diffInSeconds / 86400), 'day');
  }
  if (diffInSeconds < 31536000) {
    return rtf.format(-Math.floor(diffInSeconds / 2592000), 'month');
  }
  return rtf.format(-Math.floor(diffInSeconds / 31536000), 'year');
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatNumber(num: number, locale?: string): string {
  return new Intl.NumberFormat(resolveActiveLocale(locale)).format(num);
}

export function formatCompactNumber(num: number, locale?: string): string {
  return new Intl.NumberFormat(resolveActiveLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(num);
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
