import { Link } from 'react-router-dom';
import { ArrowRight, Crown, MessageSquare, MessageSquareText, ShieldCheck, Swords } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { formatRankTier } from '../../components/reputation/ReputationBadge';
import { ReputationBadge } from '../../components/reputation/ReputationBadge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { useAuth } from '../../lib/auth/hooks';
import { useForumCategories, useLatestForumTopics } from '../../lib/forum/hooks';
import { useTranslation } from '../../lib/i18n';
import { useMyReputation } from '../../lib/reputation/hooks';
import { meetsRankRequirement } from '../../lib/reputation/utils';
import { formatRelativeTime } from '../../lib/utils/format';

export function ForumPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { reputation } = useMyReputation();
  const { categories, isLoading: isCategoriesLoading, error: categoriesError, refresh: refreshCategories } = useForumCategories();
  const { topics, isLoading: isTopicsLoading, error: topicsError, refresh: refreshTopics } = useLatestForumTopics();

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-6xl mx-auto px-4 space-y-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">{t('forum.title')}</h1>
            <p className="text-zinc-400">{t('forum.subtitle')}</p>
          </div>
          <div className="flex gap-3">
            {user ? (
              <Link to="/forum/new">
                <Button>{t('forum.newTopic')}</Button>
              </Link>
            ) : (
              <Button disabled>{t('forum.newTopic')}</Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refreshCategories();
                void refreshTopics();
              }}
            >
              {t('common.refresh')}
            </Button>
          </div>
        </div>

        {!user && (
          <Card className="border-zinc-800">
            <CardContent className="py-4 text-sm text-zinc-400">
              {t('forum.loginToParticipate')}
            </CardContent>
          </Card>
        )}

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('forum.categoriesTitle')}</h2>
            <p className="text-sm text-zinc-400">{t('forum.categoriesSubtitle')}</p>
          </div>

          {isCategoriesLoading && (
            <div className="grid gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="border-zinc-800">
                  <div className="h-24 animate-pulse rounded-xl bg-zinc-900" />
                </Card>
              ))}
            </div>
          )}

          {categoriesError && (
            <Card className="border-red-900 bg-red-950/20">
              <CardContent className="text-sm text-red-300">{categoriesError}</CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {categories.map((category) => {
              const isRankLocked = !meetsRankRequirement(reputation?.rank_tier, category.required_rank_tier);

              return (
              <Link key={category.id} to={`/forum/${category.slug}`} className="block">
                <Card variant="interactive" className="border-zinc-800">
                  <CardHeader className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{category.name}</CardTitle>
                        {category.is_premium_only && (
                          <Badge variant="premium">
                            <Crown className="h-3 w-3" />
                            {t('forum.premium')}
                          </Badge>
                        )}
                        {category.is_competitive && (
                          <Badge variant="info">
                            <Swords className="h-3 w-3" />
                            {t('forum.competitive')}
                          </Badge>
                        )}
                        {category.required_rank_tier && (
                          <Badge variant="warning">
                            <ShieldCheck className="h-3 w-3" />
                            {t('forum.minimumRank', { rank: formatRankTier(category.required_rank_tier, t) })}
                          </Badge>
                        )}
                        {isRankLocked && (
                          <Badge variant="danger">
                            {t('forum.locked')}
                          </Badge>
                        )}
                      </div>
                      <CardDescription>
                        {category.description || t('forum.noCategoryDescription')}
                      </CardDescription>
                      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                        <span>{t('forum.xpMultiplier', { value: category.xp_multiplier ?? 1 })}</span>
                        <span>{t('forum.moderationLabel', { value: category.moderation_strictness ?? t('forum.moderationNormal') })}</span>
                        <span>{category.allow_links === false ? t('forum.linksForbidden') : t('forum.linksAllowed')}</span>
                        <span>{category.allow_media === false ? t('forum.mediaForbidden') : t('forum.mediaAllowed')}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-zinc-400">
                      <span className="inline-flex items-center gap-1">
                        <MessageSquareText className="h-4 w-4" />
                        {t('forum.topicsCount', { count: category.topic_count })}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-4 w-4" />
                        {t('forum.postsCount', { count: category.post_count })}
                      </span>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('forum.latestTopicsTitle')}</h2>
            <p className="text-sm text-zinc-400">{t('forum.latestTopicsSubtitle')}</p>
          </div>

          {isTopicsLoading && (
            <div className="grid gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="border-zinc-800">
                  <div className="h-24 animate-pulse rounded-xl bg-zinc-900" />
                </Card>
              ))}
            </div>
          )}

          {topicsError && (
            <Card className="border-red-900 bg-red-950/20">
              <CardContent className="text-sm text-red-300">{topicsError}</CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {topics.map((topic) => (
              <Link key={topic.id} to={`/forum/${topic.category_slug}/${topic.slug}`} className="block">
                <Card variant="interactive" className="border-zinc-800">
                  <CardHeader className="mb-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{topic.title}</CardTitle>
                        {topic.category_is_premium_only && (
                          <Badge variant="premium">{t('forum.premium')}</Badge>
                        )}
                      </div>
                      <CardDescription>
                        {t('forum.byAuthor', {
                          category: topic.category_name,
                          author: topic.author?.username || t('forum.memberFallback', { id: topic.user_id.slice(0, 8) }),
                        })}
                      </CardDescription>
                      {topic.author && (
                        <ReputationBadge
                          compact
                          rankTier={topic.author.rank_tier}
                          level={topic.author.level}
                          xp={topic.author.xp}
                        />
                      )}
                    </div>
                    <div className="text-right text-sm text-zinc-400">
                      <div>{t('forum.repliesCount', { count: topic.post_count })}</div>
                      <div>{formatRelativeTime(topic.last_post_at)}</div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <span className="inline-flex items-center gap-2 text-sm text-rose-300">
                      {t('forum.openDiscussion')}
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
