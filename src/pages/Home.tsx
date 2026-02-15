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
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { ProductWithRelations, UserProfile } from '../lib/supabase/types';

export function HomePage() {
  const { t } = useTranslation();
  const [featuredBeats, setFeaturedBeats] = useState<ProductWithRelations[]>([]);
  const [exclusives, setExclusives] = useState<ProductWithRelations[]>([]);
  const [topProducers, setTopProducers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [beatsRes, exclusivesRes, producersRes] = await Promise.all([
          supabase
            .from('products')
            .select(`
              *,
              producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
              genre:genres(*),
              mood:moods(*)
            `)
            .eq('is_published', true)
            .eq('product_type', 'beat')
            .order('play_count', { ascending: false })
            .limit(8),
          supabase
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
            .limit(4),
          supabase
            .from('user_profiles')
            .select('*')
            .eq('is_producer_active', true)
            .limit(6),
        ]);

        if (beatsRes.data) setFeaturedBeats(beatsRes.data as ProductWithRelations[]);
        if (exclusivesRes.data) setExclusives(exclusivesRes.data as ProductWithRelations[]);
        if (producersRes.data) setTopProducers(producersRes.data);
      } catch (error) {
        console.error('Error fetching home data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
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
              <span>10K+ Beats</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <span>500+ Producteurs</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              <span>Paiement securise</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2">
                {t('home.featuredBeats')}
              </h2>
              <p className="text-zinc-400">Les beats les plus ecoutes</p>
            </div>
            <Link to="/beats">
              <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
                {t('common.viewAll')}
              </Button>
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="bg-zinc-900 rounded-xl overflow-hidden animate-pulse"
                >
                  <div className="aspect-square bg-zinc-800" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-zinc-800 rounded w-3/4" />
                    <div className="h-3 bg-zinc-800 rounded w-1/2" />
                    <div className="h-6 bg-zinc-800 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {featuredBeats.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </section>

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
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-20 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                <h2 className="text-3xl font-bold text-white">
                  {t('home.topProducers')}
                </h2>
              </div>
              <p className="text-zinc-400">Les producteurs les plus actifs</p>
            </div>
            <Link to="/producers">
              <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
                {t('common.viewAll')}
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            {topProducers.map((producer) => (
              <Link
                key={producer.id}
                to={`/producers/${producer.username}`}
                className="group text-center"
              >
                <div className="mb-3">
                  {producer.avatar_url ? (
                    <img
                      src={producer.avatar_url}
                      alt={producer.username || ''}
                      className="w-24 h-24 mx-auto rounded-full object-cover border-2 border-zinc-800 group-hover:border-rose-500 transition-colors"
                    />
                  ) : (
                    <div className="w-24 h-24 mx-auto rounded-full bg-zinc-800 flex items-center justify-center border-2 border-zinc-700 group-hover:border-rose-500 transition-colors">
                      <Users className="w-10 h-10 text-zinc-600" />
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-white group-hover:text-rose-400 transition-colors">
                  {producer.username}
                </h3>
                <p className="text-sm text-zinc-500">Producteur</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

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
