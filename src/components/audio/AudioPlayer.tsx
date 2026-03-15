import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward } from 'lucide-react';
import type { ProductWithRelations } from '../../lib/supabase/types';
import { supabase } from '@/lib/supabase/client';
import { useTranslation } from '../../lib/i18n';
import { usePlayerStore } from '../../lib/stores/player';

const describeMediaError = (
  error: MediaError | null,
  translate: (
    key:
      | 'audio.playbackError'
      | 'audio.playbackAborted'
      | 'audio.playbackNetworkError'
      | 'audio.playbackDecodeError'
      | 'audio.playbackSourceNotSupported'
      | 'audio.playbackUnknownError'
  ) => string
) => {
  if (!error) return translate('audio.playbackError');
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return translate('audio.playbackAborted');
    case MediaError.MEDIA_ERR_NETWORK:
      return translate('audio.playbackNetworkError');
    case MediaError.MEDIA_ERR_DECODE:
      return translate('audio.playbackDecodeError');
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return translate('audio.playbackSourceNotSupported');
    default:
      return translate('audio.playbackUnknownError');
  }
};

const PREVIEW_PROXY_BASE = '/preview';
const WATERMARKED_BUCKET =
  import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET?.trim() || 'beats-watermarked';

const hasTrackPreviewAsset = (track: ProductWithRelations | null | undefined) => {
  if (!track) return false;
  return Boolean(
    track.preview_url?.trim() ||
      track.watermarked_path?.trim() ||
      track.exclusive_preview_url?.trim()
  );
};

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseStorageReference = (
  candidate: string,
  fallbackBucket: string
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
  } catch {
    return null;
  }

  return null;
};

