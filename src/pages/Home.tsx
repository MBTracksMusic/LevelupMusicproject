import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
import { HomeBattleOfTheDay } from '../components/home/HomeBattleOfTheDay';
import { HomeFeaturedBeats } from '../components/home/HomeFeaturedBeats';
import { HomeTopProducers } from '../components/home/HomeTopProducers';
import { HomeWeeklyTopProducers } from '../components/home/HomeWeeklyTopProducers';
import { HomeNewsVideos } from '../components/home/HomeNewsVideos';
import { useTranslation } from '../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '../lib/auth/hooks';
import { useUserSubscriptionStatus } from '../lib/subscriptions/useUserSubscriptionStatus';
import { useWishlistStore } from '../lib/stores/wishlist';
import { fetchCatalogProducts } from '../lib/supabase/catalog';
import { useMaintenanceModeContext } from '../lib/supabase/MaintenanceModeContext';
import type { ProductWithRelations } from '../lib/supabase/types';
import { formatNumber } from '../lib/utils/format';

interface HomeStatsPayload {
  beats_published?: number;
  active_producers?: number;
  show_homepage_stats?: boolean;
}

export function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isActive: hasPremiumAccess, subscription: userSubStatus } = useUserSubscriptionStatus(user?.id);
  const isUserPremium = hasPremiumAccess && userSubStatus?.plan_code === 'user_monthly';
  const { showHomepageStats, showHomepageBadge } = useMaintenanceModeContext();
  const { productIds: wishlistProductIds, fetchWishlist, toggleWishlist, clearWishlist } = useWishlistStore();
  // TODO(levelup): reactiver cette section quand les categories Exclusifs/Kits reviennent.
  const isExclusiveSectionEnabled = false;
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
  }, [user, fetchWishlist, clearWishlist]);

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
        const nextExclusives = await fetchCatalogProducts({
          mode: 'exclusives',
          filters: {
            search: '',
            genre: '',
            mood: '',
            bpmMin: '',
            bpmMax: '',
            priceMin: '',
            priceMax: '',
            sort: 'newest',
          },
          limit: 4,
          restrictToActiveProducers: false,
          hasPremiumAccess: false,
        });

        setExclusives(nextExclusives as ProductWithRelations[]);
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
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-[#0B0B0F]" />
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-transparent to-orange-950/40" />

        {/* Animated orbs */}
        <motion.div
          className="absolute top-1/4 left-[15%] w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[140px]"
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/3 right-[15%] w-[500px] h-[500px] rounded-full bg-rose-500/10 blur-[120px]"
          animate={{ scale: [1.1, 1, 1.1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 left-1/2 w-[350px] h-[350px] rounded-full bg-orange-500/8 blur-[100px]"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.03] hero-grid-overlay" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Badge */}
          {showHomepageBadge && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 mb-8 text-sm font-medium text-violet-300"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>La marketplace de beats #1 en France</span>
            </motion.div>
          )}

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="text-4xl sm:text-6xl md:text-8xl font-black leading-[0.92] tracking-tight text-white mb-6"
          >
            <span className="block">{t('home.heroTitle').split(' ').slice(0, Math.ceil(t('home.heroTitle').split(' ').length / 2)).join(' ')}</span>
            <span className="block bg-gradient-to-r from-violet-400 via-rose-400 to-orange-400 bg-clip-text text-transparent">
              {t('home.heroTitle').split(' ').slice(Math.ceil(t('home.heroTitle').split(' ').length / 2)).join(' ')}
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease: 'easeOut' }}
            className="text-xl md:text-2xl text-zinc-400 mb-10 max-w-3xl mx-auto leading-relaxed"
          >
            {t('home.heroSubtitle')}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12"
          >
            <Link to="/beats">
              <Button size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                {t('home.exploreBeats')}
              </Button>
            </Link>
            <Link to="/battles">
              <Button size="lg" variant="outline">
                {t('home.joinBattles')}
              </Button>
            </Link>
          </motion.div>

          {/* Stats */}
          {showHomepageStats && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.55 }}
              className="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-300"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/5 px-4 py-2">
                <Headphones className="w-4 h-4 text-violet-400" />
                <span>
                  {isHomeStatsLoading
                    ? `... ${t('home.statsBeatsLabel')}`
                    : homeStats.beatsPublished !== null
                      ? `${formatNumber(homeStats.beatsPublished)} ${t('home.statsBeatsLabel')}`
                      : t('home.statsBeatsUnavailable')}
                </span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/5 px-4 py-2">
                <Users className="w-4 h-4 text-rose-400" />
                <span>
                  {isHomeStatsLoading
                    ? `... ${t('nav.producers')}`
                    : homeStats.activeProducers !== null
                      ? `${formatNumber(homeStats.activeProducers)} ${t('nav.producers')}`
                      : t('home.statsProducersUnavailable')}
                </span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/5 px-4 py-2">
                <Shield className="w-4 h-4 text-orange-400" />
                <span>{t('home.securePayment')}</span>
              </div>
            </motion.div>
          )}
        </div>
      </section>

      <HomeNewsVideos />
      <HomeBattleOfTheDay />
      <HomeTopProducers />
      <HomeWeeklyTopProducers />
      <HomeBattlesPreview />
      <HomeFeaturedBeats />

      {isExclusiveSectionEnabled && exclusives.length > 0 && (
        <section className="py-20 bg-gradient-to-b from-zinc-950 to-zinc-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-10">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Star className="w-5 h-5 text-rose-400" />
                  <h2 className="text-3xl font-bold text-white">
                    {t('home.exclusiveDrops')}
                  </h2>
                </div>
                <p className="text-zinc-400">
                  {t('home.exclusiveDropsDesc')}
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
                  isUserPremium={isUserPremium}
                  isWishlisted={wishlistProductIds.includes(product.id)}
                  onWishlistToggle={handleWishlistToggle}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-12 md:py-20 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              {t('home.startSelling')}
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              {t('home.startSellingDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="bg-zinc-900/70 rounded-2xl p-8 border border-zinc-800 hover:border-violet-500/30 transition-colors duration-300">
              <div className="w-14 h-14 rounded-xl bg-violet-500/10 flex items-center justify-center mb-6">
                <Zap className="w-7 h-7 text-violet-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {t('home.fastPublishingTitle')}
              </h3>
              <p className="text-zinc-400">
                {t('home.fastPublishingDesc')}
              </p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-6">
                <Shield className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {t('home.fileProtectionTitle')}
              </h3>
              <p className="text-zinc-400">
                {t('home.fileProtectionDesc')}
              </p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
              <div className="w-14 h-14 rounded-xl bg-sky-500/10 flex items-center justify-center mb-6">
                <TrendingUp className="w-7 h-7 text-sky-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {t('home.detailedAnalyticsTitle')}
              </h3>
              <p className="text-zinc-400">
                {t('home.detailedAnalyticsDesc')}
              </p>
            </div>
          </div>

          <div className="text-center">
            <Link to="/pricing">
              <Button size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                {t('home.viewProducerPlans')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-20 bg-gradient-to-br from-violet-950/40 via-zinc-950 to-orange-950/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-violet-300 via-rose-300 to-orange-300 bg-clip-text text-transparent mb-6">
            {t('home.finalCtaTitle')}
          </h2>
          <p className="text-xl text-zinc-400 mb-10">
            {t('home.finalCtaSubtitle')}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register">
              <Button size="lg">
                {t('home.createFreeAccount')}
              </Button>
            </Link>
            <Link to="/beats">
              <Button size="lg" variant="outline" leftIcon={<Play className="w-5 h-5" />}>
                {t('home.listenToBeats')}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
