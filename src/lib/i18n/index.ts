import { useCallback } from 'react';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { fr, type TranslationSchema } from './translations/fr';
import { en } from './translations/en';
import { de } from './translations/de';
import { updateProfile } from '../auth/service';
import { supabase } from '../supabase/client';

const I18N_STORAGE_KEY = 'levelup-language';
const SUPPORTED_LANGUAGES = ['fr', 'en', 'de'] as const;
const FALLBACK_LANGUAGE = 'en';

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const translations: Record<Language, TranslationSchema> = {
  fr,
  en,
  de,
};

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
}

type I18nPersistedState = Pick<I18nState, 'language'>;

const supportedLanguageSet = new Set<string>(SUPPORTED_LANGUAGES);

export function isValidLanguage(value: string): value is Language {
  return supportedLanguageSet.has(value);
}

function resolveLanguageCandidate(value: unknown): Language | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (isValidLanguage(normalized)) return normalized;

  const baseLanguage = normalized.split(/[-_]/)[0];
  return isValidLanguage(baseLanguage) ? baseLanguage : null;
}

function resolveBrowserLanguage(): Language | null {
  if (typeof navigator === 'undefined') return null;

  const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];

  for (const candidate of candidates) {
    const resolvedLanguage = resolveLanguageCandidate(candidate);
    if (resolvedLanguage) {
      return resolvedLanguage;
    }
  }

  return null;
}

export function resolveInitialLanguage(profileLanguage?: unknown): Language {
  return resolveLanguageCandidate(profileLanguage) ?? resolveBrowserLanguage() ?? FALLBACK_LANGUAGE;
}

function updateDocumentLanguage(language: Language) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

function readPersistedLanguage(value: unknown): Language | null {
  if (!value || typeof value !== 'object') return null;

  const persistedState = value as {
    state?: {
      language?: unknown;
    };
    version?: number;
  };

  return resolveLanguageCandidate(persistedState.state?.language);
}

const i18nStorage: PersistStorage<I18nPersistedState> = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null;

    const rawValue = window.localStorage.getItem(name);
    if (!rawValue) return null;

    try {
      const parsedValue = JSON.parse(rawValue) as StorageValue<I18nPersistedState> | null;
      const persistedLanguage = readPersistedLanguage(parsedValue);

      if (!persistedLanguage) {
        window.localStorage.removeItem(name);
        return null;
      }

      return {
        state: {
          language: persistedLanguage,
        },
        version: typeof parsedValue?.version === 'number' ? parsedValue.version : undefined,
      };
    } catch (error) {
      window.localStorage.removeItem(name);
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return;

    const nextValue: StorageValue<I18nPersistedState> = {
      ...value,
      state: {
        language: resolveLanguageCandidate(value.state.language) ?? FALLBACK_LANGUAGE,
      },
    };

    window.localStorage.setItem(name, JSON.stringify(nextValue));
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(name);
  },
};

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: resolveInitialLanguage(),
      setLanguage: (language) => {
        updateDocumentLanguage(language);
        set({ language });
      },
    }),
    {
      name: I18N_STORAGE_KEY,
      storage: i18nStorage,
      partialize: (state) => ({
        language: state.language,
      }),
      onRehydrateStorage: () => (state) => {
        updateDocumentLanguage(state?.language ?? resolveInitialLanguage());
      },
    }
  )
);

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? `${K}.${NestedKeyOf<T[K]>}`
        : K;
    }[keyof T & string]
  : never;

export type TranslationKey = NestedKeyOf<typeof fr>;
export type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

function getNestedValue(obj: unknown, path: string): string {
  const keys = path.split('.');
  let result: unknown = obj;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return path;
    }
  }
  return typeof result === 'string' ? result : path;
}

export function syncI18nLanguage(profileLanguage?: unknown) {
  const resolvedLanguage = resolveInitialLanguage(profileLanguage);
  const { language, setLanguage } = useI18nStore.getState();

  if (language !== resolvedLanguage) {
    setLanguage(resolvedLanguage);
  } else {
    updateDocumentLanguage(language);
  }
}

export async function updateLanguage(language: string): Promise<Language> {
  const resolvedLanguage = resolveLanguageCandidate(language) ?? FALLBACK_LANGUAGE;
  const { language: previousLanguage, setLanguage } = useI18nStore.getState();

  if (previousLanguage !== resolvedLanguage) {
    setLanguage(resolvedLanguage);
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await updateProfile({ language: resolvedLanguage });
    }

    return resolvedLanguage;
  } catch (error) {
    if (previousLanguage !== resolvedLanguage) {
      setLanguage(previousLanguage);
    }

    throw error;
  }
}

export function useTranslation() {
  const language = useI18nStore((state) => state.language);
  const currentTranslations = translations[language] ?? translations[FALLBACK_LANGUAGE];

  const translate = useCallback<TranslateFn>((key, params) => {
    let text = getNestedValue(currentTranslations, key);

    if (text === key && language !== FALLBACK_LANGUAGE) {
      const fallbackText = getNestedValue(translations[FALLBACK_LANGUAGE], key);
      if (fallbackText !== key) {
        text = fallbackText;
      } else if (import.meta.env.DEV) {
        console.warn(
          `[i18n] Missing translation key "${key}" for "${language}" and fallback "${FALLBACK_LANGUAGE}".`
        );
      }
    }

    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(`{${paramKey}}`, String(value));
      });
    }

    return text;
  }, [currentTranslations, language]);

  return {
    t: translate,
    language,
    updateLanguage,
    languages: SUPPORTED_LANGUAGES,
  };
}

export const languageNames: Record<Language, string> = {
  fr: 'Francais',
  en: 'English',
  de: 'Deutsch',
};

updateDocumentLanguage(useI18nStore.getState().language);
