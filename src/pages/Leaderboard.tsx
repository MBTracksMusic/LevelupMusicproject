import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ReputationBadge } from '../components/reputation/ReputationBadge';
import { useLeaderboard } from '../lib/reputation/hooks';
import { useTranslation } from '../lib/i18n';

type LeaderboardPeriod = 'week' | 'month';
type LeaderboardSource = 'overall' | 'forum' | 'battle';

export function LeaderboardPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [source, setSource] = useState<LeaderboardSource>('overall');
  const { entries, isLoading, error, refresh } = useLeaderboard(period, source);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-24">
      <div className="max-w-5xl mx-auto px-4 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">{t('leaderboard.title')}</h1>
            <p className="text-zinc-400">{t('leaderboard.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        </div>

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

        {error && (
          <Card className="border-red-900 bg-red-950/20 p-4 text-sm text-red-300">
            {error}
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="h-20 animate-pulse border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <Card className="p-8 text-center text-zinc-400">
            {t('leaderboard.empty')}
          </Card>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, index) => (
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
