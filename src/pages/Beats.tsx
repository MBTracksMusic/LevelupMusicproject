import { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { ProductCard } from '../components/products/ProductCard';
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { ProductWithRelations, Genre, Mood } from '../lib/supabase/types';

export function BeatsPage() {
  const { t, language } = useTranslation();
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
      if (genresRes.data) setGenres(genresRes.data);
      if (moodsRes.data) setMoods(moodsRes.data);
    }
    fetchFilters();
  }, []);

  useEffect(() => {
    async function fetchBeats() {
      setIsLoading(true);
      try {
        let query = supabase
          .from('products')
          .select(`
            *,
            producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
            genre:genres(*),
            mood:moods(*)
          `)
          .eq('is_published', true)
          .eq('product_type', 'beat');

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

        const { data, error } = await query.limit(50);
        if (error) throw error;
        setBeats((data || []) as ProductWithRelations[]);
      } catch (error) {
        console.error('Error fetching beats:', error);
      } finally {
        setIsLoading(false);
      }
    }

    const debounce = setTimeout(fetchBeats, 300);
    return () => clearTimeout(debounce);
  }, [filters]);

  const getLocalizedName = (item: Genre | Mood) => {
    switch (language) {
      case 'en':
        return item.name_en;
      case 'de':
        return item.name_de;
      default:
        return item.name;
    }
  };

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

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('products.beats')}</h1>
          <p className="text-zinc-400">
            Explorez notre catalogue de beats de qualite studio
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
                Effacer
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
                  ...genres.map((g) => ({ value: g.id, label: getLocalizedName(g) })),
                ]}
              />

              <Select
                label={t('products.filterByMood')}
                value={filters.mood}
                onChange={(e) => setFilters({ ...filters, mood: e.target.value })}
                placeholder={t('common.all')}
                options={[
                  { value: '', label: t('common.all') },
                  ...moods.map((m) => ({ value: m.id, label: getLocalizedName(m) })),
                ]}
              />

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  BPM
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={filters.bpmMin}
                    onChange={(e) => setFilters({ ...filters, bpmMin: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Max"
                    value={filters.bpmMax}
                    onChange={(e) => setFilters({ ...filters, bpmMax: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  {t('products.priceRange')} (EUR)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={filters.priceMin}
                    onChange={(e) => setFilters({ ...filters, priceMin: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Max"
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
              <ProductCard key={beat.id} product={beat} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
