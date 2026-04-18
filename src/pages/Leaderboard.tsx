import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ReputationBadge } from '../components/reputation/ReputationBadge';
import {
  useActiveSeason,
  useEloLeaderboard,
  useLeaderboard,
  useSeasonLeaderboard,
  useWeeklyLeaderboard,
} from '../lib/reputation/hooks';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation } from '../lib/i18n';
import { formatDate } from '../lib/utils/format';

type LeaderboardPeriod = 'week' | 'month';
type LeaderboardSource = 'overall' | 'forum' | 'battle';
type LeaderboardGlobalMode = 'elo' | 'reputation';
type LeaderboardTab = 'global' | 'weekly' | 'season';

export function LeaderboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<LeaderboardTab>('global');
  const [globalMode, setGlobalMode] = useState<LeaderboardGlobalMode>('elo');
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [source, setSource] = useState<LeaderboardSource>('overall');

  const {
    entries: eloEntries,
    isLoading: isEloLoading,
    error: eloError,
    refresh: refreshElo,
  } = useEloLeaderboard(100);

  const {
    entries: reputationEntries,
    isLoading: isReputationLoading,
    error: reputationError,
    refresh: refreshReputation,
  } = useLeaderboard(period, source);

  const {
    entries: weeklyEntries,
    isLoading: isWeeklyLoading,
    error: weeklyError,
    refresh: refreshWeekly,
  } = useWeeklyLeaderboard(50);

  const {
    entries: seasonEntries,
    isLoading: isSeasonLoading,
    error: seasonError,
    refresh: refreshSeason,
  } = useSeasonLeaderboard(100);

  const { season: activeSeason } = useActiveSeason();
  const canUseReputationMode = Boolean(user);

  useEffect(() => {
    if (!canUseReputationMode && globalMode === 'reputation') {
      setGlobalMode('elo');
    }
  }, [canUseReputationMode, globalMode]);

  const isLoading =
    tab === 'weekly'
      ? isWeeklyLoading
      : tab === 'season'
      ? isSeasonLoading
      : globalMode === 'elo'
      ? isEloLoading
      : isReputationLoading;

  const error =
    tab === 'weekly'
      ? weeklyError
      : tab === 'season'
      ? seasonError
      : globalMode === 'elo'
      ? eloError
      : reputationError;

  const hasEntries =
    tab === 'weekly'
      ? weeklyEntries.length > 0
      : tab === 'season'
      ? seasonEntries.length > 0
      : globalMode === 'elo'
      ? eloEntries.length > 0
      : reputationEntries.length > 0;

  const handleRefresh = () => {
    if (tab === 'weekly') {
      void refreshWeekly();
      return;
    }

    if (tab === 'season') {
      void refreshSeason();
      return;
    }

    if (globalMode === 'elo') {
      void refreshElo();
      return;
    }

    if (canUseReputationMode) {
      void refreshReputation();
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">{t('leaderboard.title')}</h1>
            <p className="text-zinc-400">{t('leaderboard.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={handleRefresh}>
            {t('common.refresh')}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant={tab === 'global' ? 'primary' : 'outline'} onClick={() => setTab('global')}>
            {t('leaderboard.tabGlobal')}
          </Button>
          <Button variant={tab === 'weekly' ? 'primary' : 'outline'} onClick={() => setTab('weekly')}>
            {t('leaderboard.tabWeekly')}
          </Button>
          <Button variant={tab === 'season' ? 'primary' : 'outline'} onClick={() => setTab('season')}>
            {t('leaderboard.tabSeason')}
          </Button>
        </div>

        {tab === 'global' && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant={globalMode === 'elo' ? 'primary' : 'outline'} onClick={() => setGlobalMode('elo')}>
                {t('leaderboard.modeElo')}
              </Button>
              <Button
                variant={globalMode === 'reputation' ? 'primary' : 'outline'}
                disabled={!canUseReputationMode}
                onClick={() => setGlobalMode('reputation')}
              >
                {t('leaderboard.modeReputation')}
              </Button>
            </div>

            {globalMode === 'reputation' && (
              <div className="flex flex-wrap gap-2">
                <Button variant={period === 'week' ? 'primary' : 'outline'} onClick={() => setPeriod('week')}>
                  {t('leaderboard.week')}
                </Button>
                <Button variant={period === 'month' ? 'primary' : 'outline'} onClick={() => setPeriod('month')}>
                  {t('leaderboard.month')}
                </Button>
                <Button variant={source === 'overall' ? 'primary' : 'outline'} onClick={() => setSource('overall')}>
                  {t('leaderboard.overall')}
                </Button>
                <Button variant={source === 'forum' ? 'primary' : 'outline'} onClick={() => setSource('forum')}>
                  {t('leaderboard.forum')}
                </Button>
                <Button variant={source === 'battle' ? 'primary' : 'outline'} onClick={() => setSource('battle')}>
                  {t('leaderboard.battles')}
                </Button>
              </div>
            )}
          </>
        )}

        {tab === 'season' && activeSeason && (
          <Card className="border-zinc-800 p-4 text-sm text-zinc-300">
            {t('leaderboard.activeSeasonLabel', {
              name: activeSeason.name,
              start: formatDate(activeSeason.start_date),
              end: formatDate(activeSeason.end_date),
            })}
          </Card>
        )}

        {error && <Card className="border-red-900 bg-red-950/20 p-4 text-sm text-red-300">{error}</Card>}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="h-20 animate-pulse border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        ) : !hasEntries ? (
          <Card className="p-8 text-center text-zinc-400">{t('leaderboard.empty')}</Card>
        ) : tab === 'weekly' ? (
          <div className="space-y-3">
            {weeklyEntries.map((entry, index) => (
              <Card key={entry.user_id} className="border-zinc-800 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white font-bold">
                      {entry.rank_position || index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">{entry.username || t('leaderboard.memberFallback')}</p>
                        {index < 3 && (
                          <span className="inline-flex items-center gap-1 text-amber-300 text-xs">
                            <Trophy className="h-3 w-3" />
                            {t('leaderboard.topRank', { rank: index + 1 })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 uppercase tracking-wide">
                        {t('leaderboard.weeklyRecord', {
                          wins: entry.weekly_wins,
                          losses: entry.weekly_losses,
                          winRate: entry.weekly_winrate,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm text-zinc-400">
                    <div className="text-white font-semibold">
                      {t('leaderboard.weeklyWins', { wins: entry.weekly_wins })}
                    </div>
                    <div>{t('leaderboard.weeklyLosses', { losses: entry.weekly_losses })}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : tab === 'season' ? (
          <div className="space-y-3">
            {seasonEntries.map((entry, index) => (
              <Card key={`${entry.season_id}:${entry.user_id}`} className="border-zinc-800 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white font-bold">
                      {entry.rank_position || index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">{entry.username || t('leaderboard.memberFallback')}</p>
                        {index < 3 && (
                          <span className="inline-flex items-center gap-1 text-amber-300 text-xs">
                            <Trophy className="h-3 w-3" />
                            {t('leaderboard.topRank', { rank: index + 1 })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 uppercase tracking-wide">
                        {t('leaderboard.eloRecord', {
                          wins: entry.battle_wins,
                          losses: entry.battle_losses,
                          draws: entry.battle_draws,
                          winRate: entry.win_rate,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm text-zinc-400">
                    <div className="text-white font-semibold">{t('leaderboard.eloPoints', { elo: entry.elo_rating })}</div>
                    <div>{t('leaderboard.totalBattles', { total: entry.total_battles })}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : globalMode === 'elo' ? (
          <div className="space-y-3">
            {eloEntries.map((entry, index) => (
              <Card key={entry.user_id} className="border-zinc-800 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white font-bold">
                      {entry.rank_position || index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">{entry.username || t('leaderboard.memberFallback')}</p>
                        {index < 3 && (
                          <span className="inline-flex items-center gap-1 text-amber-300 text-xs">
                            <Trophy className="h-3 w-3" />
                            {t('leaderboard.topRank', { rank: index + 1 })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 uppercase tracking-wide">
                        {t('leaderboard.eloRecord', {
                          wins: entry.battle_wins,
                          losses: entry.battle_losses,
                          draws: entry.battle_draws,
                          winRate: entry.win_rate,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm text-zinc-400">
                    <div className="text-white font-semibold">{t('leaderboard.eloPoints', { elo: entry.elo_rating })}</div>
                    <div>{t('leaderboard.totalBattles', { total: entry.total_battles })}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {reputationEntries.map((entry, index) => (
              <Card key={entry.user_id} className="border-zinc-800 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white font-bold">
                      {index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">{entry.username || t('leaderboard.memberFallback')}</p>
                        {index < 3 && (
                          <span className="inline-flex items-center gap-1 text-amber-300 text-xs">
                            <Trophy className="h-3 w-3" />
                            {t('leaderboard.topRank', { rank: index + 1 })}
                          </span>
                        )}
                      </div>
                      <ReputationBadge rankTier={entry.rank_tier} level={entry.level} xp={entry.xp} />
                    </div>
                  </div>
                  <div className="text-right text-sm text-zinc-400">
                    <div className="text-white font-semibold">{t('leaderboard.periodXp', { xp: entry.period_xp })}</div>
                    <div>{t('leaderboard.totalXp', { xp: entry.xp })}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="text-sm text-zinc-500">
          {t('leaderboard.protectedPrefix')}{' '}
          <Link to="/forum" className="text-rose-400 hover:text-rose-300">
            {t('leaderboard.openForum')}
          </Link>
        </div>
      </div>
    </div>
  );
}
