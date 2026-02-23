import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { Button } from '../ui/Button';

interface HomeNewsVideoRow {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  created_at: string;
}

type VideoSource =
  | { kind: 'youtube'; embedUrl: string; youtubeId: string }
  | { kind: 'vimeo'; embedUrl: string }
  | { kind: 'mp4'; src: string }
  | { kind: 'unknown' };

function parseYouTubeId(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname.includes('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }

    if (hostname.includes('youtube.com')) {
      if (parsed.pathname === '/watch') {
        return parsed.searchParams.get('v');
      }

      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.split('/')[2] || null;
      }

      if (parsed.pathname.startsWith('/embed/')) {
        return parsed.pathname.split('/')[2] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function parseVimeoId(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes('vimeo.com')) return null;
    const candidate = parsed.pathname.split('/').filter(Boolean)[0];
    return candidate && /^\d+$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveVideoSource(rawUrl: string): VideoSource {
  const cleanUrl = rawUrl.trim();
  const youtubeId = parseYouTubeId(cleanUrl);
  if (youtubeId) {
    return {
      kind: 'youtube',
      youtubeId,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`,
    };
  }

  const vimeoId = parseVimeoId(cleanUrl);
  if (vimeoId) {
    return {
      kind: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoId}?autoplay=1`,
    };
  }

  if (/^https:\/\/.+\.mp4(\?.*)?$/i.test(cleanUrl)) {
    return { kind: 'mp4', src: cleanUrl };
  }

  return { kind: 'unknown' };
}

function computeFallbackThumbnail(source: VideoSource) {
  if (source.kind === 'youtube') {
    return `https://img.youtube.com/vi/${source.youtubeId}/hqdefault.jpg`;
  }
  return null;
}

export function HomeNewsVideos() {
  const [rows, setRows] = useState<HomeNewsVideoRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const loadRows = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('news_videos')
        .select('id, title, description, video_url, thumbnail_url, created_at')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(3);

      if (isCancelled) return;

      if (error) {
        console.error('Error loading homepage news videos:', error);
        setRows([]);
      } else {
        setRows((data as HomeNewsVideoRow[]) ?? []);
      }

      setIsLoading(false);
    };

    void loadRows();

    return () => {
      isCancelled = true;
    };
  }, []);

  const items = useMemo(
    () =>
      rows.map((row) => {
        const source = resolveVideoSource(row.video_url);
        const fallbackThumbnail = computeFallbackThumbnail(source);
        return {
          row,
          source,
          thumbnail: row.thumbnail_url || fallbackThumbnail,
        };
      }),
    [rows],
  );

  if (!isLoading && items.length === 0) {
    return null;
  }

  return (
    <section className="py-16 bg-zinc-950 border-t border-zinc-900">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white">News vidéos</h2>
          <p className="text-zinc-400 mt-2">Les dernières annonces publiées par l’équipe.</p>
        </div>

        {isLoading ? (
          <div className="text-zinc-500">Chargement des annonces...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {items.map(({ row, source, thumbnail }) => {
              const isActive = activeId === row.id;
              return (
                <article key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="aspect-video bg-zinc-950 relative">
                    {isActive ? (
                      source.kind === 'mp4' ? (
                        <video
                          className="w-full h-full"
                          controls
                          preload="none"
                          poster={thumbnail ?? undefined}
                          src={source.src}
                        />
                      ) : source.kind === 'youtube' || source.kind === 'vimeo' ? (
                        <iframe
                          title={row.title}
                          src={source.embedUrl}
                          className="w-full h-full"
                          loading="lazy"
                          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                          allowFullScreen
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">
                          URL vidéo non supportée.
                        </div>
                      )
                    ) : (
                      <>
                        {thumbnail ? (
                          <img
                            src={thumbnail}
                            alt={row.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">
                            Thumbnail indisponible
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                          <Button
                            variant="secondary"
                            leftIcon={<Play className="w-4 h-4" />}
                            onClick={() => setActiveId(row.id)}
                          >
                            Lire
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="p-4">
                    <h3 className="text-white font-semibold line-clamp-2">{row.title}</h3>
                    {row.description && (
                      <p className="text-zinc-400 text-sm mt-2 line-clamp-3">{row.description}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
