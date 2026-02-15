import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fr, type TranslationKeys } from './translations/fr';
import { en } from './translations/en';
import { de } from './translations/de';

export type Language = 'fr' | 'en' | 'de';

const translations: Record<Language, TranslationKeys> = {
  fr,
  en,
  de,
};

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: 'fr',
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'levelup-language',
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

type TranslationKey = NestedKeyOf<TranslationKeys>;

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

export function useTranslation() {
  const { language, setLanguage } = useI18nStore();
  const t = translations[language];

  const translate = (key: TranslationKey, params?: Record<string, string | number>): string => {
    let text = getNestedValue(t, key);

    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(`{${paramKey}}`, String(value));
      });
    }

    return text;
  };

  return {
    t: translate,
    language,
    setLanguage,
    languages: ['fr', 'en', 'de'] as const,
  };
}

export const languageNames: Record<Language, string> = {
  fr: 'Francais',
  en: 'English',
  de: 'Deutsch',
};
