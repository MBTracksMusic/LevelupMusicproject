import { create } from 'zustand';
import type { ProductWithRelations } from '../supabase/types';

interface PlayerState {
  currentTrack: ProductWithRelations | null;
  queue: ProductWithRelations[];
  isPlaying: boolean;
  setCurrentTrack: (track: ProductWithRelations | null) => void;
  setQueue: (tracks: ProductWithRelations[]) => void;
  addToQueue: (track: ProductWithRelations) => void;
  playNext: () => void;
  playPrevious: () => void;
  setIsPlaying: (playing: boolean) => void;
  clearQueue: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  isPlaying: false,

  setCurrentTrack: (track) => set({ currentTrack: track }),

  setQueue: (tracks) => set({ queue: tracks }),

  addToQueue: (track) => {
    const { queue } = get();
    if (!queue.find((t) => t.id === track.id)) {
      set({ queue: [...queue, track] });
    }
  },

  playNext: () => {
    const { currentTrack, queue } = get();
    if (!currentTrack || queue.length === 0) return;

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    const nextIndex = currentIndex + 1;

    if (nextIndex < queue.length) {
      set({ currentTrack: queue[nextIndex] });
    }
  },

  playPrevious: () => {
    const { currentTrack, queue } = get();
    if (!currentTrack || queue.length === 0) return;

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    const prevIndex = currentIndex - 1;

    if (prevIndex >= 0) {
      set({ currentTrack: queue[prevIndex] });
    }
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  clearQueue: () => set({ queue: [], currentTrack: null }),
}));
