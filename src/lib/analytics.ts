type AnalyticsValue = string | number | boolean | null | undefined;
type EcommerceItem = {
  item_id: string;
  item_name?: string;
  price?: number;
  quantity?: number;
};
type AnalyticsParams = Record<string, AnalyticsValue | EcommerceItem[]>;
type ConsentMode = 'default' | 'update';
type ConsentParams = {
  analytics_storage: 'denied' | 'granted';
};
type ConfigParams = {
  user_id?: string;
};

declare global {
  interface Window {
    gtag?: {
      (command: 'event', eventName: string, params?: AnalyticsParams): void;
      (command: 'consent', mode: ConsentMode, params: ConsentParams): void;
      (command: 'config', target: string, params?: ConfigParams): void;
    };
  }
}

const ANALYTICS_CONSENT_KEY = 'beatelion_analytics_consent';
const MEASUREMENT_ID =
  (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim() || null;
const DEFAULT_CONSENT: ConsentParams = {
  analytics_storage: 'denied',
};
const GRANTED_CONSENT: ConsentParams = {
  analytics_storage: 'granted',
};
let consentInitialized = false;
let configuredUserId: string | null = null;

function canTrack() {
  return typeof window !== 'undefined' && typeof window.gtag === 'function';
}

function trackOnce(key: string, callback: () => void) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (window.sessionStorage.getItem(key) === '1') {
      return;
    }
    callback();
    window.sessionStorage.setItem(key, '1');
  } catch {
    callback();
  }
}

export const trackEvent = (eventName: string, params?: AnalyticsParams) => {
  if (canTrack()) {
    window.gtag('event', eventName, params);
  }
};

export function trackPage(path: string) {
  if (typeof window === 'undefined') {
    return;
  }

  trackEvent('page_view', {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_title: document.title,
  });
}

export function trackSignUp(method = 'email', referrer?: string | null) {
  trackEvent('sign_up', { method, referrer: referrer ?? undefined });
}

export function trackLogin(method = 'email') {
  trackEvent('login', { method });
}

export function trackViewItem(params: {
  itemId?: string;
  itemName: string;
  price?: number;
}): void;
export function trackViewItem(itemName: string, itemId?: string, price?: number): void;
export function trackViewItem(
  paramsOrItemName: {
    itemId?: string;
    itemName: string;
    price?: number;
  } | string,
  itemId?: string,
  price?: number,
) {
  const params =
    typeof paramsOrItemName === 'string'
      ? {
          itemId,
          itemName: paramsOrItemName,
          price,
        }
      : paramsOrItemName;

  trackEvent('view_item', {
    items: [
      {
        item_id: params.itemId ?? 'unknown',
        item_name: params.itemName,
        price: params.price,
      },
    ],
  });
}

export function trackAddToCart(params: {
  productId: string;
  productName?: string;
  price: number;
}) {
  const value = params.price / 100;

  trackEvent('add_to_cart', {
    currency: 'EUR',
    value,
    items: [
      {
        item_id: params.productId,
        item_name: params.productName ?? undefined,
        price: value,
        quantity: 1,
      },
    ],
  });
}

export function trackBeatPlay(params: {
  beatId: string;
  title: string;
  producerId?: string;
}) {
  trackEvent('beat_play', {
    beat_id: params.beatId,
    title: params.title,
    producer_id: params.producerId,
  });
}

export function trackBeatPause(beatId: string) {
  trackEvent('beat_pause', {
    beat_id: beatId,
  });
}

export function trackBeatComplete(beatId: string) {
  trackEvent('beat_complete', {
    beat_id: beatId,
  });
}

export function trackBeatLike(beatId: string) {
  trackEvent('beat_like', {
    beat_id: beatId,
  });
}

export function trackLicenseSelected(params: {
  productId: string;
  licenseId: string;
  licenseType: string;
  value: number;
  productName?: string | null;
}) {
  trackEvent('license_selected', {
    product_id: params.productId,
    license_id: params.licenseId,
    license_type: params.licenseType,
    item_name: params.productName ?? undefined,
    value: params.value,
    currency: 'EUR',
  });
}

export function trackPriceViewed(params: {
  productId: string;
  value: number;
  licenseId?: string | null;
  licenseType?: string | null;
  productName?: string | null;
}) {
  trackEvent('price_viewed', {
    product_id: params.productId,
    license_id: params.licenseId ?? undefined,
    license_type: params.licenseType ?? undefined,
    item_name: params.productName ?? undefined,
    value: params.value,
    currency: 'EUR',
  });
}

export function trackClickBuy(params: {
  productId: string;
  price: number;
  productName?: string | null;
  currency?: string;
}) {
  trackEvent('select_item', {
    item_id: params.productId,
    item_name: params.productName ?? undefined,
    value: params.price,
    currency: params.currency ?? 'EUR',
  });
}

export function trackBeginCheckout(params: {
  productId: string;
  price: number;
  productName?: string | null;
  currency?: string;
}) {
  trackEvent('begin_checkout', {
    value: params.price,
    currency: params.currency ?? 'EUR',
    items: [
      {
        item_id: params.productId,
        item_name: params.productName ?? undefined,
        price: params.price,
        quantity: 1,
      },
    ],
  });
}

