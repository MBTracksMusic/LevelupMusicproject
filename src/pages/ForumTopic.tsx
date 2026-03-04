import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import { Bot, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { ReputationBadge } from '../components/reputation/ReputationBadge';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation } from '../lib/i18n';
import { getForumFunctionErrorCode, getForumFunctionErrorMessage, useForumActions, useForumPosts } from '../lib/forum/hooks';
import { formatDateTime } from '../lib/utils/format';

const PAGE_SIZE = 20;

export function ForumTopicPage() {
  const { t } = useTranslation();
  const { categorySlug, topicSlug } = useParams<{ categorySlug: string; topicSlug: string }>();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState('');

  const { category, topic, posts, totalCount, totalPages, isLoading, error, refresh } = useForumPosts({
    categorySlug,
    topicSlug,
    page,
    pageSize: PAGE_SIZE,
  });
  const { createReply, isSubmitting } = useForumActions();

  const paginationLabel = useMemo(() => {
    if (totalCount === 0) return t('forum.paginationMessagesZero');
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, totalCount);
    return t('forum.paginationMessages', { from, to, total: totalCount });
  }, [page, t, totalCount]);

  const handleReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!topic || isSubmitting) return;

    const trimmedReply = reply.trim();
    if (!trimmedReply) {
      toast.error(t('forum.replyEmptyError'));
      return;
    }

    try {
      const result = await createReply({
        topicId: topic.id,
        content: trimmedReply,
      });
      setReply('');
      if (result.status === 'review') {
        toast.success(t('forum.replyPending'));
      } else {
        toast.success(t('forum.replySuccess'));
      }
      await refresh();
      setPage(totalPages);
    } catch (replyError) {
      console.error('Failed to create forum reply', replyError);
      const errorCode = getForumFunctionErrorCode(replyError);
      if (errorCode === 'blocked') {
        toast.error(t('forum.contentRejected'));
        return;
      }

      toast.error(getForumFunctionErrorMessage(replyError, t('forum.publishReplyError')));
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4 space-y-8">
        <div className="space-y-4">
          <Link
            to={category ? `/forum/${category.slug}` : '/forum'}
            className="inline-flex items-center gap-2 text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('forum.backToCategory')}
          </Link>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-white">{topic?.title || t('forum.topicFallbackTitle')}</h1>
              {topic?.is_locked && (
                <Badge variant="warning">
                  <Lock className="h-3 w-3" />
                  {t('forum.topicLocked')}
                </Badge>
              )}
            </div>
            <p className="text-zinc-400">
              {category?.name || t('forum.title')} • {paginationLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span>{paginationLabel}</span>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        </div>

        {isLoading && (
          <div className="grid gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="border-zinc-800">
                <div className="h-40 animate-pulse rounded-xl bg-zinc-900" />
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card className="border-red-900 bg-red-950/20">
            <CardContent className="text-sm text-red-300">{error}</CardContent>
          </Card>
        )}

        <div className="grid gap-4">
          {posts.map((post, index) => (
            <Card key={post.id} className="border-zinc-800">
              <CardHeader className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-base">
                    {post.author?.username || t('forum.memberFallback', { id: post.user_id.slice(0, 8) })}
                  </CardTitle>
                  <CardDescription>
                    {t('forum.postNumber', { count: (page - 1) * PAGE_SIZE + index + 1 })} • {formatDateTime(post.created_at)}
                  </CardDescription>
                  {post.author && !post.is_ai_generated && (
                    <ReputationBadge
                      compact
                      rankTier={post.author.rank_tier}
                      level={post.author.level}
                      xp={post.author.xp}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {post.is_ai_generated && (
                    <Badge variant="info">
                      <Bot className="h-3 w-3" />
                      {post.ai_agent_name || t('forum.aiAssistant')}
                    </Badge>
                  )}
                  {post.moderation_status === 'review' && (
                    <Badge variant="warning">{t('forum.review')}</Badge>
                  )}
                  {post.moderation_status === 'blocked' && (
                    <Badge variant="danger">{t('forum.blocked')}</Badge>
                  )}
                  {post.edited_at && (
                    <Badge variant="info">{t('forum.editedAt', { date: formatDateTime(post.edited_at) })}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">
                  {post.is_deleted
                    ? t('forum.deletedPost')
                    : post.is_visible === false && post.moderation_status === 'review'
                    ? t('forum.pendingModeration')
                    : post.is_visible === false && post.moderation_status === 'blocked'
                    ? t('forum.blockedByModeration')
                    : post.content}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              leftIcon={<ChevronLeft className="h-4 w-4" />}
            >
              {t('forum.previousPage')}
            </Button>
            <span className="text-sm text-zinc-400">
              {t('common.page')} {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages}
              rightIcon={<ChevronRight className="h-4 w-4" />}
            >
              {t('forum.nextPage')}
            </Button>
          </div>
        )}

        {user ? (
          topic?.is_locked ? (
            <Card className="border-amber-900 bg-amber-950/20">
              <CardContent className="text-sm text-amber-300">
                {t('forum.topicLockedNotice')}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-zinc-800">
              <CardHeader>
                <CardTitle>{t('forum.replyTitle')}</CardTitle>
                <CardDescription>{t('forum.replyDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleReply} className="space-y-4">
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    disabled={isSubmitting}
                    rows={7}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    placeholder={t('forum.replyPlaceholder')}
                  />
                  <div className="flex justify-end">
                    <Button type="submit" isLoading={isSubmitting}>
                      {t('forum.publishReply')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )
        ) : (
          <Card className="border-zinc-800">
            <CardContent className="py-8 text-center text-zinc-400">
              {t('forum.loginToReply')}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
