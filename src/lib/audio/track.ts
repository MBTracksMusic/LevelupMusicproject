import type { Track } from '../../context/AudioPlayerContext';
import {
  getPrimaryAudioSource,
  hasPlayableAudioSource,
  type AudioSourceFields,
} from './sources';

type TrackSeed = AudioSourceFields & {
  id: string;
  title: string;
  cover_image_url?: string | null;
  producerId?: string;
};

export const hasPlayableTrackSource = (track: AudioSourceFields) =>
  hasPlayableAudioSource(track);

export const toTrack = (track: TrackSeed): Track | null => {
  const audioUrl = getPrimaryAudioSource(track);
  if (!audioUrl) {
    return null;
  }

  return {
    id: track.id,
    title: track.title,
    audioUrl,
    cover_image_url: track.cover_image_url,
    producerId: track.producerId,
    preview_url: track.preview_url ?? null,
    watermarked_path: track.watermarked_path ?? null,
    exclusive_preview_url: track.exclusive_preview_url ?? null,
    watermarked_bucket: track.watermarked_bucket ?? null,
  };
};
