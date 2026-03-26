import { supabase } from '../supabase/client';

const DEFAULT_WATERMARKED_BUCKET =
  import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET?.trim() || 'beats-watermarked';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AudioSourceFields = {
  id?: string | null;
  audioUrl?: string | null;
  preview_url?: string | null;
  watermarked_path?: string | null;
  exclusive_preview_url?: string | null;
  watermarked_bucket?: string | null;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const parseStorageReference = (
  candidate: string,
  fallbackBucket: string,
): { bucket: string; path: string } | null => {
  const raw = candidate.trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    const normalized = raw.replace(/^\/+/, '');
    if (!normalized) return null;

    if (normalized.startsWith('storage/v1/object/')) {
      const parts = normalized.split('/').filter(Boolean);
      const objectIndex = parts.findIndex((segment) => segment === 'object');
      if (objectIndex >= 0 && objectIndex + 3 < parts.length) {
        return {
          bucket: parts[objectIndex + 2]!,
          path: decodeURIComponent(parts.slice(objectIndex + 3).join('/')),
        };
      }
    }

    const slashIndex = normalized.indexOf('/');
    if (slashIndex > 0) {
      const maybeBucket = normalized.slice(0, slashIndex);
      const maybePath = normalized.slice(slashIndex + 1);
      if (
        maybeBucket.startsWith('beats-') ||
        maybeBucket === 'watermark-assets' ||
        maybeBucket === 'avatars'
      ) {
        return { bucket: maybeBucket, path: maybePath };
      }
    }

    return { bucket: fallbackBucket, path: normalized };
  }

  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const objectIndex = segments.findIndex((segment) => segment === 'object');
    if (objectIndex >= 0 && objectIndex + 3 < segments.length) {
      return {
        bucket: segments[objectIndex + 2]!,
        path: decodeURIComponent(segments.slice(objectIndex + 3).join('/')),
      };
    }

    const bucketIndex = segments.findIndex((segment) => segment.startsWith('beats-'));
    if (bucketIndex >= 0) {
      return {
        bucket: segments[bucketIndex]!,
        path: decodeURIComponent(segments.slice(bucketIndex + 1).join('/')),
      };
    }
  } catch {
    return null;
  }

  return null;
};

const resolveDirectAudioCandidate = (
  candidate: string,
  fallbackBucket: string,
) => {
  if (/^(https?:\/\/|blob:|data:)/i.test(candidate)) return candidate;
  const parsed = parseStorageReference(candidate, fallbackBucket);
  if (!parsed) return null;
  return supabase.storage.from(parsed.bucket).getPublicUrl(parsed.path).data.publicUrl;
};

export const getPrimaryAudioSource = (sources: AudioSourceFields) =>
  asNonEmptyString(sources.audioUrl) ||
  asNonEmptyString(sources.preview_url) ||
  asNonEmptyString(sources.watermarked_path) ||
  asNonEmptyString(sources.exclusive_preview_url);

export const hasPlayableAudioSource = (sources: AudioSourceFields) =>
  Boolean(getPrimaryAudioSource(sources));

export const buildResolvedAudioSourceCandidates = (
  sources: AudioSourceFields,
): string[] => {
  const fallbackBucket = asNonEmptyString(sources.watermarked_bucket) || DEFAULT_WATERMARKED_BUCKET;
  const directCandidates = [
    asNonEmptyString(sources.audioUrl),
    asNonEmptyString(sources.preview_url),
    asNonEmptyString(sources.watermarked_path),
    asNonEmptyString(sources.exclusive_preview_url),
  ].filter((value): value is string => Boolean(value));

  const resolvedCandidates = directCandidates
    .map((candidate) => resolveDirectAudioCandidate(candidate, fallbackBucket))
    .filter((value): value is string => Boolean(value));

  const productId = asNonEmptyString(sources.id);
  const supabaseUrl = asNonEmptyString(import.meta.env.VITE_SUPABASE_URL);

  if (productId && UUID_RE.test(productId) && supabaseUrl) {
    resolvedCandidates.push(
      `${trimTrailingSlash(supabaseUrl)}/functions/v1/preview-audio/${encodeURIComponent(productId)}`,
    );
  }

  return [...new Set(resolvedCandidates)];
};
