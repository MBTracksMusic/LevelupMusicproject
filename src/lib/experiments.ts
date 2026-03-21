const EXPERIMENT_STORAGE_PREFIX = 'beatelion_experiment_variant:';

export type ExperimentVariant = 'A' | 'B';

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function getExperimentVariant(userId: string, experimentKey = 'default'): ExperimentVariant {
  if (typeof window === 'undefined') {
    return hashString(`${experimentKey}:${userId}`) % 2 === 0 ? 'A' : 'B';
  }

  const storageKey = `${EXPERIMENT_STORAGE_PREFIX}${experimentKey}:${userId}`;

  try {
    const storedVariant = window.localStorage.getItem(storageKey);
    if (storedVariant === 'A' || storedVariant === 'B') {
      return storedVariant;
    }

    const variant = hashString(`${experimentKey}:${userId}`) % 2 === 0 ? 'A' : 'B';
    window.localStorage.setItem(storageKey, variant);
    return variant;
  } catch {
    return hashString(`${experimentKey}:${userId}`) % 2 === 0 ? 'A' : 'B';
  }
}
