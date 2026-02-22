import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';

const WATERMARKED_BUCKET = import.meta.env.VITE_SUPABASE_WATERMARKED_BUCKET || 'beats-watermarked';
const AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || 'beats-audio';
const KNOWN_AUDIO_BUCKETS = [
  WATERMARKED_BUCKET,
  AUDIO_BUCKET,
  'beats-watermarked',
  'beats-audio',
].filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);

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

const extractPathFromStorageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);

    const objectIndex = segments.findIndex((segment) => segment === 'object');
    if (objectIndex >= 0 && objectIndex + 3 < segments.length) {
      return decodeURIComponent(segments.slice(objectIndex + 3).join('/'));
    }

    const bucketIndex = segments.findIndex((segment) => KNOWN_AUDIO_BUCKETS.includes(segment));
    if (bucketIndex >= 0) {
      return decodeURIComponent(segments.slice(bucketIndex + 1).join('/'));
    }
  } catch {
    return null;
  }

  return null;
};

const resolveSources = async (source: string) => {
  const candidates = new Set<string>();
  let normalizedPath: string | null = null;

  if (/^https?:\/\//i.test(source)) {
    candidates.add(source);
    normalizedPath = extractPathFromStorageUrl(source);
  } else {
    normalizedPath = normalizeAudioPath(source);
  }

  if (!normalizedPath) {
    return [...candidates];
  }

  for (const bucket of KNOWN_AUDIO_BUCKETS) {
    const publicUrl = supabase.storage.from(bucket).getPublicUrl(normalizedPath).data.publicUrl;
    if (publicUrl) {
      candidates.add(publicUrl);
    }
  }

  for (const bucket of KNOWN_AUDIO_BUCKETS) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(normalizedPath, 180);
    if (data?.signedUrl) {
      candidates.add(data.signedUrl);
    }
  }

  return [...candidates];
};

const formatTime = (value: number) => {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

interface BattleAudioPlayerProps {
  src: string | null | undefined;
  label?: string;
  playerId: string;
  activePlayerId: string | null;
  onActivePlayerChange: (playerId: string | null) => void;
}

export function BattleAudioPlayer({
  src,
  label,
  playerId,
  activePlayerId,
  onActivePlayerChange,
}: BattleAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sourceCandidates, setSourceCandidates] = useState<string[]>([]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isResolving, setIsResolving] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentSource = sourceCandidates[sourceIndex] ?? null;
  const isActive = activePlayerId === playerId;

  useEffect(() => {
    let isCancelled = false;

    const run = async () => {
      const trimmed = src?.trim() ?? '';
      setSourceCandidates([]);
      setSourceIndex(0);
      setCurrentTime(0);
      setDuration(0);
      setIsReady(false);
      setErrorMessage(null);

      if (!trimmed) {
        return;
      }

      setIsResolving(true);
      const resolved = await resolveSources(trimmed);
      if (isCancelled) return;

      setSourceCandidates(resolved);
      if (resolved.length === 0) {
        setErrorMessage('Extrait indisponible.');
      }
      setIsResolving(false);
    };

    void run();
    return () => {
      isCancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();

    if (currentSource) {
      audio.src = currentSource;
      audio.load();
    } else {
      audio.removeAttribute('src');
      audio.load();
    }

    setCurrentTime(0);
    setDuration(0);
    setIsReady(false);
  }, [currentSource]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!isActive) {
      audio.pause();
      return;
    }

    if (!isReady || !currentSource) return;

    audio.play().catch((error) => {
      console.error('Battle preview play failed', error);
      setErrorMessage('Lecture bloquee par le navigateur.');
      onActivePlayerChange(null);
    });
  }, [currentSource, isActive, isReady, onActivePlayerChange]);

  useEffect(() => {
    if (!isActive) return;
    if (currentSource) return;
    onActivePlayerChange(null);
  }, [currentSource, isActive, onActivePlayerChange]);

  const canPlay = useMemo(
    () => Boolean(currentSource) && !isResolving && !errorMessage,
    [currentSource, errorMessage, isResolving]
  );

  const togglePlay = useCallback(() => {
    if (!canPlay) return;
    if (isActive) {
      onActivePlayerChange(null);
    } else {
      setErrorMessage(null);
      onActivePlayerChange(playerId);
    }
  }, [canPlay, isActive, onActivePlayerChange, playerId]);

  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseFloat(event.target.value);
    if (!Number.isFinite(nextValue)) return;
    setCurrentTime(nextValue);
    if (audioRef.current) {
      audioRef.current.currentTime = nextValue;
    }
  }, []);

  const handleVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseFloat(event.target.value);
    if (!Number.isFinite(nextValue)) return;
    setVolume(Math.max(0, Math.min(nextValue, 1)));
  }, []);

  const handleCanPlay = useCallback(() => {
    setIsReady(true);
    setErrorMessage(null);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime || 0);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration || 0);
  }, []);

  const handleEnded = useCallback(() => {
    setCurrentTime(0);
    onActivePlayerChange(null);
  }, [onActivePlayerChange]);

  const handleError = useCallback(() => {
    const nextIndex = sourceIndex + 1;
    if (nextIndex < sourceCandidates.length) {
      setSourceIndex(nextIndex);
      setIsReady(false);
      setErrorMessage(null);
      return;
    }

    setErrorMessage('Impossible de lire cet extrait.');
    onActivePlayerChange(null);
  }, [onActivePlayerChange, sourceCandidates.length, sourceIndex]);

  return (
    <div className="space-y-2">
      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="anonymous"
        onCanPlay={handleCanPlay}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handleError}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!canPlay}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-900 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={isActive ? 'Pause preview' : 'Play preview'}
        >
          {isActive ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 ml-0.5" fill="currentColor" />}
        </button>

        <div className="flex-1">
          <p className="mb-1 text-xs text-zinc-500">{label || 'Extrait audio'}</p>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.1}
              value={duration > 0 ? Math.min(currentTime, duration) : 0}
              onChange={handleSeek}
              disabled={duration <= 0}
              className="h-1 w-full cursor-pointer accent-rose-500 disabled:cursor-not-allowed"
            />
            <span className="whitespace-nowrap text-[11px] text-zinc-500 tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <Volume2 className="h-4 w-4 text-zinc-500" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={handleVolumeChange}
            className="h-1 w-20 cursor-pointer accent-rose-500"
          />
        </div>
      </div>

      {isResolving && <p className="text-xs text-zinc-500">Chargement de l&apos;extrait...</p>}
      {!isResolving && !currentSource && !errorMessage && <p className="text-xs text-zinc-500">Extrait indisponible.</p>}
      {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
    </div>
  );
}
