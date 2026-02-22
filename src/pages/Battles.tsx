import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Clock, Users } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import { useAuth, useIsEmailVerified } from '../lib/auth/hooks';
import type { BattleWithRelations } from '../lib/supabase/types';

export function BattlesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isEmailVerified = useIsEmailVerified();
  const [battles, setBattles] = useState<BattleWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'voting' | 'completed'>('active');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBattles() {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('battles')
          .select(`
            id,
            title,
            slug,
            description,
            producer1_id,
            producer2_id,
            product1_id,
            product2_id,
            status,
            starts_at,
            voting_ends_at,
            winner_id,
            votes_producer1,
            votes_producer2,
            featured,
            prize_description,
            created_at,
            updated_at,
            producer1:user_profiles!battles_producer1_id_fkey(id, username, avatar_url),
            producer2:user_profiles!battles_producer2_id_fkey(id, username, avatar_url),
            product1:products!battles_product1_id_fkey(id, title, slug, product_type, cover_image_url, price),
            product2:products!battles_product2_id_fkey(id, title, slug, product_type, cover_image_url, price),
            winner:user_profiles!battles_winner_id_fkey(id, username, avatar_url)
          `)
          .eq('status', filter)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setBattles((data || []) as BattleWithRelations[]);
      } catch (error) {
        console.error('Error fetching battles:', error);
        setError('Impossible de charger les battles pour le moment.');
        setBattles([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBattles();
  }, [filter]);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('battles.title')}</h1>
          <p className="text-zinc-400">{t('battles.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          <Button
            variant={filter === 'active' ? 'primary' : 'outline'}
            onClick={() => setFilter('active')}
          >
            {t('battles.activeBattles')}
          </Button>
          <Button
            variant={filter === 'completed' ? 'primary' : 'outline'}
            onClick={() => setFilter('completed')}
          >
            {t('battles.completedBattles')}
          </Button>
          <Button
            variant={filter === 'voting' ? 'primary' : 'outline'}
            onClick={() => setFilter('voting')}
          >
            Voting legacy
          </Button>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-8">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {!isEmailVerified && user && (
          <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-4 mb-8">
            <p className="text-amber-400 text-sm">Confirmez votre email pour voter et commenter.</p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-zinc-900 rounded-xl p-6 animate-pulse">
                <div className="h-6 bg-zinc-800 rounded w-1/3 mb-4" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 bg-zinc-800 rounded-full" />
                    <div className="space-y-2">
                      <div className="h-4 bg-zinc-800 rounded w-24" />
                      <div className="h-3 bg-zinc-800 rounded w-16" />
                    </div>
                  </div>
                  <div className="h-8 bg-zinc-800 rounded w-12" />
                  <div className="flex items-center gap-4">
                    <div className="space-y-2">
                      <div className="h-4 bg-zinc-800 rounded w-24" />
                      <div className="h-3 bg-zinc-800 rounded w-16" />
                    </div>
                    <div className="w-20 h-20 bg-zinc-800 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : battles.length === 0 ? (
          <div className="text-center py-20">
            <Trophy className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
            <p className="text-zinc-400 text-lg">Aucune battle pour le moment</p>
          </div>
        ) : (
          <div className="space-y-6">
            {battles.map((battle) => (
              <BattleCard key={battle.id} battle={battle} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface BattleCardProps {
  battle: BattleWithRelations;
}

function BattleCard({ battle }: BattleCardProps) {
  const { t } = useTranslation();
  const totalVotes = battle.votes_producer1 + battle.votes_producer2;
  const percent1 = totalVotes > 0 ? (battle.votes_producer1 / totalVotes) * 100 : 50;
  const percent2 = totalVotes > 0 ? (battle.votes_producer2 / totalVotes) * 100 : 50;
  const getTimeRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return t('battles.ended');

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}j ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  return (
    <Link to={`/battles/${battle.slug}`}>
      <Card variant="interactive" padding="lg" className="hover:border-rose-500/50">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">{battle.title}</h3>
          <div className="flex items-center gap-3">
            {(battle.status === 'active' || battle.status === 'voting') && battle.voting_ends_at && (
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <Clock className="w-4 h-4" />
                {t('battles.endsIn')}: {getTimeRemaining(battle.voting_ends_at)}
              </div>
            )}
            <Badge
              variant={
                battle.status === 'active' || battle.status === 'voting'
                  ? 'success'
                  : battle.status === 'completed'
                  ? 'info'
                  : 'warning'
              }
            >
              {battle.status === 'active' || battle.status === 'voting'
                ? 'En cours'
                : battle.status === 'completed'
                ? t('battles.ended')
                : 'A venir'}
            </Badge>
          </div>
        </div>

        <div className="flex items-center justify-between gap-8">
          <div className="flex-1 flex items-center gap-4">
            {battle.producer1?.avatar_url ? (
              <img
                src={battle.producer1.avatar_url}
                alt={battle.producer1.username || ''}
                className="w-20 h-20 rounded-full object-cover border-2 border-zinc-700"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center border-2 border-zinc-700">
                <Users className="w-8 h-8 text-zinc-600" />
              </div>
            )}
            <div>
              <p className="font-semibold text-white text-lg">
                {battle.producer1?.username}
              </p>
              {battle.product1 && (
                <p className="text-zinc-400 text-sm">{battle.product1.title}</p>
              )}
              <p className="text-rose-400 font-bold mt-1">
                {battle.votes_producer1} {t('battles.votes')}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="text-2xl font-bold text-zinc-500">{t('battles.vs')}</div>
            {battle.status === 'completed' && battle.winner && (
              <div className="flex items-center gap-1 text-amber-400">
                <Trophy className="w-4 h-4" />
                <span className="text-sm">{battle.winner.username}</span>
              </div>
            )}
          </div>

          <div className="flex-1 flex items-center justify-end gap-4">
            <div className="text-right">
              <p className="font-semibold text-white text-lg">
                {battle.producer2?.username}
              </p>
              {battle.product2 && (
                <p className="text-zinc-400 text-sm">{battle.product2.title}</p>
              )}
              <p className="text-orange-400 font-bold mt-1">
                {battle.votes_producer2} {t('battles.votes')}
              </p>
            </div>
            {battle.producer2?.avatar_url ? (
              <img
                src={battle.producer2.avatar_url}
                alt={battle.producer2.username || ''}
                className="w-20 h-20 rounded-full object-cover border-2 border-zinc-700"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center border-2 border-zinc-700">
                <Users className="w-8 h-8 text-zinc-600" />
              </div>
            )}
          </div>
        </div>

        {totalVotes > 0 && (
          <div className="mt-6">
            <div className="h-2 rounded-full overflow-hidden bg-zinc-800 flex">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
                style={{ width: `${percent1}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-500"
                style={{ width: `${percent2}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-sm text-zinc-500">
              <span>{percent1.toFixed(0)}%</span>
              <span>{totalVotes} votes total</span>
              <span>{percent2.toFixed(0)}%</span>
            </div>
          </div>
        )}
      </Card>
    </Link>
  );
}
