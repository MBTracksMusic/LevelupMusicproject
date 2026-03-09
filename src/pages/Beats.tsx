import { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { ProductCard } from '../components/products/ProductCard';
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import { fetchPublicProducerProfilesMap } from '../lib/supabase/publicProfiles';
import { useAuth } from '../lib/auth/hooks';
import { useWishlistStore } from '../lib/stores/wishlist';
import { GENRE_SAFE_COLUMNS, MOOD_SAFE_COLUMNS, PRODUCT_SAFE_COLUMNS } from '../lib/supabase/selects';
import type { ProductWithRelations, Genre, Mood } from '../lib/supabase/types';
import { getLocalizedName } from '../lib/i18n/localized';

interface BeatsPageProps {
  mode?: 'beats' | 'exclusives' | 'kits';
}

export function BeatsPage({ mode = 'beats' }: BeatsPageProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
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
      const shouldRestrictToActiveProducers = !user;
      try {
        let query = supabase
          .from('products')
          .select(`
            ${PRODUCT_SAFE_COLUMNS},
            genre:genres(${GENRE_SAFE_COLUMNS}),
            mood:moods(${MOOD_SAFE_COLUMNS})
          ` as any)
          .eq('is_published', true);

        if (mode === 'exclusives') {
          query = query
            .eq('product_type', 'exclusive')
            .eq('is_sold', false);
        } else if (mode === 'kits') {
          query = query.eq('product_type', 'kit');
        } else {
          query = query.eq('product_type', 'beat');
        }

        if (filters.genre) {
          query = query.eq('genre_id', filters.genre);
        }
        if (filters.mood) {
          query = query.eq('mood_id', filters.mood);
        }
        if (filters.bpmMin) {
          query = query.gte('bpm', parseInt(filters.bpmMin));
        }
        if (filters.bpmMax) {
          query = query.lte('bpm', parseInt(filters.bpmMax));
        }
        if (filters.priceMin) {
          query = query.gte('price', parseInt(filters.priceMin) * 100);
        }
        if (filters.priceMax) {
          query = query.lte('price', parseInt(filters.priceMax) * 100);
        }
        if (filters.search) {
          query = query.or(`title.ilike.%${filters.search}%,tags.cs.{${filters.search}}`);
        }

        switch (filters.sort) {
          case 'popular':
            query = query.order('play_count', { ascending: false });
            break;
          case 'price_asc':
            query = query.order('price', { ascending: true });
            break;
          case 'price_desc':
            query = query.order('price', { ascending: false });
            break;
          default:
            query = query.order('created_at', { ascending: false });
        }

        let { data, error } = await query.limit(50);

        // Fallback for anon/public mode if relation selects are restricted.
        if (error) {
          let fallbackQuery = supabase
            .from('products')
            .select(`${PRODUCT_SAFE_COLUMNS}` as any)
            .eq('is_published', true);

          if (mode === 'exclusives') {
            fallbackQuery = fallbackQuery
              .eq('product_type', 'exclusive')
              .eq('is_sold', false);
          } else if (mode === 'kits') {
            fallbackQuery = fallbackQuery.eq('product_type', 'kit');
          } else {
            fallbackQuery = fallbackQuery.eq('product_type', 'beat');
          }

          if (filters.genre) {
            fallbackQuery = fallbackQuery.eq('genre_id', filters.genre);
          }
          if (filters.mood) {
            fallbackQuery = fallbackQuery.eq('mood_id', filters.mood);
          }
          if (filters.bpmMin) {
            fallbackQuery = fallbackQuery.gte('bpm', parseInt(filters.bpmMin));
          }
          if (filters.bpmMax) {
            fallbackQuery = fallbackQuery.lte('bpm', parseInt(filters.bpmMax));
          }
          if (filters.priceMin) {
            fallbackQuery = fallbackQuery.gte('price', parseInt(filters.priceMin) * 100);
          }
          if (filters.priceMax) {
            fallbackQuery = fallbackQuery.lte('price', parseInt(filters.priceMax) * 100);
          }
          if (filters.search) {
            fallbackQuery = fallbackQuery.or(`title.ilike.%${filters.search}%,tags.cs.{${filters.search}}`);
          }

          switch (filters.sort) {
            case 'popular':
              fallbackQuery = fallbackQuery.order('play_count', { ascending: false });
              break;
            case 'price_asc':
              fallbackQuery = fallbackQuery.order('price', { ascending: true });
              break;
            case 'price_desc':
              fallbackQuery = fallbackQuery.order('price', { ascending: false });
              break;
            default:
              fallbackQuery = fallbackQuery.order('created_at', { ascending: false });
          }

          const fallbackRes = await fallbackQuery.limit(50);
          data = fallbackRes.data as unknown as typeof data;
          error = fallbackRes.error;
        }

        if (error) throw error;

        const rows = ((data as unknown as ProductWithRelations[] | null) ?? []);
        let nextBeats: ProductWithRelations[] = rows;

        try {
          const producerProfilesMap = await fetchPublicProducerProfilesMap(
            rows.map((row) => row.producer_id)
          );

          const visibleRows = shouldRestrictToActiveProducers
            ? rows.filter((row) => {
                const producer = producerProfilesMap.get(row.producer_id);
                return producer?.is_producer_active === true;
              })
            : rows;

          nextBeats = visibleRows.map((row) => {
            const producer = producerProfilesMap.get(row.producer_id);
            return {
              ...row,
              producer: producer
                ? {
                    id: producer.user_id,
                    username: producer.username,
                    avatar_url: producer.avatar_url,
                  }
                : undefined,
            };
          }) as ProductWithRelations[];
        } catch (enrichError) {
          console.error('Error enriching beats with producer profiles:', enrichError);
          if (shouldRestrictToActiveProducers) {
            // Visitor fallback: keep only active producers using public RPC if available.
            const activeRpcRes = await supabase.rpc('get_public_producer_profiles_v2');
            if (!activeRpcRes.error && Array.isArray(activeRpcRes.data)) {
              const activeProducerIds = new Set(
                (activeRpcRes.data as Array<{ user_id: string }>).map((row) => row.user_id)
              );
              nextBeats = rows
                .filter((row) => activeProducerIds.has(row.producer_id))
                .map((row) => ({
                  ...row,
                  producer: undefined,
                })) as ProductWithRelations[];
            } else {
              // Do not block catalog rendering for visitors if every profile source fails.
              nextBeats = rows.map((row) => ({
                ...row,
                producer: undefined,
              })) as ProductWithRelations[];
            }
          } else {
            nextBeats = rows.map((row) => ({
              ...row,
              producer: undefined,
            })) as ProductWithRelations[];
          }
        }

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
  }, [filters, mode, user?.id]);

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
