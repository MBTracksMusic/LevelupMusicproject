import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Swords } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { fetchPublicProducerProfilesMap } from '../../lib/supabase/publicProfiles';
import type { BattleStatus } from '../../lib/supabase/types';

interface HomeBattleRow {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  producer1_id: string;
  producer2_id: string | null;
  producer1?: { id: string; username: string | null };
  producer2?: { id: string; username: string | null };
}

interface HomeBattlesPreviewRpcRow {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  producer1_id: string;
  producer1_username: string | null;
  producer2_id: string | null;
  producer2_username: string | null;
}

const visibleStatuses: BattleStatus[] = ['active', 'voting', 'completed', 'awaiting_admin', 'approved'];

const badgeByStatus: Record<BattleStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'premium'> = {
  pending: 'warning',
  pending_acceptance: 'warning',
  awaiting_admin: 'info',
  approved: 'info',
  active: 'success',
  voting: 'success',
  completed: 'info',
  cancelled: 'danger',
  rejected: 'danger',
};

function toStatusLabel(status: BattleStatus) {
  if (status === 'active' || status === 'voting') return 'home.battleStatusActive';
  if (status === 'completed') return 'home.battleStatusCompleted';
  return status;
}

export function HomeBattlesPreview() {
  const { t } = useTranslation();
  const [battles, setBattles] = useState<HomeBattleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -340 : 340, behavior: 'smooth' });
  };

  useEffect(() => {
    let isCancelled = false;

    async function fetchBattles() {
      setIsLoading(true);

      let previewBattles: HomeBattleRow[] = [];
      const rpcRes = await supabase.rpc('get_public_home_battles_preview' as any, { p_limit: 3 });
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        previewBattles = (rpcRes.data as HomeBattlesPreviewRpcRow[]).map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
          status: row.status,
          producer1_id: row.producer1_id,
          producer2_id: row.producer2_id,
          producer1: {
            id: row.producer1_id,
            username: row.producer1_username,
          },
          producer2: row.producer2_id
            ? {
                id: row.producer2_id,
                username: row.producer2_username,
              }
            : undefined,
        }));
      }

      if (previewBattles.length === 0) {
        const { data, error } = await supabase
          .from('battles')
          .select(`
            id,
            title,
            slug,
            status,
            producer1_id,
            producer2_id
          `)
          .in('status', visibleStatuses)
          .order('created_at', { ascending: false })
          .limit(3);

        if (error) {
          console.error('Error fetching home battles preview:', error);
          if (rpcRes.error) {
            console.error('Error fetching home battles preview RPC:', rpcRes.error);
          }
          const { data: spotlightRows, error: spotlightError } = await supabase.rpc('get_public_battle_of_the_day' as any);
          if (!spotlightError && Array.isArray(spotlightRows) && spotlightRows.length > 0) {
            const spotlight = spotlightRows[0] as Record<string, unknown>;
            previewBattles = [
              {
                id: String(spotlight.battle_id),
                title: String(spotlight.title),
                slug: String(spotlight.slug),
                status: (spotlight.status as BattleStatus) ?? 'active',
                producer1_id: String(spotlight.producer1_id),
                producer2_id: (spotlight.producer2_id as string | null) ?? null,
                producer1: {
                  id: String(spotlight.producer1_id),
                  username: (spotlight.producer1_username as string | null) ?? null,
                },
                producer2: spotlight.producer2_id
                  ? {
                      id: String(spotlight.producer2_id),
                      username: (spotlight.producer2_username as string | null) ?? null,
                    }
                  : undefined,
              },
            ];
          }
        } else {
          const rows = ((data as HomeBattleRow[] | null) ?? []);
          const producerProfilesMap = await fetchPublicProducerProfilesMap(
            rows.flatMap((row) => [row.producer1_id, row.producer2_id])
          );
          previewBattles = rows.map((row) => {
            const producer1 = producerProfilesMap.get(row.producer1_id);
            const producer2 = row.producer2_id ? producerProfilesMap.get(row.producer2_id) : undefined;
            return {
              ...row,
              producer1: producer1
                ? {
                    id: producer1.user_id,
                    username: producer1.username,
                  }
                : undefined,
              producer2: producer2
                ? {
                    id: producer2.user_id,
                    username: producer2.username,
                  }
                : undefined,
            };
          });
        }
      }

      if (!isCancelled) {
        if (rpcRes.error && previewBattles.length > 0) {
          console.warn('Home battles preview RPC failed, fallback succeeded:', rpcRes.error);
        }
        setBattles(previewBattles);
        setIsLoading(false);
      }
    }

    void fetchBattles();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <motion.section
      className="py-12 md:py-20 bg-zinc-950"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Swords className="w-5 h-5 text-rose-400" />
              <h2 className="text-3xl font-bold text-white">{t('battles.title')}</h2>
            </div>
            <p className="text-zinc-400 text-sm">{t('home.latestBattlesSubtitle')}</p>
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
            <Link to="/battles">
              <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
                {t('home.viewAllBattles')}
              </Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex gap-4 overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex-shrink-0 w-72 bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-pulse space-y-3">
                <div className="h-5 bg-zinc-800 rounded w-2/3" />
                <div className="h-4 bg-zinc-800 rounded w-1/2" />
                <div className="h-7 bg-zinc-800 rounded w-24" />
              </div>
            ))}
          </div>
        ) : battles.length === 0 ? (
          <Card className="text-zinc-400">{t('home.noPublicBattles')}</Card>
        ) : (
          <div ref={scrollRef} className="flex gap-4 overflow-x-auto hide-scrollbar pb-2">
            {battles.map((battle, index) => (
              <Link key={battle.id} to={`/battles/${battle.slug}`} className="flex-shrink-0 w-72">
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="h-full bg-zinc-900/80 border border-zinc-800 hover:border-rose-500/40 rounded-xl p-5 space-y-3 transition-colors duration-200"
                >
                  <p className="text-lg font-semibold text-white truncate">{battle.title}</p>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="truncate max-w-[90px]">{battle.producer1?.username || t('home.producerOne')}</span>
                    <span className="text-rose-500 font-bold text-xs px-1.5 py-0.5 bg-rose-500/10 rounded">VS</span>
                    <span className="truncate max-w-[90px]">{battle.producer2?.username || t('home.producerTwo')}</span>
                  </div>
                  <Badge variant={badgeByStatus[battle.status]}>
                    {t(toStatusLabel(battle.status) as 'home.battleStatusActive' | 'home.battleStatusCompleted')}
                  </Badge>
                </motion.div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
