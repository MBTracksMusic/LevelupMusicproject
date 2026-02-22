import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Swords } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { supabase } from '../../lib/supabase/client';
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

const visibleStatuses: BattleStatus[] = ['active', 'voting', 'completed'];

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
  if (status === 'active' || status === 'voting') return 'En cours';
  if (status === 'completed') return 'Terminee';
  return status;
}

export function HomeBattlesPreview() {
  const [battles, setBattles] = useState<HomeBattleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function fetchBattles() {
      setIsLoading(true);

      const { data, error } = await supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          status,
          producer1_id,
          producer2_id,
          producer1:user_profiles!battles_producer1_id_fkey(id, username),
          producer2:user_profiles!battles_producer2_id_fkey(id, username)
        `)
        .in('status', visibleStatuses)
        .order('created_at', { ascending: false })
        .limit(3);

      if (!isCancelled) {
        if (error) {
          console.error('Error fetching home battles preview:', error);
          setBattles([]);
        } else {
          setBattles((data as HomeBattleRow[] | null) ?? []);
        }
        setIsLoading(false);
      }
    }

    void fetchBattles();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <section className="py-20 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Swords className="w-5 h-5 text-rose-400" />
              <h2 className="text-3xl font-bold text-white">Battles</h2>
            </div>
            <p className="text-zinc-400">Les 3 dernieres battles publiees</p>
          </div>
          <Link to="/battles">
            <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Voir toutes les battles
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-pulse space-y-3">
                <div className="h-5 bg-zinc-800 rounded w-2/3" />
                <div className="h-4 bg-zinc-800 rounded w-1/2" />
                <div className="h-7 bg-zinc-800 rounded w-24" />
              </div>
            ))}
          </div>
        ) : battles.length === 0 ? (
          <Card className="text-zinc-400">Aucune battle publique pour le moment.</Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {battles.map((battle) => (
              <Link key={battle.id} to={`/battles/${battle.slug}`}>
                <Card variant="interactive" className="h-full space-y-3 hover:border-rose-500/50">
                  <p className="text-lg font-semibold text-white">{battle.title}</p>
                  <p className="text-sm text-zinc-400">
                    {battle.producer1?.username || 'Producteur 1'} vs {battle.producer2?.username || 'Producteur 2'}
                  </p>
                  <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status)}</Badge>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
