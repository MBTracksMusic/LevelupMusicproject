import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const searchParamsString = searchParams.toString();
  const { isActive: hasPremiumAccess, subscription: userSubStatus } = useUserSubscriptionStatus(user?.id);
  const isUserPremium = hasPremiumAccess && userSubStatus?.plan_code === 'user_monthly';
  const { productIds: wishlistProductIds, fetchWishlist, toggleWishlist, clearWishlist } = useWishlistStore();
  const PAGE_SIZE = 20;
  const [beats, setBeats] = useState<ProductWithRelations[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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
    const searchFromUrl = new URLSearchParams(searchParamsString).get('search');

    setFilters((prev) => ({
      ...prev,
      search: searchFromUrl ?? '',
    }));
  }, [searchParamsString]);

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
        const { products, total } = await fetchCatalogProducts({
          mode,
          filters,
          limit: PAGE_SIZE,
          offset: (currentPage - 1) * PAGE_SIZE,
          restrictToActiveProducers: false,
          hasPremiumAccess,
        });
        setBeats(products);
        setTotalCount(total);
      } catch (error) {
        console.error('Error fetching beats:', error);
        setBeats([]);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    }

    const debounce = setTimeout(fetchBeats, 300);
    return () => clearTimeout(debounce);
  }, [filters, hasPremiumAccess, mode, user?.id, currentPage]);

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
    setCurrentPage(1);
  };

  const handleFilterChange = useCallback((key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  }, []);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getPageNumbers = (current: number, total: number): (number | '...')[] => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
    if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '...', current - 1, current, current + 1, '...', total];
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
              onChange={(e) => handleFilterChange('search', e.target.value)}
              leftIcon={<Search className="w-5 h-5" />}
            />
          </div>

          <div className="flex gap-3">
            <Select
              value={filters.sort}
              onChange={(e) => handleFilterChange('sort', e.target.value)}
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
                onChange={(e) => handleFilterChange('genre', e.target.value)}
                placeholder={t('common.all')}
                options={[
                  { value: '', label: t('common.all') },
                  ...genres.map((g) => ({ value: g.id, label: getLocalizedName(g, language) })),
                ]}
              />

              <Select
                label={t('products.filterByMood')}
                value={filters.mood}
                onChange={(e) => handleFilterChange('mood', e.target.value)}
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
                    onChange={(e) => handleFilterChange('bpmMin', e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder={t('common.max')}
                    value={filters.bpmMax}
                    onChange={(e) => handleFilterChange('bpmMax', e.target.value)}
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
                    onChange={(e) => handleFilterChange('priceMin', e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder={t('common.max')}
                    value={filters.priceMax}
                    onChange={(e) => handleFilterChange('priceMax', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-square bg-zinc-800" />
                <div className="p-3 space-y-3">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {beats.map((beat) => (
              <ProductCard
                key={beat.id}
                product={beat}
                playbackQueue={playbackQueue}
                hasPremiumAccess={hasPremiumAccess}
                isUserPremium={isUserPremium}
                isWishlisted={wishlistProductIds.includes(beat.id)}
                onWishlistToggle={handleWishlistToggle}
              />
            ))}
          </div>
        )}

        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Précédent
            </button>

            <div className="flex items-center gap-1">
              {getPageNumbers(currentPage, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-zinc-500">…</span>
                ) : (
                  <button
                    type="button"
                    key={p}
                    onClick={() => goToPage(p as number)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                      p === currentPage
                        ? 'bg-rose-500 text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Suivant
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
