import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
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
  const PAGE_SIZE = 12;
  const { t } = useTranslation();
  const [allProducers, setAllProducers] = useState<ProducerListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(allProducers.length / PAGE_SIZE);
  const producers = allProducers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getPageNumbers = (current: number, total: number): (number | '...')[] => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
    if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '...', current - 1, current, current + 1, '...', total];
  };

  useEffect(() => {
    let isCancelled = false;

    const fetchProducers = async () => {
      setIsLoading(true);
      try {
        const rpcRes = await supabase.rpc('get_public_visible_producer_profiles' as any);
        if (!rpcRes.error && Array.isArray(rpcRes.data)) {
          if (!isCancelled) setAllProducers(rpcRes.data as unknown as ProducerListItem[]);
          return;
        }

        const { data, error } = await supabase
          .from('public_producer_profiles')
          .select('user_id, raw_username, username, avatar_url, producer_tier, bio, social_links, is_deleted, is_producer_active, created_at, updated_at')
          .eq('is_deleted', false)
          .order('updated_at', { ascending: false });

        if (error) throw error;

        const visible = ((data ?? []) as unknown as ProducerListItem[]).filter(
          (r) => r.is_producer_active === true
        );
        if (!isCancelled) setAllProducers(visible);
      } catch (error) {
        console.error('Error fetching producers:', error);
        if (!isCancelled) setAllProducers([]);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void fetchProducers();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 transition-all duration-150 hover:border-zinc-600 hover:shadow-xl hover:shadow-black/40 cursor-pointer">
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
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-white truncate">
                        {producer.username || t('producersPage.unknownProducer')}
                      </h2>
                      {producer.producer_tier && (
                        <span className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 mt-0.5">
                          {producer.producer_tier}
                        </span>
                      )}
                    </div>
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

        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Précédent
            </button>

            <div className="flex items-center gap-1">
              {getPageNumbers(currentPage, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-zinc-500">…</span>
                ) : (
                  <button
                    type="button"
                    key={p}
                    onClick={() => goToPage(p as number)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                      p === currentPage
                        ? 'bg-rose-500 text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Suivant
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
