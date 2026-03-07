import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useWeeklyLeaderboard } from '../lib/reputation/hooks';
import { useTranslation } from '../lib/i18n';

export function LeaderboardWeeklyPage() {
  const { t } = useTranslation();
  const { entries, isLoading, error, refresh } = useWeeklyLeaderboard(50);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-24">
      <div className="max-w-5xl mx-auto px-4 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">{t('leaderboard.weeklyTitle')}</h1>
            <p className="text-zinc-400">{t('leaderboard.weeklySubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/leaderboard">
              <Button variant="outline">{t('leaderboard.backToGlobal')}</Button>
            </Link>
            <Button variant="outline" onClick={() => void refresh()}>
              {t('common.refresh')}
            </Button>
          </div>
        </div>

        {error && <Card className="border-red-900 bg-red-950/20 p-4 text-sm text-red-300">{error}</Card>}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="h-20 animate-pulse border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <Card className="p-8 text-center text-zinc-400">{t('leaderboard.empty')}</Card>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, index) => (
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
                    <div className="text-white font-semibold">{t('leaderboard.weeklyWins', { wins: entry.weekly_wins })}</div>
                    <div>{t('leaderboard.weeklyLosses', { losses: entry.weekly_losses })}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
