const MEASUREMENT_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim() ?? '';
const ALLOWED_HOSTNAMES = new Set(['beatelion.com', 'www.beatelion.com']);
const ANALYTICS_CONSENT_KEY = 'beatelion_analytics_consent';
const DEFAULT_CONSENT = {
  analytics_storage: 'denied',
} as const;
const GRANTED_CONSENT = {
  analytics_storage: 'granted',
} as const;

type GtagParams = Record<string, string | number | boolean | null | undefined>;
type ConsentMode = 'default' | 'update';
type ConsentParams = {
  analytics_storage: 'denied' | 'granted';
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: {
      (command: 'js', target: Date): void;
      (command: 'config', target: string, params?: GtagParams): void;
      (command: 'event', target: string, params?: GtagParams): void;
      (command: 'consent', target: ConsentMode, params: ConsentParams): void;
    };
  }
}

let analyticsInitialized = false;
let analyticsInitPromise: Promise<void> | null = null;
let consentDefaultApplied = false;

function hasAnalyticsConsent() {
  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

function canRunAnalytics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  if (!import.meta.env.PROD || !MEASUREMENT_ID) {
    return false;
  }

  return ALLOWED_HOSTNAMES.has(window.location.hostname) && hasAnalyticsConsent();
}

function ensureGtagRuntime() {
  window.dataLayer = window.dataLayer ?? [];

  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    } as Window['gtag'];
  }
}

function applyDefaultConsent() {
  ensureGtagRuntime();

  if (consentDefaultApplied) {
    return;
  }

  window.gtag?.('consent', 'default', DEFAULT_CONSENT);
  consentDefaultApplied = true;
}

function loadGtagScript() {
  const existingScript = document.querySelector<HTMLScriptElement>(
    `script[data-ga-measurement-id="${MEASUREMENT_ID}"]`,
  );

  if (existingScript) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    script.dataset.gaMeasurementId = MEASUREMENT_ID;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Analytics script'));
    document.head.appendChild(script);
  });
}

async function withAnalyticsReady(callback: () => void) {
  await initAnalytics();

  if (!analyticsInitialized || typeof window.gtag !== 'function') {
    return;
  }

  callback();
}

export async function initAnalytics() {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    applyDefaultConsent();
  }

  if (!canRunAnalytics()) {
    return;
  }

  if (analyticsInitialized) {
    return;
  }

  if (!analyticsInitPromise) {
    analyticsInitPromise = loadGtagScript()
      .then(() => {
        applyDefaultConsent();
        window.gtag?.('js', new Date());
        window.gtag?.('config', MEASUREMENT_ID, {
          send_page_view: false,
          anonymize_ip: true,
        });
        analyticsInitialized = true;
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.error('GA init failed', err);
        }
        analyticsInitialized = false;
      })
      .finally(() => {
        analyticsInitPromise = null;
      });
  }

  await analyticsInitPromise;
}

export function trackPage(path: string) {
  void withAnalyticsReady(() => {
    window.gtag?.('event', 'page_view', {
      page_path: path,
      page_location: `${window.location.origin}${path}`,
      page_title: document.title,
    });
  });
}

export function trackEvent(name: string, params: GtagParams = {}) {
  void withAnalyticsReady(() => {
    window.gtag?.('event', name, params);
  });
}

export async function grantAnalyticsConsent() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, 'granted');
  } catch {
    return;
  }

  applyDefaultConsent();
  window.gtag?.('consent', 'update', GRANTED_CONSENT);
  await initAnalytics();
}

export function revokeAnalyticsConsent() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  } catch {
    return;
  }

  applyDefaultConsent();
  window.gtag?.('consent', 'update', DEFAULT_CONSENT);
}

export function useAnalytics() {
  return {
    initAnalytics,
    grantAnalyticsConsent,
    revokeAnalyticsConsent,
    trackEvent,
    trackPage,
  };
}
