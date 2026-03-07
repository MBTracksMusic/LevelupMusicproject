import { Link } from 'react-router-dom';
import { CalendarDays, Trophy } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useTranslation } from '../../lib/i18n';
import { useWeeklyLeaderboard } from '../../lib/reputation/hooks';

export function HomeWeeklyTopProducers() {
  const { t } = useTranslation();
  const { entries, isLoading } = useWeeklyLeaderboard(5);

  return (
    <section className="py-20 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays className="w-5 h-5 text-orange-400" />
              <h2 className="text-3xl font-bold text-white">{t('home.weeklyTopProducersTitle')}</h2>
            </div>
            <p className="text-zinc-400">{t('home.weeklyTopProducersSubtitle')}</p>
          </div>
          <Link to="/leaderboard-weekly">
            <Button variant="ghost">{t('leaderboard.tabWeekly')}</Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Card key={index} className="h-16 animate-pulse border-zinc-800 bg-zinc-900" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <Card className="text-zinc-400">{t('home.noWeeklyTopProducers')}</Card>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, index) => (
              <Card key={entry.user_id} className="border-zinc-800 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
                      {entry.rank_position || index + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-white">{entry.username || t('leaderboard.memberFallback')}</p>
                      <p className="text-xs text-zinc-500">
                        {t('leaderboard.weeklyRecord', {
                          wins: entry.weekly_wins,
                          losses: entry.weekly_losses,
                          winRate: entry.weekly_winrate,
                        })}
                      </p>
                    </div>
                  </div>
                  {index === 0 && <Trophy className="h-4 w-4 text-amber-300" />}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
