import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Clock, ExternalLink, Trophy, Users } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { ReputationBadge } from '../components/reputation/ReputationBadge';
import { useTranslation } from '../lib/i18n';
import { getLocalizedName } from '../lib/i18n/localized';
import { supabase } from '@/lib/supabase/client';
import { fetchPublicProducerProfilesMap } from '../lib/supabase/publicProfiles';
import { fetchCatalogProductsByIds } from '../lib/supabase/catalog';
import { useAuth, useIsEmailVerified } from '../lib/auth/hooks';
import type { BattleWithRelations, Genre } from '../lib/supabase/types';

const PAGE_SIZE = 20;

export function BattlesPage() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const isEmailVerified = useIsEmailVerified();
  const [battles, setBattles] = useState<BattleWithRelations[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'active' | 'voting' | 'completed'>('active');
  const [genreFilter, setGenreFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleFilterChange = (newFilter: 'active' | 'voting' | 'completed') => {
    setBattles([]);
    setPage(0);
    setHasMore(false);
    setFilter(newFilter);
  };

  const handleGenreFilterChange = (nextGenreId: string) => {
    setBattles([]);
    setPage(0);
    setHasMore(false);
    setGenreFilter(nextGenreId);
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchGenres() {
      const { data, error: genresError } = await supabase
        .from('genres')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (cancelled) return;

      if (genresError) {
        console.error('Error loading battle genres:', genresError);
        setGenres([]);
        return;
      }

      setGenres(
        (((data as Genre[] | null) ?? [])).map((genre) => ({
          ...genre,
          sort_order: genre.sort_order ?? 0,
          is_active: genre.is_active ?? false,
        }))
      );
    }

    void fetchGenres();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchBattles() {
      if (page === 0) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      try {
        let query = supabase
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
            genre_id,
            genre:genres(id, name, name_en, name_de, slug),
            status,
            accepted_at,
            rejected_at,
            admin_validated_at,
            rejection_reason,
            response_deadline,
            submission_deadline,
            starts_at,
            voting_ends_at,
            winner_id,
            votes_producer1,
            votes_producer2,
            featured,
            prize_description,
            custom_duration_days,
            extension_count,
            created_at,
            updated_at
          `)
          .eq('status', filter)
          .order('created_at', { ascending: false });

        if (genreFilter) {
          query = query.eq('genre_id', genreFilter);
        }

        const { data, error } = await query.range(from, to);

        if (error) throw error;
        const rows = ((data as BattleWithRelations[] | null) ?? []);
        let nextBattles: BattleWithRelations[] = rows;

        try {
          const [producerProfilesMap, productsMap] = await Promise.all([
            fetchPublicProducerProfilesMap(
              rows.flatMap((row) => [row.producer1_id, row.producer2_id, row.winner_id])
            ),
            fetchCatalogProductsByIds(rows.flatMap((row) => [row.product1_id, row.product2_id])),
          ]);

          nextBattles = rows.map((row) => {
            const producer1 = producerProfilesMap.get(row.producer1_id);
            const producer2 = row.producer2_id ? producerProfilesMap.get(row.producer2_id) : undefined;
            const winner = row.winner_id ? producerProfilesMap.get(row.winner_id) : undefined;
            const product1 = row.product1_id ? productsMap.get(row.product1_id) : undefined;
            const product2 = row.product2_id ? productsMap.get(row.product2_id) : undefined;

            return {
              ...row,
              product1,
              product2,
              producer1: producer1
                ? {
                    id: producer1.user_id,
                    username: producer1.username,
                    avatar_url: producer1.avatar_url,
                    xp: producer1.xp,
                    level: producer1.level,
                    rank_tier: producer1.rank_tier,
                    reputation_score: producer1.reputation_score,
                  }
                : undefined,
              producer2: producer2
                ? {
                    id: producer2.user_id,
                    username: producer2.username,
                    avatar_url: producer2.avatar_url,
                    xp: producer2.xp,
                    level: producer2.level,
                    rank_tier: producer2.rank_tier,
                    reputation_score: producer2.reputation_score,
                  }
                : undefined,
              winner: winner
                ? {
                    id: winner.user_id,
                    username: winner.username,
                    avatar_url: winner.avatar_url,
                    xp: winner.xp,
                    level: winner.level,
                    rank_tier: winner.rank_tier,
                    reputation_score: winner.reputation_score,
                  }
                : undefined,
            };
          }) as BattleWithRelations[];
        } catch (enrichError) {
          console.error('Error enriching battles with producer profiles:', enrichError);
          nextBattles = rows.map((row) => ({
            ...row,
            producer1: undefined,
            producer2: undefined,
            winner: undefined,
          })) as BattleWithRelations[];
        }

        if (!cancelled) {
          setHasMore(rows.length === PAGE_SIZE);
          setBattles((prev) => page === 0 ? nextBattles : [...prev, ...nextBattles]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching battles:', err);
          setError(t('battles.loadError'));
          if (page === 0) setBattles([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    }

    void fetchBattles();
    return () => { cancelled = true; };
  }, [filter, genreFilter, page, t]);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('battles.title')}</h1>
          <p className="text-zinc-400">{t('battles.subtitle')}</p>
        </div>

        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
          <Button
            variant={filter === 'active' ? 'primary' : 'outline'}
            onClick={() => handleFilterChange('active')}
          >
            {t('battles.activeBattles')}
          </Button>
          <Button
            variant={filter === 'completed' ? 'primary' : 'outline'}
            onClick={() => handleFilterChange('completed')}
          >
            {t('battles.completedBattles')}
          </Button>
          <Button
            variant={filter === 'voting' ? 'primary' : 'outline'}
            onClick={() => handleFilterChange('voting')}
          >
            {t('battles.legacyVoting')}
          </Button>
          </div>
          <div className="w-full sm:w-64">
            <Select
              label={t('battles.filterByGenre')}
              value={genreFilter}
              onChange={(event) => handleGenreFilterChange(event.target.value)}
              options={[
                { value: '', label: t('common.all') },
                ...genres.map((genre) => ({ value: genre.id, label: getLocalizedName(genre, language) })),
              ]}
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-8">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {!isEmailVerified && user && (
          <div className="bg-amber-900/20 border border-amber-800 rounded-lg p-4 mb-8">
            <p className="text-amber-400 text-sm">{t('battles.verifyEmailToInteract')}</p>
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
            <p className="text-zinc-400 text-lg">{t('battles.empty')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {battles.map((battle) => (
              <BattleCard key={battle.id} battle={battle} />
            ))}
            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  isLoading={isLoadingMore}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  {t('battles.loadMore')}
                </Button>
              </div>
            )}
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
  const { t, language } = useTranslation();
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
      return `${days}${t('battles.daysShort')} ${hours % 24}${t('battles.hoursShort')}`;
    }
    return `${hours}${t('battles.hoursShort')} ${minutes}${t('battles.minutesShort')}`;
  };

  return (
    <Card padding="none" className="p-4 transition-colors hover:border-rose-500/30 sm:p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="min-w-0 text-lg font-bold text-white sm:text-xl">{battle.title}</h3>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
                ? t('battles.statusActive')
                : battle.status === 'completed'
                ? t('battles.ended')
                : t('battles.upcomingBattles')}
            </Badge>
            {battle.genre && (
              <Badge variant="default">{getLocalizedName(battle.genre, language)}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
          <div className="flex flex-1 items-center gap-3 sm:gap-4">
            {battle.producer1?.avatar_url ? (
              <img
                src={battle.producer1.avatar_url}
                alt={battle.producer1.username || ''}
                className="h-14 w-14 shrink-0 rounded-full border-2 border-zinc-700 object-cover sm:h-16 sm:w-16 md:h-20 md:w-20"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-zinc-700 bg-zinc-800 sm:h-16 sm:w-16 md:h-20 md:w-20">
                <Users className="h-6 w-6 text-zinc-600 sm:h-7 sm:w-7 md:h-8 md:w-8" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white sm:text-lg">
                {battle.producer1?.username || t('battles.producer1')}
              </p>
              {battle.producer1 && (
                <ReputationBadge
                  compact
                  rankTier={battle.producer1.rank_tier}
                  level={battle.producer1.level}
                  xp={battle.producer1.xp}
                />
              )}
              {battle.product1 && (
                <p className="truncate text-sm text-zinc-400">{battle.product1.title}</p>
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
                <span className="text-sm">{battle.winner.username || t('battles.winnerFallback')}</span>
              </div>
            )}
          </div>

          <div className="flex flex-1 items-center gap-3 sm:gap-4 md:flex-row-reverse md:justify-end">
            {battle.producer2?.avatar_url ? (
              <img
                src={battle.producer2.avatar_url}
                alt={battle.producer2.username || ''}
                className="h-14 w-14 shrink-0 rounded-full border-2 border-zinc-700 object-cover sm:h-16 sm:w-16 md:h-20 md:w-20"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-zinc-700 bg-zinc-800 sm:h-16 sm:w-16 md:h-20 md:w-20">
                <Users className="h-6 w-6 text-zinc-600 sm:h-7 sm:w-7 md:h-8 md:w-8" />
              </div>
            )}
            <div className="min-w-0 md:text-right">
              <p className="truncate text-base font-semibold text-white sm:text-lg">
                {battle.producer2?.username || t('battles.producer2')}
              </p>
              {battle.producer2 && (
                <div className="flex md:justify-end">
                  <ReputationBadge
                    compact
                    rankTier={battle.producer2.rank_tier}
                    level={battle.producer2.level}
                    xp={battle.producer2.xp}
                  />
                </div>
              )}
              {battle.product2 && (
                <p className="truncate text-sm text-zinc-400">{battle.product2.title}</p>
              )}
              <p className="text-orange-400 font-bold mt-1">
                {battle.votes_producer2} {t('battles.votes')}
              </p>
            </div>
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
            <div className="mt-2 flex justify-between text-xs text-zinc-500 sm:text-sm">
              <span>{percent1.toFixed(0)}%</span>
              <span>{t('battles.totalVotes', { count: totalVotes })}</span>
              <span>{percent2.toFixed(0)}%</span>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-800 pt-4 sm:justify-end">
          <Link
            to={`/battles/${battle.slug}`}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white sm:flex-none"
          >
            <ExternalLink className="h-4 w-4" />
            {t('common.open')}
          </Link>
          {battle.status === 'completed' && (
            <Link
              to={`/battles/${battle.slug}/feedback`}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 px-3 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 hover:text-amber-100 sm:flex-none"
            >
              <BarChart3 className="h-4 w-4" />
              {t('battleDetail.viewFeedbackReport')}
            </Link>
          )}
        </div>
      </Card>
  );
}
