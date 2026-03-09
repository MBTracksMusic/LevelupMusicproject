import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Trophy } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import type { BattleStatus } from '../../lib/supabase/types';

interface BattleOfTheDayRow {
  battle_id: string;
  slug: string;
  title: string;
  status: BattleStatus;
  producer1_username: string | null;
  producer2_username: string | null;
  votes_today: number;
  votes_total: number;
}

function getStatusLabel(status: BattleStatus, t: ReturnType<typeof useTranslation>['t']) {
  if (status === 'active' || status === 'voting') return t('battleDetail.statusActive');
  if (status === 'completed') return t('battleDetail.statusCompleted');
  if (status === 'awaiting_admin') return t('battleDetail.statusAwaitingAdmin');
  if (status === 'pending_acceptance') return t('battleDetail.statusPendingAcceptance');
  if (status === 'rejected') return t('battleDetail.statusRejected');
  if (status === 'cancelled') return t('battleDetail.statusCancelled');
  return t('battleDetail.statusPending');
}

function getStatusVariant(status: BattleStatus): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'premium' {
  if (status === 'active' || status === 'voting') return 'success';
  if (status === 'completed' || status === 'awaiting_admin' || status === 'approved') return 'info';
  if (status === 'cancelled' || status === 'rejected') return 'danger';
  return 'warning';
}

export function HomeBattleOfTheDay() {
  const { t } = useTranslation();
  const [battle, setBattle] = useState<BattleOfTheDayRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function fetchBattleOfTheDay() {
      setIsLoading(true);

      let data: BattleOfTheDayRow | null = null;
      let error: unknown = null;

      const rpcRes = await supabase.rpc('get_public_battle_of_the_day' as any);
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        data = ((rpcRes.data[0] as BattleOfTheDayRow | undefined) ?? null);
      } else {
        const viewRes = await supabase
          .from('battle_of_the_day' as any)
          .select('battle_id, slug, title, status, producer1_username, producer2_username, votes_today, votes_total')
          .maybeSingle();
        data = (viewRes.data as BattleOfTheDayRow | null) ?? null;
        error = viewRes.error ?? rpcRes.error;
      }

      if (isCancelled) return;

      if (error) {
        console.error('Error loading battle of the day:', error);
        setBattle(null);
      } else {
        setBattle(data);
      }

      setIsLoading(false);
    }

    void fetchBattleOfTheDay();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <section className="py-20 bg-zinc-900/40 border-y border-zinc-900">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          <h2 className="text-3xl font-bold text-white">{t('home.battleOfTheDayTitle')}</h2>
        </div>
        <p className="text-zinc-400 mb-8">{t('home.battleOfTheDaySubtitle')}</p>

        {isLoading ? (
          <Card className="h-32 animate-pulse border-zinc-800 bg-zinc-900" />
        ) : !battle ? (
          <Card className="text-zinc-400">{t('home.noBattleOfTheDay')}</Card>
        ) : (
          <Link to={`/battles/${battle.slug}`}>
            <Card variant="interactive" className="border-zinc-800 hover:border-amber-500/50">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <p className="text-xl font-semibold text-white">{battle.title}</p>
                  <p className="text-sm text-zinc-400">
                    {battle.producer1_username || t('home.producerOne')} {t('battles.vs')} {battle.producer2_username || t('home.producerTwo')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1">
                      <CalendarDays className="w-3.5 h-3.5 text-amber-400" />
                      {t('home.votesToday', { count: battle.votes_today })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1">
                      {t('home.votesTotal', { count: battle.votes_total })}
                    </span>
                  </div>
                </div>
                <Badge variant={getStatusVariant(battle.status)}>{getStatusLabel(battle.status, t)}</Badge>
              </div>
            </Card>
          </Link>
        )}
      </div>
    </section>
  );
}
