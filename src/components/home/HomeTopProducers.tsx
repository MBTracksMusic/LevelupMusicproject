import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Users } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { supabase } from '../../lib/supabase/client';

interface BattleWinnerRow {
  winner_id: string | null;
  winner: {
    id: string;
    username: string | null;
    avatar_url: string | null;
  } | null;
}

interface RankedProducer {
  id: string;
  username: string | null;
  avatar_url: string | null;
  wins: number;
}

function pluralizeWins(wins: number) {
  return wins > 1 ? 'victoires' : 'victoire';
}

export function HomeTopProducers() {
  const [producers, setProducers] = useState<RankedProducer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function fetchTopProducers() {
      setIsLoading(true);

      const { data, error } = await supabase
        .from('battles')
        .select(`
          winner_id,
          winner:user_profiles!battles_winner_id_fkey(id, username, avatar_url)
        `)
        .eq('status', 'completed')
        .not('winner_id', 'is', null);

      if (!isCancelled) {
        if (error) {
          console.error('Error fetching top producers for home:', error);
          setProducers([]);
          setIsLoading(false);
          return;
        }

        const winsByProducer = new Map<string, RankedProducer>();
        for (const row of (data as BattleWinnerRow[] | null) ?? []) {
          if (!row.winner_id) continue;

          const current = winsByProducer.get(row.winner_id);
          if (current) {
            current.wins += 1;
            continue;
          }

          winsByProducer.set(row.winner_id, {
            id: row.winner_id,
            username: row.winner?.username ?? null,
            avatar_url: row.winner?.avatar_url ?? null,
            wins: 1,
          });
        }

        const ranking = [...winsByProducer.values()]
          .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            return (a.username || '').localeCompare(b.username || '', 'fr');
          })
          .slice(0, 10);

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
    <section className="py-20 bg-zinc-900">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Flame className="w-5 h-5 text-orange-400" />
              <h2 className="text-3xl font-bold text-white">Top producteurs</h2>
            </div>
            <p className="text-zinc-400">Top 10 par nombre de victoires en battles</p>
          </div>
          <Link to="/producers">
            <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Voir tous les producteurs
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 animate-pulse space-y-4">
                <div className="w-16 h-16 rounded-full bg-zinc-800 mx-auto" />
                <div className="h-4 bg-zinc-800 rounded w-2/3 mx-auto" />
                <div className="h-6 bg-zinc-800 rounded w-1/2 mx-auto" />
              </div>
            ))}
          </div>
        ) : producers.length === 0 ? (
          <Card className="text-zinc-400">Aucun resultat pour le classement des producteurs.</Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {producers.map((producer) => {
              const content = (
                <Card variant="interactive" className="h-full text-center space-y-3 hover:border-orange-500/50">
                  <div>
                    {producer.avatar_url ? (
                      <img
                        src={producer.avatar_url}
                        alt={producer.username || 'Producteur'}
                        className="w-16 h-16 rounded-full object-cover mx-auto border-2 border-zinc-800"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-zinc-800 mx-auto flex items-center justify-center border-2 border-zinc-700">
                        <Users className="w-7 h-7 text-zinc-500" />
                      </div>
                    )}
                  </div>
                  <p className="font-semibold text-white truncate">
                    {producer.username || 'Producteur'}
                  </p>
                  <div className="flex items-center justify-center">
                    <Badge variant="premium">
                      <Flame className="w-3 h-3" />
                      {producer.wins} {pluralizeWins(producer.wins)}
                    </Badge>
                  </div>
                </Card>
              );

              if (!producer.username) {
                return <div key={producer.id}>{content}</div>;
              }

              return (
                <Link key={producer.id} to={`/producers/${producer.username}`}>
                  {content}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
