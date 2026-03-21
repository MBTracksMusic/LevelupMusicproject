import { useCallback, useEffect, useState } from 'react';
import { grantAnalyticsConsent, revokeAnalyticsConsent } from '../lib/analytics';

export type CookieConsentStatus = 'granted' | 'denied' | 'unknown';

const COOKIE_CHOICE_KEY = 'beatelion_cookie_choice';

function readStoredConsent(): CookieConsentStatus {
  if (typeof window === 'undefined') {
    return 'unknown';
  }

  try {
    const value = window.localStorage.getItem(COOKIE_CHOICE_KEY);
    if (value === 'granted' || value === 'denied') {
      return value;
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function writeStoredConsent(value: Exclude<CookieConsentStatus, 'unknown'>) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(COOKIE_CHOICE_KEY, value);
  } catch {
    // Ignore storage failures to stay fail-safe.
  }
}

export function useCookieConsent() {
  const [consentStatus, setConsentStatus] = useState<CookieConsentStatus>(() => readStoredConsent());

  useEffect(() => {
    const storedConsent = readStoredConsent();
    setConsentStatus(storedConsent);

    if (storedConsent === 'granted') {
      void grantAnalyticsConsent();
      return;
    }

    if (storedConsent === 'denied') {
      revokeAnalyticsConsent();
    }
  }, []);

  const acceptCookies = useCallback(() => {
    writeStoredConsent('granted');
    setConsentStatus('granted');
    void grantAnalyticsConsent();
  }, []);

  const rejectCookies = useCallback(() => {
    writeStoredConsent('denied');
    setConsentStatus('denied');
    revokeAnalyticsConsent();
  }, []);

  return {
    consentStatus,
    acceptCookies,
    rejectCookies,
    hasAnswered: consentStatus !== 'unknown',
  };
}
