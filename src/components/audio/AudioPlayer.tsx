import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward } from 'lucide-react';
import type { ProductWithRelations } from '../../lib/supabase/types';
import { supabase } from '../../lib/supabase/client';
import { usePlayerStore } from '../../lib/stores/player';

const WATERMARKED_BUCKET = import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET || 'beats-watermarked';
const LEGACY_AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';
const KNOWN_AUDIO_BUCKETS = [
  WATERMARKED_BUCKET,
  LEGACY_AUDIO_BUCKET,
  'beats-watermarked',
  'beats-audio',
].filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);

const describeMediaError = (error: MediaError | null) => {
  if (!error) return 'Playback error';
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback aborted';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Network error while fetching audio';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Format/codec not supported (decode error)';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Audio source not supported or unreachable';
    default:
      return 'Unknown media error';
  }
};

const extractBucketAndPathFromStorageUrl = (value: string) => {
  try {
    const parsedUrl = new URL(value);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);

    const objectIndex = segments.findIndex((segment) => segment === 'object');
    if (objectIndex >= 0 && objectIndex + 2 < segments.length) {
      const bucket = segments[objectIndex + 2];
      const path = decodeURIComponent(segments.slice(objectIndex + 3).join('/'));
      if (bucket && path) {
        return { bucket, path };
      }
    }

    const bucketIndex = segments.findIndex((segment) => KNOWN_AUDIO_BUCKETS.includes(segment));
    if (bucketIndex >= 0) {
      const bucket = segments[bucketIndex];
      const path = decodeURIComponent(segments.slice(bucketIndex + 1).join('/'));
      if (bucket && path) {
        return { bucket, path };
      }
    }
  } catch {
    return null;
  }

  return null;
};

const normalizeAudioPath = (value: string) => {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (!trimmed) return null;

  for (const bucket of KNOWN_AUDIO_BUCKETS) {
    if (trimmed === bucket) return null;
    if (trimmed.startsWith(`${bucket}/`)) {
      return trimmed.slice(bucket.length + 1);
    }
  }

  return trimmed;
};

const resolveWatermarkedUrls = async (candidate: string | null) => {
  if (!candidate) return [];

  const candidates: string[] = [];
  let normalizedPath: string | null = null;

  if (/^https?:\/\//i.test(candidate)) {
    candidates.push(candidate);
    const parsed = extractBucketAndPathFromStorageUrl(candidate);
    normalizedPath = parsed?.path ?? null;
  } else {
    normalizedPath = normalizeAudioPath(candidate);
  }

  if (!normalizedPath) {
    return [...new Set(candidates)];
  }

  for (const bucket of KNOWN_AUDIO_BUCKETS) {
    const publicUrl = supabase.storage.from(bucket).getPublicUrl(normalizedPath).data.publicUrl;
    if (publicUrl) {
      candidates.push(publicUrl);
    }
  }

  // Some deployments still keep preview files in private legacy bucket.
  for (const bucket of KNOWN_AUDIO_BUCKETS) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(normalizedPath, 120);
    if (data?.signedUrl) {
      candidates.push(data.signedUrl);
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

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

      const watermarkedCandidate =
        track?.watermarked_path ?? track?.preview_url ?? track?.exclusive_preview_url ?? null;
      const watermarkedUrls = await resolveWatermarkedUrls(watermarkedCandidate);
      if (watermarkedUrls.length === 0) {
        setLoadingUrl(false);
        setErrorMessage('Source audio indisponible');
        return;
      }

      let playbackUrls = [...watermarkedUrls];

      if (track?.id) {
        const { data: masterData, error: masterError } = await supabase.functions.invoke<{
          url: string;
          expires_in: number;
        }>('get-master-url', {
          body: { product_id: track.id, expires_in: 120 },
        });

        if (!isCancelled && !masterError && masterData?.url) {
          playbackUrls = [masterData.url, ...playbackUrls];
        }
      }

      if (!isCancelled) {
        const uniqueUrls = [...new Set(playbackUrls)];
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
  }, [track?.id, track?.watermarked_path, track?.preview_url, track?.exclusive_preview_url, setGlobalPlaying]);

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
            err instanceof Error ? err.message : 'Playback was blocked by the browser'
          );
          setGlobalPlaying(false);
        });
    } else {
      audio.pause();
    }
  }, [globalIsPlaying, resolvedSource, isReady, setGlobalPlaying]);

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
        err instanceof Error ? err.message : 'Playback was blocked by the browser'
      );
      setGlobalPlaying(false);
    }
  }, [resolvedSource, isReady, globalIsPlaying, setGlobalPlaying]);

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
    const message = describeMediaError(mediaError);
    setErrorMessage(message);
    setGlobalPlaying(false);
    setIsReady(false);
  }, [resolvedSourceCandidates, sourceCandidateIndex, setGlobalPlaying]);

  const handleEnded = useCallback(() => {
    setGlobalPlaying(false);
    setCurrentTime(0);
    onEnded?.();
  }, [onEnded, setGlobalPlaying]);

  const handlePlayEvent = useCallback(() => setGlobalPlaying(true), [setGlobalPlaying]);
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

  if (!track) {
    return (
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-zinc-950 border-t border-zinc-800">
        <div className="max-w-7xl mx-auto h-full flex items-center justify-center">
          <p className="text-zinc-500 text-sm">Aucun titre selectionne</p>
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
              {track.producer?.username || 'Unknown'}
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
            aria-label={globalIsPlaying ? 'Pause' : 'Play'}
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
        {loadingUrl && !errorMessage && (
          <p className="text-xs text-zinc-400 ml-4 truncate" aria-live="polite">
            Chargement du morceau...
          </p>
        )}
      </div>
    </div>
  );
}