export function trackPurchase(params: {
  transactionId: string;
  value: number;
  currency?: string;
  itemId?: string;
  itemName?: string;
}) {
  trackOnce(`ga:purchase:${params.transactionId}`, () => {
    trackEvent('purchase', {
      transaction_id: params.transactionId,
      value: params.value,
      currency: params.currency ?? 'EUR',
      items: [
        {
          item_id: params.itemId ?? 'unknown',
          item_name: params.itemName ?? 'unknown',
          price: params.value,
          quantity: 1,
        },
      ],
    });
  });
}

export function trackPurchaseByLicense(params: {
  transactionId: string;
  productId: string;
  value: number;
  currency?: string;
  licenseId?: string | null;
  licenseType?: string | null;
  itemName?: string | null;
}) {
  trackOnce(`ga:purchase_by_license:${params.transactionId}`, () => {
    trackEvent('purchase_by_license', {
      transaction_id: params.transactionId,
      product_id: params.productId,
      license_id: params.licenseId ?? undefined,
      license_type: params.licenseType ?? undefined,
      item_name: params.itemName ?? undefined,
      value: params.value,
      currency: params.currency ?? 'EUR',
    });
  });
}

export function trackSubscriptionStart(params: {
  plan: string;
  value: number;
  subscriptionId?: string | null;
}) {
  const onceKey = params.subscriptionId
    ? `ga:subscription:${params.subscriptionId}`
    : `ga:subscription:${params.plan}:${params.value}`;

  trackOnce(onceKey, () => {
    trackEvent('subscription_start', {
      plan: params.plan,
      value: params.value,
    });
  });
}

export function trackUploadBeat() {
  trackEvent('upload_beat');
}

export function trackJoinBattle(battleId?: string) {
  if (!battleId) {
    trackEvent('join_battle');
    return;
  }

  trackOnce(`ga:join_battle:${battleId}`, () => {
    trackEvent('join_battle', {
      battle_id: battleId,
    });
  });
}

// --- Referrer ---

const REFERRER_KEY = 'beatelion_referrer';

/** Stocke le referrer dans localStorage une seule fois (le premier gagne).
 *  Les valeurs vides ou "anon" sont ignorées — seuls les vrais user IDs sont stockés. */
export function storeReferrer(ref: string): void {
  if (!ref || ref === 'anon') return;
  try {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(REFERRER_KEY)) {
      window.localStorage.setItem(REFERRER_KEY, ref);
    }
  } catch { /* localStorage bloqué (private mode strict, etc.) */ }
}

/** Retourne le referrer stocké, ou null. */
export function getReferrer(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(REFERRER_KEY) : null;
  } catch {
    return null;
  }
}

// --- Battle tracking ---

export function trackBattleView(params: {
  battleId: string;
  slug: string;
  referrer: string | null;
}) {
  trackEvent('battle_view', {
    battle_id: params.battleId,
    slug: params.slug,
    referrer: params.referrer,
  });
}

export function trackBattleShare(params: {
  battleId: string;
  method: 'native' | 'clipboard';
}) {
  trackEvent('battle_share', {
    battle_id: params.battleId,
    method: params.method,
  });
}

export function trackBattleVote(params: {
  battleId: string;
  referrer: string | null;
}) {
  trackEvent('battle_vote_submitted', {
    battle_id: params.battleId,
    referrer: params.referrer,
  });
}

export async function initAnalytics() {
  if (!canTrack() || consentInitialized) {
    return;
  }

  const consent =
    typeof window !== 'undefined' && window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'granted'
      ? GRANTED_CONSENT
      : DEFAULT_CONSENT;

  window.gtag('consent', 'default', consent);
  consentInitialized = true;
}

export function setAnalyticsUserId(userId: string) {
  if (!canTrack() || !userId || configuredUserId === userId || !MEASUREMENT_ID) {
    return;
  }

  window.gtag('config', MEASUREMENT_ID, {
    user_id: userId,
  });
  configuredUserId = userId;
}

export function clearAnalyticsUserId() {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function' || !MEASUREMENT_ID) {
    return;
  }

  window.gtag('config', MEASUREMENT_ID, {
    user_id: undefined,
  });

  configuredUserId = null;
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

  if (canTrack()) {
    window.gtag('consent', 'update', GRANTED_CONSENT);
  }
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

  if (canTrack()) {
    window.gtag('consent', 'update', DEFAULT_CONSENT);
  }
}

export function useAnalytics() {
  return {
    initAnalytics,
    grantAnalyticsConsent,
    revokeAnalyticsConsent,
    clearAnalyticsUserId,
    setAnalyticsUserId,
    getReferrer,
    storeReferrer,
    trackAddToCart,
    trackBattleShare,
    trackBattleVote,
    trackBattleView,
    trackBeatComplete,
    trackBeatLike,
    trackBeatPause,
    trackBeatPlay,
    trackBeginCheckout,
    trackClickBuy,
    trackEvent,
    trackJoinBattle,
    trackLicenseSelected,
    trackLogin,
    trackPage,
    trackPriceViewed,
    trackPurchase,
    trackPurchaseByLicense,
    trackSignUp,
    trackSubscriptionStart,
    trackUploadBeat,
    trackViewItem,
  };
}
