import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Music2 } from 'lucide-react';
import { useAudioPlayer, type Track } from '../../context/AudioPlayerContext';
import { hasPlayableTrackSource, toTrack } from '../../lib/audio/track';
import { formatPrice } from '../../lib/utils/format';

export type PublishedBeatListItem = {
  id: string;
  title: string;
  slug: string;
  bpm: number | null;
  key_signature: string | null;
  price: number;
  cover_image_url: string | null;
  audio_url: string;
  preview_url?: string | null;
  watermarked_path?: string | null;
  exclusive_preview_url?: string | null;
  watermarked_bucket?: string | null;
};

export function PublishedBeatsList({ beats }: { beats: PublishedBeatListItem[] }) {
  const { playQueue, currentTrack, isPlaying } = useAudioPlayer();
  const queue = useMemo<Track[]>(
    () =>
      beats
        .filter((beat) =>
          hasPlayableTrackSource({
            audioUrl: beat.audio_url,
            preview_url: beat.preview_url,
            watermarked_path: beat.watermarked_path,
            exclusive_preview_url: beat.exclusive_preview_url,
            watermarked_bucket: beat.watermarked_bucket,
          }),
        )
        .map((beat) =>
          toTrack({
            id: beat.id,
            title: beat.title,
            audioUrl: beat.audio_url,
            cover_image_url: beat.cover_image_url,
            preview_url: beat.preview_url,
            watermarked_path: beat.watermarked_path,
            exclusive_preview_url: beat.exclusive_preview_url,
            watermarked_bucket: beat.watermarked_bucket,
          }),
        )
        .filter((track): track is Track => track !== null),
    [beats],
  );

  if (!beats || beats.length === 0) {
    return (
      <div className="py-6 text-center text-zinc-500">
        Aucun beat publie pour le moment
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-zinc-400">
          {beats.length} beats
        </span>

        <select className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
          <option>Recent</option>
          <option>Prix</option>
          <option>BPM</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {beats.map((beat) => (
          <Link
            key={beat.id}
            to={`/beats/${beat.slug}`}
            className="group rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 transition-all duration-150 hover:scale-[1.01] hover:border-zinc-500 hover:bg-zinc-900/80"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const startIndex = queue.findIndex((track) => track.id === beat.id);
                    if (startIndex === -1) return;
                    playQueue(queue, startIndex);
                  }}
                  disabled={!hasPlayableTrackSource({
                    audioUrl: beat.audio_url,
                    preview_url: beat.preview_url,
                    watermarked_path: beat.watermarked_path,
                    exclusive_preview_url: beat.exclusive_preview_url,
                    watermarked_bucket: beat.watermarked_bucket,
                  })}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {currentTrack?.id === beat.id && isPlaying ? '⏸' : '▶'}
                </button>

                {beat.cover_image_url ? (
                  <img
                    src={beat.cover_image_url}
                    alt={beat.title}
                    className="h-10 w-10 shrink-0 rounded-md border border-zinc-800 object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-500">
                    <Music2 className="h-4 w-4" />
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white transition-colors group-hover:text-rose-300">
                    {beat.title}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {beat.bpm ? `${beat.bpm} BPM` : '—'} · {beat.key_signature || '—'}
                  </p>
                </div>
              </div>

              <div className="shrink-0 text-sm font-semibold text-rose-400">
                {formatPrice(beat.price || 0)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