const resolveDirectPreviewCandidate = (
  candidate: string,
  fallbackBucket: string
) => {
  if (/^https?:\/\//i.test(candidate)) return candidate;
  const parsed = parseStorageReference(candidate, fallbackBucket);
  if (!parsed) return null;
  return supabase.storage.from(parsed.bucket).getPublicUrl(parsed.path).data.publicUrl;
};

const resolvePreviewUrls = async (track: ProductWithRelations | null) => {
  const trackId = track?.id?.trim();
  if (!trackId || !hasTrackPreviewAsset(track)) return [];

  const encodedTrackId = encodeURIComponent(trackId);
  const proxyUrl = `${PREVIEW_PROXY_BASE}/${encodedTrackId}`;
  const candidates = [proxyUrl];

  const fallbackBucket = toNonEmptyString(track?.watermarked_bucket) || WATERMARKED_BUCKET;
  const directCandidates = [
    toNonEmptyString(track?.preview_url),
    toNonEmptyString(track?.exclusive_preview_url),
    toNonEmptyString(track?.watermarked_path),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of directCandidates) {
    const resolved = resolveDirectPreviewCandidate(candidate, fallbackBucket);
    if (resolved) {
      candidates.push(resolved);
    }
  }

  return [...new Set(candidates)];
};

interface AudioPlayerProps {
  track: ProductWithRelations | null;
  onNext?: () => void;
  onPrevious?: () => void;
  onEnded?: () => void;
}

export function AudioPlayer({ track, onNext, onPrevious, onEnded }: AudioPlayerProps) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hasCountedCurrentTrackRef = useRef(false);
  const lastCountedTrackIdRef = useRef<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const { isPlaying: globalIsPlaying, setIsPlaying: setGlobalPlaying } = usePlayerStore();

  const [resolvedSource, setResolvedSource] = useState<string | null>(null);
  const [resolvedSourceCandidates, setResolvedSourceCandidates] = useState<string[]>([]);
  const [sourceCandidateIndex, setSourceCandidateIndex] = useState(0);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const resolveSource = async () => {
      setResolvedSource(null);
      setLoadingUrl(true);
      setIsReady(false);
      setErrorMessage(null);
      setDuration(0);
      setCurrentTime(0);
      setResolvedSourceCandidates([]);
      setSourceCandidateIndex(0);
      setGlobalPlaying(false);

      const previewUrls = await resolvePreviewUrls(track);
      if (previewUrls.length === 0) {
        setLoadingUrl(false);
        setErrorMessage(t('audio.previewUnavailable'));
        return;
      }

      if (!isCancelled) {
        const uniqueUrls = [...new Set(previewUrls)];
        setResolvedSourceCandidates(uniqueUrls);
        setSourceCandidateIndex(0);
        setResolvedSource(uniqueUrls[0] ?? null);
      }

      setLoadingUrl(false);
    };

    void resolveSource();
    return () => {
      isCancelled = true;
    };
  }, [track, setGlobalPlaying, t]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();

    if (resolvedSource) {
      audio.src = resolvedSource;
      audio.load();
    } else {
      audio.removeAttribute('src');
      audio.load();
    }

    setGlobalPlaying(false);
    setIsReady(false);
    setCurrentTime(0);
    setDuration(0);
  }, [resolvedSource, setGlobalPlaying]);

  useEffect(() => {
    if (resolvedSource) {
      console.log('AUDIO SOURCE', resolvedSource);
    }
  }, [resolvedSource]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !resolvedSource || !isReady) return;

    if (globalIsPlaying) {
      audio
        .play()
        .catch((err) => {
          console.error('Audio play failed', err);
          setErrorMessage(
            err instanceof Error ? err.message : t('audio.playbackBlocked')
          );
          setGlobalPlaying(false);
        });
    } else {
      audio.pause();
    }
  }, [globalIsPlaying, resolvedSource, isReady, setGlobalPlaying, t]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !resolvedSource || !isReady) return;

    try {
      if (globalIsPlaying) {
        audio.pause();
        setGlobalPlaying(false);
      } else {
        await audio.play();
        setGlobalPlaying(true);
      }
    } catch (err) {
      console.error('Audio play failed', err);
      setErrorMessage(
        err instanceof Error ? err.message : t('audio.playbackBlocked')
      );
      setGlobalPlaying(false);
    }
  }, [resolvedSource, isReady, globalIsPlaying, setGlobalPlaying, t]);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime || 0);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
    }
  }, []);

  const handleCanPlay = useCallback(() => {
    setIsReady(true);
  }, []);

  const handleError = useCallback(() => {
    const nextIndex = sourceCandidateIndex + 1;
    if (nextIndex < resolvedSourceCandidates.length) {
      setSourceCandidateIndex(nextIndex);
      setResolvedSource(resolvedSourceCandidates[nextIndex]);
      setErrorMessage(null);
      setGlobalPlaying(false);
      setIsReady(false);
      return;
    }

    const mediaError = audioRef.current?.error ?? null;
    const message = describeMediaError(mediaError, (key) => t(key));
    setErrorMessage(message);
    setGlobalPlaying(false);
    setIsReady(false);
  }, [resolvedSourceCandidates, sourceCandidateIndex, setGlobalPlaying, t]);

  const handleEnded = useCallback(() => {
    setGlobalPlaying(false);
    setCurrentTime(0);
    onEnded?.();
  }, [onEnded, setGlobalPlaying]);

  const handlePlayEvent = useCallback(() => {
    setGlobalPlaying(true);

    const productId = track?.id;
    if (!productId) return;

    if (lastCountedTrackIdRef.current !== productId) {
      lastCountedTrackIdRef.current = productId;
      hasCountedCurrentTrackRef.current = false;
    }

    if (hasCountedCurrentTrackRef.current) return;
    hasCountedCurrentTrackRef.current = true;

    void (async () => {
      try {
        const { error } = await supabase.rpc('increment_play_count', { p_product_id: productId });
        if (error) {
          console.error('Play count increment error:', error);
        }
      } catch (err) {
        console.error('Play count increment error:', err);
      }
    })();
  }, [setGlobalPlaying, track?.id]);
  const handlePauseEvent = useCallback(() => setGlobalPlaying(false), [setGlobalPlaying]);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || !audioRef.current || duration <= 0) return;

      const rect = progressRef.current.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const newTime = percent * duration;

      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration]
  );

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const canPlay = !!resolvedSource && isReady && !loadingUrl && !errorMessage;
  const hasPreview = hasTrackPreviewAsset(track);

  if (!track) {
    return (
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-zinc-950 border-t border-zinc-800">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-center">
          <p className="text-zinc-500 text-sm">{t('audio.noTrackSelected')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800 z-50">
      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="anonymous"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onPlay={handlePlayEvent}
        onPause={handlePauseEvent}
        onEnded={handleEnded}
        onError={handleError}
      />

      <div
        ref={progressRef}
        className="absolute top-0 left-0 right-0 h-1 bg-zinc-800 cursor-pointer group"
        onClick={handleProgressClick}
      >
        <div
          className="h-full bg-gradient-to-r from-rose-500 to-orange-500 relative"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto h-full px-4 flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {track.cover_image_url ? (
            <img
              src={track.cover_image_url}
              alt={track.title}
              className="w-12 h-12 rounded-lg object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center">
              <Volume2 className="w-5 h-5 text-zinc-600" />
            </div>
          )}
          <div className="min-w-0">
            <h4 className="text-white font-medium truncate">{track.title}</h4>
            <p className="text-zinc-400 text-sm truncate">
              {track.producer?.username || t('audio.unknownProducer')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onPrevious}
            className="p-2 text-zinc-400 hover:text-white transition-colors"
            disabled={!onPrevious}
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canPlay}
            aria-label={globalIsPlaying ? t('common.pause') : t('common.play')}
          >
            {globalIsPlaying ? (
              <Pause className="w-5 h-5 text-zinc-900" fill="currentColor" />
            ) : (
              <Play className="w-5 h-5 text-zinc-900 ml-0.5" fill="currentColor" />
            )}
          </button>

          <button
            onClick={onNext}
            className="p-2 text-zinc-400 hover:text-white transition-colors"
            disabled={!onNext}
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3 flex-1 justify-end">
          <span className="text-xs text-zinc-500 tabular-nums">
            {formatTime(currentTime)}
          </span>
          <span className="text-xs text-zinc-600">/</span>
          <span className="text-xs text-zinc-500 tabular-nums">
            {formatTime(duration)}
          </span>

          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-1 text-zinc-400 hover:text-white transition-colors"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value));
                setIsMuted(false);
              }}
              className="w-20 accent-rose-500"
            />
          </div>
        </div>

        {errorMessage && (
          <p className="text-xs text-rose-400 ml-4 truncate" aria-live="polite">
            {errorMessage}
          </p>
        )}
        {!loadingUrl && !errorMessage && !hasPreview && (
          <p className="text-xs text-zinc-400 ml-4 truncate" aria-live="polite">
            {t('audio.previewUnavailable')}
          </p>
        )}
        {loadingUrl && !errorMessage && (
          <p className="text-xs text-zinc-400 ml-4 truncate" aria-live="polite">
            {t('audio.trackLoading')}
          </p>
        )}
      </div>
    </div>
  );
}
