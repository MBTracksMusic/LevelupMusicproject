import type { Language } from './index';

interface LocalizedNameRecord {
  name?: string | null;
  name_en?: string | null;
  name_de?: string | null;
}

function getFirstNonEmptyValue(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

export function getLocalizedField(entity: LocalizedNameRecord | null | undefined, language: Language): string | null {
  if (!entity) return null;

  const candidatesByLanguage: Record<Language, string | null | undefined> = {
    fr: entity.name,
    en: entity.name_en,
    de: entity.name_de,
  };

  return getFirstNonEmptyValue([
    candidatesByLanguage[language],
    entity.name,
    entity.name_en,
    entity.name_de,
  ]);
}

export function getLocalizedName(record: LocalizedNameRecord | null | undefined, language: Language): string {
  return getLocalizedField(record, language) ?? '';
}
