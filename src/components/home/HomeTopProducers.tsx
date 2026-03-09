import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Flame, Users } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';

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

interface PublicVisibleProducerRow {
  user_id: string;
  raw_username: string | null;
  username: string | null;
  avatar_url: string | null;
}

export function HomeTopProducers() {
  const { t } = useTranslation();
  const [producers, setProducers] = useState<RankedProducer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

      if (ranking.length === 0) {
        const { data, error } = await supabase
          .from('leaderboard_producers' as any)
          .select('user_id, username, avatar_url, battle_wins, rank_position')
          .order('battle_wins', { ascending: false })
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
        }
      }

      if (!isCancelled) {
        if (ranking.length === 0) {
          const visibleRpcRes = await supabase.rpc('get_public_visible_producer_profiles' as any);
          if (!visibleRpcRes.error && Array.isArray(visibleRpcRes.data)) {
            ranking = (visibleRpcRes.data as PublicVisibleProducerRow[])
              .slice(0, 10)
              .map((row) => ({
                id: row.user_id,
                profile_path_username: row.raw_username ?? row.username,
                username: row.username ?? row.raw_username,
                avatar_url: row.avatar_url,
                wins: 0,
              }));
          } else {
            const softRpcRes = await supabase.rpc('get_public_producer_profiles_soft' as any);
            if (!softRpcRes.error && Array.isArray(softRpcRes.data)) {
              ranking = (softRpcRes.data as PublicVisibleProducerRow[])
                .slice(0, 10)
                .map((row) => ({
                  id: row.user_id,
                  profile_path_username: row.raw_username ?? row.username,
                  username: row.username ?? row.raw_username,
                  avatar_url: row.avatar_url,
                  wins: 0,
                }));
            } else {
              const v2RpcRes = await supabase.rpc('get_public_producer_profiles_v2');
              if (!v2RpcRes.error && Array.isArray(v2RpcRes.data)) {
                ranking = (v2RpcRes.data as Array<{ user_id: string; username: string | null; avatar_url: string | null }>)
                  .slice(0, 10)
                  .map((row) => ({
                    id: row.user_id,
                    profile_path_username: row.username,
                    username: row.username,
                    avatar_url: row.avatar_url,
                    wins: 0,
                  }));
              } else if (visibleRpcRes.error && rpcRes.error) {
                console.error('Error fetching top producers for home:', rpcRes.error, visibleRpcRes.error);
              } else if (visibleRpcRes.error) {
                console.error('Error fetching top producers fallback for home:', visibleRpcRes.error);
              }
            }
          }
        }

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
              <h2 className="text-3xl font-bold text-white">{t('home.topProducers')}</h2>
            </div>
            <p className="text-zinc-400">{t('home.topProducersSubtitle')}</p>
          </div>
          <Link to="/producers">
            <Button variant="ghost" rightIcon={<ArrowRight className="w-4 h-4" />}>
              {t('home.viewAllProducers')}
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
          <Card className="text-zinc-400">{t('home.noTopProducers')}</Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {producers.map((producer) => {
              const content = (
                <Card variant="interactive" className="h-full text-center space-y-3 hover:border-orange-500/50">
                  <div>
                    {producer.avatar_url ? (
                      <img
                        src={producer.avatar_url}
                        alt={producer.username || t('home.unknownProducer')}
                        className="w-16 h-16 rounded-full object-cover mx-auto border-2 border-zinc-800"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-zinc-800 mx-auto flex items-center justify-center border-2 border-zinc-700">
                        <Users className="w-7 h-7 text-zinc-500" />
                      </div>
                    )}
                  </div>
                  <p className="font-semibold text-white truncate">
                    {producer.username || t('home.unknownProducer')}
                  </p>
                  <div className="flex items-center justify-center">
                    <Badge variant="premium">
                      <Flame className="w-3 h-3" />
                      {producer.wins} {producer.wins > 1 ? t('home.winPlural') : t('home.winSingular')}
                    </Badge>
                  </div>
                </Card>
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
    </section>
  );
}
