const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const normalizeStoragePath = (rawPath: string, bucket: string) => {
  const normalized = rawPath
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${escapeRegExp(bucket)}/`), '');

  return normalized || null;
};

export const extractStoragePathFromCandidate = (
  candidate: string | null | undefined,
  bucket: string
) => {
  if (!candidate) return null;

  if (!/^https?:\/\//i.test(candidate)) {
    return normalizeStoragePath(candidate, bucket);
  }

  try {
    const parsedUrl = new URL(candidate);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    const bucketIndex = segments.findIndex((segment) => segment === bucket);

    if (bucketIndex < 0) {
      return null;
    }

    const objectPath = decodeURIComponent(segments.slice(bucketIndex + 1).join('/'));
    return normalizeStoragePath(objectPath, bucket);
  } catch {
    return null;
  }
};

export const buildAudioStoragePathCandidates = (path: string) => {
  const normalizedPath = path.replace(/^\/+/, '');
  const candidates = normalizedPath.startsWith('audio/')
    ? [normalizedPath, normalizedPath.replace(/^audio\//, '')]
    : [normalizedPath, `audio/${normalizedPath}`];

  return [...new Set(candidates.filter(Boolean))];
};
