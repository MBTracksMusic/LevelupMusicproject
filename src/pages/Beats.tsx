import { useState, useEffect, useMemo } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { ProductCard } from '../components/products/ProductCard';
import type { Track } from '../context/AudioPlayerContext';
import { hasPlayableTrackSource, toTrack } from '../lib/audio/track';
import { useTranslation } from '../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '../lib/auth/hooks';
import { useWishlistStore } from '../lib/stores/wishlist';
import { fetchCatalogProducts } from '../lib/supabase/catalog';
import { useUserSubscriptionStatus } from '../lib/subscriptions/useUserSubscriptionStatus';
import type { ProductWithRelations, Genre, Mood } from '../lib/supabase/types';
import { getLocalizedName } from '../lib/i18n/localized';

interface BeatsPageProps {
  mode?: 'beats' | 'exclusives' | 'kits';
}

export function BeatsPage({ mode = 'beats' }: BeatsPageProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { isActive: hasPremiumAccess } = useUserSubscriptionStatus(user?.id);
  const { productIds: wishlistProductIds, fetchWishlist, toggleWishlist, clearWishlist } = useWishlistStore();
  const [beats, setBeats] = useState<ProductWithRelations[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState({
    search: '',
    genre: '',
    mood: '',
    bpmMin: '',
    bpmMax: '',
    priceMin: '',
    priceMax: '',
    sort: 'newest',
  });

  useEffect(() => {
    async function fetchFilters() {
      const [genresRes, moodsRes] = await Promise.all([
        supabase.from('genres').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('moods').select('*').eq('is_active', true).order('sort_order'),
      ]);
      if (genresRes.data) {
        setGenres(genresRes.data.map((genre) => ({
          ...genre,
          sort_order: genre.sort_order ?? 0,
          is_active: genre.is_active ?? false,
        })));
      }
      if (moodsRes.data) {
        setMoods(moodsRes.data.map((mood) => ({
          ...mood,
          sort_order: mood.sort_order ?? 0,
          is_active: mood.is_active ?? false,
        })));
      }
    }
    fetchFilters();
  }, []);

  useEffect(() => {
    if (!user) {
      clearWishlist();
      return;
    }
    void fetchWishlist();
  }, [user?.id, fetchWishlist, clearWishlist]);

  useEffect(() => {
    async function fetchBeats() {
      setIsLoading(true);
      try {
        const nextBeats = await fetchCatalogProducts({
          mode,
          filters,
          limit: 50,
          restrictToActiveProducers: false,
          hasPremiumAccess,
        });
        setBeats(nextBeats);
      } catch (error) {
        console.error('Error fetching beats:', error);
        setBeats([]);
      } finally {
        setIsLoading(false);
      }
    }

    const debounce = setTimeout(fetchBeats, 300);
    return () => clearTimeout(debounce);
  }, [filters, hasPremiumAccess, mode, user?.id]);

  const clearFilters = () => {
    setFilters({
      search: '',
      genre: '',
      mood: '',
      bpmMin: '',
      bpmMax: '',
      priceMin: '',
      priceMax: '',
      sort: 'newest',
    });
  };

  const hasActiveFilters =
    filters.genre ||
    filters.mood ||
    filters.bpmMin ||
    filters.bpmMax ||
    filters.priceMin ||
    filters.priceMax;

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

  const handleWishlistToggle = async (productId: string) => {
    try {
      await toggleWishlist(productId);
    } catch (error) {
      console.error('Error toggling wishlist:', error);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('products.beats')}</h1>
          <p className="text-zinc-400">
            {t('products.catalogSubtitle')}
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 mb-8">
          <div className="flex-1">
            <Input
              type="text"
              placeholder={t('home.searchPlaceholder')}
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              leftIcon={<Search className="w-5 h-5" />}
            />
          </div>

          <div className="flex gap-3">
            <Select
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
              options={[
                { value: 'newest', label: t('products.sortByNewest') },
                { value: 'popular', label: t('products.sortByPopular') },
                { value: 'price_asc', label: `${t('products.sortByPrice')} (croissant)` },
                { value: 'price_desc', label: `${t('products.sortByPrice')} (decroissant)` },
              ]}
            />

            <Button
              variant={showFilters ? 'primary' : 'outline'}
              onClick={() => setShowFilters(!showFilters)}
              leftIcon={<SlidersHorizontal className="w-4 h-4" />}
            >
              {t('common.filter')}
            </Button>

            {hasActiveFilters && (
              <Button variant="ghost" onClick={clearFilters} leftIcon={<X className="w-4 h-4" />}>
                {t('products.clearFilters')}
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select
                label={t('products.filterByGenre')}
                value={filters.genre}
                onChange={(e) => setFilters({ ...filters, genre: e.target.value })}
                placeholder={t('common.all')}
                options={[
                  { value: '', label: t('common.all') },
                  ...genres.map((g) => ({ value: g.id, label: getLocalizedName(g, language) })),
                ]}
              />

              <Select
                label={t('products.filterByMood')}
                value={filters.mood}
                onChange={(e) => setFilters({ ...filters, mood: e.target.value })}
                placeholder={t('common.all')}
                options={[
                  { value: '', label: t('common.all') },
                  ...moods.map((m) => ({ value: m.id, label: getLocalizedName(m, language) })),
                ]}
              />

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  {t('products.bpm')}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={t('common.min')}
                    value={filters.bpmMin}
                    onChange={(e) => setFilters({ ...filters, bpmMin: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder={t('common.max')}
                    value={filters.bpmMax}
                    onChange={(e) => setFilters({ ...filters, bpmMax: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  {t('products.priceRange')} ({t('common.currencyEur')})
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={t('common.min')}
                    value={filters.priceMin}
                    onChange={(e) => setFilters({ ...filters, priceMin: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder={t('common.max')}
                    value={filters.priceMax}
                    onChange={(e) => setFilters({ ...filters, priceMax: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-square bg-zinc-800" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-zinc-800 rounded w-3/4" />
                  <div className="h-3 bg-zinc-800 rounded w-1/2" />
                  <div className="h-6 bg-zinc-800 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : beats.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-400 text-lg">{t('products.noProducts')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {beats.map((beat) => (
              <ProductCard
                key={beat.id}
                product={beat}
                playbackQueue={playbackQueue}
                hasPremiumAccess={hasPremiumAccess}
                isWishlisted={wishlistProductIds.includes(beat.id)}
                onWishlistToggle={handleWishlistToggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
