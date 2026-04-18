import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Headphones, ShoppingCart } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useAudioPlayer, type Track } from '../../context/AudioPlayerContext';
import { hasPlayableTrackSource, toTrack } from '../../lib/audio/track';
import { useAuth } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { isEarlyAccessActive, isEarlyAccessLocked } from '../../lib/products/earlyAccess';
import { useUserSubscriptionStatus } from '../../lib/subscriptions/useUserSubscriptionStatus';
import { supabase } from '@/lib/supabase/client';
import { trackAddToCart } from '../../lib/analytics';
import { useCartStore } from '../../lib/stores/cart';
import { trackInteraction } from '../../lib/tracking';
import { formatNumber, formatPrice } from '../../lib/utils/format';

interface HomeBeatRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  play_count: number;
  cover_image_url: string | null;
  preview_url: string | null;
  watermarked_path: string | null;
  exclusive_preview_url: string | null;
  watermarked_bucket: string | null;
  early_access_until: string | null;
  is_sold: boolean;
  producer_id: string;
  producer?: {
    id: string;
    username: string | null;
  };
}

interface HomeFeaturedBeatRpcRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  play_count: number | null;
  cover_image_url: string | null;
  preview_url: string | null;
  watermarked_path?: string | null;
  exclusive_preview_url?: string | null;
  watermarked_bucket?: string | null;
  early_access_until: string | null;
  is_sold: boolean | null;
  producer_id: string;
  producer_username: string | null;
}

function normalizePreviewUrl(previewUrl: string | null | undefined) {
  const trimmed = previewUrl?.trim();
  return trimmed ? trimmed : null;
}

