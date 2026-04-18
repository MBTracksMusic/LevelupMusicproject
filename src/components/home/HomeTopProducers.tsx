import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Flame, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';

interface RankedProducer {
  id: string;
  profile_path_username: string | null;
  username: string | null;
  avatar_url: string | null;
  wins: number;
}

interface TopProducersRpcRow {
  user_id: string;
  raw_username: string | null;
  username: string | null;
  avatar_url: string | null;
  wins: number | null;
}

interface LeaderboardProducerRow {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  battle_wins: number | null;
  rank_position: number | null;
}


export function HomeTopProducers() {
  const { t } = useTranslation();
  const [producers, setProducers] = useState<RankedProducer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' });
  };

  useEffect(() => {
    let isCancelled = false;

    async function fetchTopProducers() {
      setIsLoading(true);

      let ranking: RankedProducer[] = [];

      const rpcRes = await supabase.rpc('get_public_home_top_producers' as any, { p_limit: 10 });
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        ranking = (rpcRes.data as TopProducersRpcRow[]).map((row) => ({
          id: row.user_id,
          profile_path_username: row.raw_username ?? row.username,
          username: row.username ?? row.raw_username,
          avatar_url: row.avatar_url,
          wins: typeof row.wins === 'number' ? row.wins : 0,
        }));
      }

      // Fallback: leaderboard_producers view (active producers ranked by ELO,
      // even those with 0 wins — ensures the section is never empty).
      if (ranking.length === 0) {
        const { data, error } = await supabase
          .from('leaderboard_producers' as any)
          .select('user_id, username, avatar_url, battle_wins, rank_position')
          .order('rank_position', { ascending: true })
          .limit(10);

        if (!error) {
          ranking = ((data as unknown as LeaderboardProducerRow[] | null) ?? []).map((row) => ({
            id: row.user_id,
            profile_path_username: row.username,
            username: row.username,
            avatar_url: row.avatar_url,
            wins: typeof row.battle_wins === 'number' ? row.battle_wins : 0,
          }));
        } else {
          console.error('Error fetching top producers for home:', rpcRes.error, error);
        }
      }

      if (!isCancelled) {
        setProducers(ranking);
        setIsLoading(false);
      }
    }

    void fetchTopProducers();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <motion.section
      className="py-12 md:py-20 bg-zinc-900"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-5 h-5 text-orange-400" />
              <h2 className="text-3xl font-bold text-white">{t('home.topProducers')}</h2>
            </div>
            <p className="text-zinc-400 text-sm">{t('home.topProducersSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scroll('left')}
              className="w-11 h-11 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scroll('right')}
              className="w-11 h-11 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <Link to="/producers">
              <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
                {t('home.viewAllProducers')}
              </Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex gap-4 overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex-shrink-0 w-40 bg-zinc-950 border border-zinc-800 rounded-xl p-4 animate-pulse space-y-3">
                <div className="w-16 h-16 rounded-full bg-zinc-800 mx-auto" />
                <div className="h-4 bg-zinc-800 rounded w-2/3 mx-auto" />
                <div className="h-5 bg-zinc-800 rounded w-1/2 mx-auto" />
              </div>
            ))}
          </div>
        ) : producers.length === 0 ? (
          <Card className="text-zinc-400">{t('home.noTopProducers')}</Card>
        ) : (
          <div ref={scrollRef} className="flex gap-4 overflow-x-auto hide-scrollbar pb-2">
            {producers.map((producer, index) => {
              const content = (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.05 }}
                  whileHover={{ y: -4 }}
                  className="flex-shrink-0 w-40 bg-zinc-950/80 border border-zinc-800 hover:border-orange-500/40 rounded-xl p-4 text-center space-y-3 transition-colors duration-200 cursor-pointer"
                >
                  <div className="relative mx-auto w-fit">
                    {producer.avatar_url ? (
                      <img
                        src={producer.avatar_url}
                        alt={producer.username || t('home.unknownProducer')}
                        className="w-16 h-16 rounded-full object-cover border-2 border-zinc-700 group-hover:border-orange-500/60 transition-colors"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center border-2 border-zinc-700">
                        <Users className="w-7 h-7 text-zinc-500" />
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
                      <Flame className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <p className="font-semibold text-white text-sm truncate">
                    {producer.username || t('home.unknownProducer')}
                  </p>
                  <Badge variant="premium">
                    {producer.wins} {producer.wins > 1 ? t('home.winPlural') : t('home.winSingular')}
                  </Badge>
                </motion.div>
              );

              if (!producer.profile_path_username) {
                return <div key={producer.id}>{content}</div>;
              }

              return (
                <Link key={producer.id} to={`/producers/${producer.profile_path_username}`}>
                  {content}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </motion.section>
  );
}
