import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Play,
  ArrowRight,
  TrendingUp,
  Star,
  Users,
  Zap,
  Shield,
  Headphones,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ProductCard } from '../components/products/ProductCard';
import { HomeBattlesPreview } from '../components/home/HomeBattlesPreview';
import { HomeFeaturedBeats } from '../components/home/HomeFeaturedBeats';
import { HomeTopProducers } from '../components/home/HomeTopProducers';
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../lib/auth/hooks';
import { useWishlistStore } from '../lib/stores/wishlist';
import type { ProductWithRelations } from '../lib/supabase/types';

interface HomeStatsPayload {
  beats_published?: number;
  active_producers?: number;
}

const statsNumberFormatter = new Intl.NumberFormat('fr-FR');

export function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { productIds: wishlistProductIds, fetchWishlist, toggleWishlist, clearWishlist } = useWishlistStore();
  const [exclusives, setExclusives] = useState<ProductWithRelations[]>([]);
  const [homeStats, setHomeStats] = useState<{
    beatsPublished: number | null;
    activeProducers: number | null;
  }>({
    beatsPublished: null,
    activeProducers: null,
  });
  const [isHomeStatsLoading, setIsHomeStatsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      clearWishlist();
      return;
    }
    void fetchWishlist();
  }, [user?.id, fetchWishlist, clearWishlist]);

  const handleWishlistToggle = async (productId: string) => {
    try {
      await toggleWishlist(productId);
    } catch (error) {
      console.error('Error toggling wishlist:', error);
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const { data } = await supabase
          .from('products')
          .select(`
            *,
            producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
            genre:genres(*),
            mood:moods(*)
          `)
          .eq('is_published', true)
          .eq('is_exclusive', true)
          .eq('is_sold', false)
          .order('created_at', { ascending: false })
          .limit(4);

        if (data) {
          setExclusives(data as ProductWithRelations[]);
        }
      } catch (error) {
        console.error('Error fetching home data:', error);
      }
    }

    fetchData();
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function fetchHomeStats() {
      setIsHomeStatsLoading(true);

      const { data, error } = await supabase.rpc('get_home_stats');
      if (!isCancelled) {
        if (error) {
          console.error('Error fetching home stats:', error);
          setHomeStats({
            beatsPublished: null,
            activeProducers: null,
          });
        } else {
          const stats = (data as HomeStatsPayload | null) ?? null;
          setHomeStats({
            beatsPublished: typeof stats?.beats_published === 'number' ? stats.beats_published : null,
            activeProducers: typeof stats?.active_producers === 'number' ? stats.active_producers : null,
          });
        }
        setIsHomeStatsLoading(false);
      }
    }

    void fetchHomeStats();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-950/30 via-zinc-950 to-orange-950/20" />
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center">
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            {t('home.heroTitle')}
          </h1>
          <p className="text-xl md:text-2xl text-zinc-400 mb-10 max-w-3xl mx-auto">
            {t('home.heroSubtitle')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link to="/beats">
              <Button size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                Explorer les beats
              </Button>
            </Link>
            <Link to="/pricing">
              <Button size="lg" variant="outline">
                {t('home.becomeProducer')}
              </Button>
            </Link>
          </div>

          <div className="flex items-center justify-center gap-8 text-zinc-400">
            <div className="flex items-center gap-2">
              <Headphones className="w-5 h-5" />
              <span>
                {isHomeStatsLoading
                  ? '... Beats'
                  : homeStats.beatsPublished !== null
                    ? `${statsNumberFormatter.format(homeStats.beatsPublished)} Beats`
                    : 'Beats indisponibles'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <span>
                {isHomeStatsLoading
                  ? '... Producteurs'
                  : homeStats.activeProducers !== null
                    ? `${statsNumberFormatter.format(homeStats.activeProducers)} Producteurs`
                    : 'Producteurs indisponibles'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              <span>Paiement securise</span>
            </div>
          </div>
        </div>
      </section>

      <HomeTopProducers />
      <HomeBattlesPreview />
      <HomeFeaturedBeats />

      {exclusives.length > 0 && (
        <section className="py-20 bg-gradient-to-b from-zinc-950 to-zinc-900">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between mb-10">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Star className="w-5 h-5 text-rose-400" />
                  <h2 className="text-3xl font-bold text-white">
                    {t('home.exclusiveDrops')}
                  </h2>
                </div>
                <p className="text-zinc-400">
                  Des beats uniques, disponibles une seule fois
                </p>
              </div>
              <Link to="/exclusives">
                <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
                  {t('common.viewAll')}
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {exclusives.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  isWishlisted={wishlistProductIds.includes(product.id)}
                  onWishlistToggle={handleWishlistToggle}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-20 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              {t('home.startSelling')}
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              {t('home.startSellingDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
              <div className="w-14 h-14 rounded-xl bg-rose-500/10 flex items-center justify-center mb-6">
                <Zap className="w-7 h-7 text-rose-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                Publication rapide
              </h3>
              <p className="text-zinc-400">
                Uploadez vos beats en quelques clics et commencez a vendre immediatement.
              </p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-6">
                <Shield className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                Protection des fichiers
              </h3>
              <p className="text-zinc-400">
                Vos masters sont proteges. Seuls les acheteurs ont acces aux fichiers originaux.
              </p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
              <div className="w-14 h-14 rounded-xl bg-sky-500/10 flex items-center justify-center mb-6">
                <TrendingUp className="w-7 h-7 text-sky-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                Analytics detailees
              </h3>
              <p className="text-zinc-400">
                Suivez vos ventes, ecoutes et revenus en temps reel depuis votre dashboard.
              </p>
            </div>
          </div>

          <div className="text-center">
            <Link to="/pricing">
              <Button size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                Voir les offres producteur
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-br from-rose-950/30 via-zinc-950 to-orange-950/20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            Pret a creer votre prochain hit ?
          </h2>
          <p className="text-xl text-zinc-400 mb-10">
            Rejoignez des milliers d'artistes qui font confiance a LevelupMusic
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register">
              <Button size="lg">
                Creer un compte gratuit
              </Button>
            </Link>
            <Link to="/beats">
              <Button size="lg" variant="outline" leftIcon={<Play className="w-5 h-5" />}>
                Ecouter des beats
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
