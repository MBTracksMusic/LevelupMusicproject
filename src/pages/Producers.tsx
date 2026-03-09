import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { useTranslation } from '../lib/i18n';

interface ProducerListItem {
  user_id: string;
  raw_username: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  producer_tier: string | null;
  social_links: Record<string, string> | null;
  is_deleted: boolean;
  is_producer_active: boolean;
  created_at: string;
  updated_at: string;
}

export function ProducersPage() {
  const { t } = useTranslation();
  const [producers, setProducers] = useState<ProducerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const fetchProducers = async () => {
      setIsLoading(true);
      try {
        let data: unknown[] | null = null;
        let error: unknown = null;

        const visibleRpcRes = await supabase.rpc('get_public_visible_producer_profiles' as any);
        if (!visibleRpcRes.error && Array.isArray(visibleRpcRes.data)) {
          data = visibleRpcRes.data;
        } else {
          const softRpcRes = await supabase.rpc('get_public_producer_profiles_soft' as any);
          if (!softRpcRes.error && Array.isArray(softRpcRes.data)) {
            data = (softRpcRes.data as Array<Record<string, unknown>>).filter((row) => row.is_deleted !== true);
          } else {
            const activeRpcRes = await supabase.rpc('get_public_producer_profiles_v2');
            if (!activeRpcRes.error && Array.isArray(activeRpcRes.data)) {
              data = activeRpcRes.data.map((row) => ({
                ...row,
                raw_username: row.username,
                is_deleted: false,
                is_producer_active: true,
              }));
            } else {
              error = visibleRpcRes.error || softRpcRes.error || activeRpcRes.error;
            }
          }
        }

        if (!data || data.length === 0) {
          const viewRes = await supabase
            .from('public_producer_profiles')
            .select('user_id, raw_username, username, avatar_url, producer_tier, bio, social_links, is_deleted, is_producer_active, created_at, updated_at')
            .eq('is_deleted', false)
            .order('updated_at', { ascending: false });

          data = viewRes.data as unknown[] | null;
          error = viewRes.error ?? error;
        }

        if (error && (!data || data.length === 0)) {
          const { data: legacyData, error: legacyError } = await supabase
            .from('public_producer_profiles')
            .select('user_id, username, avatar_url, producer_tier, bio, social_links, created_at, updated_at')
            .order('updated_at', { ascending: false });

          if (legacyError) {
            throw error;
          }

          data = (legacyData ?? []).map((row) => ({
            ...row,
            raw_username: (row as Record<string, unknown>).username as string | null,
            is_deleted: false,
            is_producer_active: false,
          }));
        }

        const deduped = new Map<string, Record<string, unknown>>();
        for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
          const userId = typeof row.user_id === 'string' ? row.user_id : null;
          if (!userId) continue;
          if (row.is_deleted === true) continue;
          if (row.is_producer_active !== true) continue;
          deduped.set(userId, row);
        }

        const normalized = Array.from(deduped.values())
          .sort((a, b) => {
            const aDate = typeof a.updated_at === 'string' ? a.updated_at : '';
            const bDate = typeof b.updated_at === 'string' ? b.updated_at : '';
            return bDate.localeCompare(aDate);
          });

        if (!isCancelled) {
          setProducers(normalized as unknown as ProducerListItem[]);
        }
      } catch (error) {
        console.error('Error fetching producers:', error);
        if (!isCancelled) {
          setProducers([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchProducers();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('producersPage.title')}</h1>
          <p className="text-zinc-400">{t('producersPage.subtitle')}</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 animate-pulse">
                <div className="w-16 h-16 rounded-full bg-zinc-800 mb-4" />
                <div className="h-4 bg-zinc-800 rounded w-2/3 mb-3" />
                <div className="h-3 bg-zinc-800 rounded w-full" />
              </div>
            ))}
          </div>
        ) : producers.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-zinc-400">{t('producersPage.empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {producers.map((producer) => {
              const cardContent = (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center gap-4 mb-4">
                    {producer.avatar_url ? (
                      <img
                        src={producer.avatar_url}
                        alt={producer.username || t('producersPage.unknownProducer')}
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                        <Users className="w-6 h-6 text-zinc-500" />
                      </div>
                    )}
                    <h2 className="text-lg font-semibold text-white truncate">
                      {producer.username || t('producersPage.unknownProducer')}
                    </h2>
                  </div>
                  <p className="text-sm text-zinc-400 line-clamp-3">
                    {producer.bio || t('producersPage.noBio')}
                  </p>
                </div>
              );

              const profileRouteUsername = producer.raw_username || producer.username;

              if (!profileRouteUsername) {
                return <div key={producer.user_id}>{cardContent}</div>;
              }

              return (
                <Link key={producer.user_id} to={`/producers/${profileRouteUsername}`}>
                  {cardContent}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