export function HomeFeaturedBeats() {
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const { isActive: hasPremiumAccess } = useUserSubscriptionStatus(user?.id);
  const navigate = useNavigate();
  const location = useLocation();
  const { currentTrack, isPlaying, playQueue, playTrack } = useAudioPlayer();
  const { addToCart } = useCartStore();
  const [beats, setBeats] = useState<HomeBeatRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addingBeatId, setAddingBeatId] = useState<string | null>(null);
  useEffect(() => {
    let isCancelled = false;

    async function fetchFeaturedBeats() {
      setIsLoading(true);

      let featuredBeats: HomeBeatRow[] = [];
      const rpcRes = await supabase.rpc('get_public_home_featured_beats' as any, { p_limit: 10 });
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        featuredBeats = (rpcRes.data as HomeFeaturedBeatRpcRow[]).map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
          price: row.price,
          play_count: typeof row.play_count === 'number' ? row.play_count : 0,
          cover_image_url: row.cover_image_url,
          preview_url: row.preview_url,
          watermarked_path: row.watermarked_path ?? null,
          exclusive_preview_url: row.exclusive_preview_url ?? null,
          watermarked_bucket: row.watermarked_bucket ?? null,
          early_access_until: row.early_access_until,
          is_sold: row.is_sold === true,
          producer_id: row.producer_id,
          producer: {
            id: row.producer_id,
            username: row.producer_username,
          },
        }));

        const missingPreviewIds = featuredBeats
          .filter((beat) => !normalizePreviewUrl(beat.preview_url))
          .map((beat) => beat.id);

        if (missingPreviewIds.length > 0) {
          const { data: previewRows, error: previewError } = await supabase
            .from('public_catalog_products')
            .select('id, preview_url, watermarked_path, exclusive_preview_url, watermarked_bucket')
            .in('id', missingPreviewIds);

          if (previewError) {
            console.error('Error hydrating featured beat previews:', previewError);
          } else {
            const previewById = new Map(
              ((
                previewRows ?? []
              ) as Array<{
                id: string;
                preview_url: string | null;
                watermarked_path: string | null;
                exclusive_preview_url: string | null;
                watermarked_bucket: string | null;
              }>).map((row) => [
                row.id,
                row,
              ]),
            );

            featuredBeats = featuredBeats.map((beat) => ({
              ...beat,
              preview_url:
                normalizePreviewUrl(beat.preview_url) ?? normalizePreviewUrl(previewById.get(beat.id)?.preview_url) ?? null,
              watermarked_path: beat.watermarked_path ?? previewById.get(beat.id)?.watermarked_path ?? null,
              exclusive_preview_url:
                beat.exclusive_preview_url ?? previewById.get(beat.id)?.exclusive_preview_url ?? null,
              watermarked_bucket: beat.watermarked_bucket ?? previewById.get(beat.id)?.watermarked_bucket ?? null,
            }));
          }
        }
      }

      if (!isCancelled) {
        if (rpcRes.error) {
          console.error('Error fetching featured beats RPC for home:', rpcRes.error);
        }
        setBeats(featuredBeats);
        setIsLoading(false);
      }
    }

    void fetchFeaturedBeats();

    return () => {
      isCancelled = true;
    };
  }, []);

  const playbackQueue = useMemo<Track[]>(
    () =>
      beats
        .filter((beat) =>
          hasPlayableTrackSource({
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
            audioUrl: beat.preview_url,
            cover_image_url: beat.cover_image_url,
            producerId: beat.producer_id,
            preview_url: beat.preview_url,
            watermarked_path: beat.watermarked_path,
            exclusive_preview_url: beat.exclusive_preview_url,
            watermarked_bucket: beat.watermarked_bucket,
          }),
        )
        .filter((track): track is Track => track !== null),
    [beats],
  );

  const handlePlay = (beat: HomeBeatRow) => {
    const track = toTrack({
      id: beat.id,
      title: beat.title,
      audioUrl: beat.preview_url,
      cover_image_url: beat.cover_image_url,
      producerId: beat.producer_id,
      preview_url: beat.preview_url,
      watermarked_path: beat.watermarked_path,
      exclusive_preview_url: beat.exclusive_preview_url,
      watermarked_bucket: beat.watermarked_bucket,
    });
    if (!track) {
      return;
    }

    const index = playbackQueue.findIndex(
      (track) => String(track.id) === String(beat.id)
    );

    if (playbackQueue && index >= 0) {
      playQueue(playbackQueue, index);
      return;
    }

    playTrack(track);
  };

  const handleAddToCart = async (beat: HomeBeatRow) => {
    if (isEarlyAccessLocked(beat.early_access_until, hasPremiumAccess)) {
      return;
    }

    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: location.pathname } } });
      return;
    }

    setAddingBeatId(beat.id);
    try {
      await addToCart(beat.id);
      trackAddToCart({
        productId: beat.id,
        productName: beat.title,
        price: beat.price,
      });
      void trackInteraction({
        beatId: beat.id,
        action: 'add_to_cart',
      });
    } catch (error) {
      console.error('Error adding featured beat to cart:', error);
    } finally {
      setAddingBeatId(null);
    }
  };

  return (
    <section className="py-12 md:py-20 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Headphones className="w-5 h-5 text-emerald-400" />
              <h2 className="text-3xl font-bold text-white">{t('home.featuredBeats')}</h2>
            </div>
            <p className="text-zinc-400">{t('home.featuredBeatsSubtitle')}</p>
          </div>
          <Link to="/beats">
            <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
              {t('home.viewAllBeats')}
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 animate-pulse">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-zinc-800" />
                    <div className="h-12 w-12 rounded bg-zinc-800" />
                    <div className="min-w-0 space-y-2">
                      <div className="h-4 w-40 rounded bg-zinc-800" />
                      <div className="h-3 w-28 rounded bg-zinc-800" />
                    </div>
                  </div>
                  <div className="h-8 w-32 rounded bg-zinc-800" />
                </div>
              </div>
            ))}
          </div>
        ) : beats.length === 0 ? (
          <Card className="text-zinc-400">{t('home.noFeaturedBeats')}</Card>
        ) : (
          <div className="flex flex-col gap-2">
            {beats.map((beat) => {
              const hasPreview = hasPlayableTrackSource({
                preview_url: beat.preview_url,
                watermarked_path: beat.watermarked_path,
                exclusive_preview_url: beat.exclusive_preview_url,
                watermarked_bucket: beat.watermarked_bucket,
              });
              const isCurrentTrack = currentTrack?.id === beat.id;
              const isPlayingCurrent = hasPreview && isCurrentTrack && isPlaying;
              const isEarlyAccess = isEarlyAccessActive(beat.early_access_until);
              const isEarlyAccessPurchaseLocked = isEarlyAccessLocked(beat.early_access_until, hasPremiumAccess);

              return (
              <div
                key={beat.id}
                onClick={() => {
                  handlePlay(beat);
                }}
                className={`group rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-3 transition-all duration-150 ${
                  hasPreview ? 'cursor-pointer hover:bg-zinc-900 hover:border-zinc-500' : 'opacity-60'
                } ${
                  isCurrentTrack
                    ? 'border-rose-500 bg-zinc-900 shadow-lg shadow-rose-500/20'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePlay(beat);
                      }}
                      disabled={!hasPreview}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rose-500/40 text-rose-400 transition-all duration-150 hover:bg-rose-500 hover:text-black active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isPlayingCurrent ? '⏸' : '▶'}
                    </button>

                    {beat.cover_image_url ? (
                      <img
                        src={beat.cover_image_url}
                        alt={beat.title}
                        className="h-12 w-12 shrink-0 rounded object-cover border border-zinc-800"
                      />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded border border-zinc-800 bg-zinc-900" />
                    )}

                    <div className="min-w-0 transition-all duration-150 group-hover:translate-x-[2px]">
                      <p className="truncate text-sm font-semibold text-white transition-colors group-hover:text-rose-300">
                        {beat.title}
                      </p>
                      {isEarlyAccess && (
                        <p className="mt-0.5 text-xs text-amber-300">🔥 {t('products.earlyAccess')}</p>
                      )}
                      <p className="truncate text-sm text-zinc-400 transition-colors group-hover:text-zinc-300">
                        {beat.producer?.username || t('home.unknownProducer')}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500 transition-colors group-hover:text-zinc-400">
                        {formatNumber(beat.play_count)} {t('home.playsLabel')}
                      </p>
                      {!hasPreview && (
                        <p className="mt-1 text-xs text-zinc-500">
                          {t('products.previewUnavailable')}
                        </p>
                      )}
                      {isEarlyAccessPurchaseLocked && (
                        <p className="mt-1 text-xs text-amber-300">{t('products.availableSoon')}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <span className="text-sm font-semibold text-rose-400">
                        {formatPrice(beat.price)}
                      </span>
                    </div>
                    {!beat.is_sold && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleAddToCart(beat);
                        }}
                        disabled={isEarlyAccessPurchaseLocked}
                        isLoading={addingBeatId === beat.id}
                        leftIcon={<ShoppingCart className="w-4 h-4" />}
                        variant={isAuthenticated ? 'primary' : 'outline'}
                      >
                        {isEarlyAccessPurchaseLocked
                          ? t('products.availableSoon')
                          : isAuthenticated
                            ? t('products.addToCart')
                            : t('auth.loginButton')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
