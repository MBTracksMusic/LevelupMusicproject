import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import { formatDateTime } from '../../lib/utils/format';

type ForumCategoryRow = {
  id: string;
  name: string;
  slug: string;
};

type ForumTopicRow = {
  id: string;
  category_id: string;
  user_id: string;
  title: string;
  slug: string;
  created_at: string;
  updated_at?: string | null;
  is_deleted?: boolean;
};

type ForumPostRow = {
  id: string;
  topic_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
  moderation_status?: 'pending' | 'allowed' | 'review' | 'blocked';
  moderation_reason?: string | null;
  is_visible?: boolean;
  is_flagged?: boolean;
  is_deleted?: boolean;
  is_ai_generated?: boolean;
  ai_agent_name?: string | null;
};

const FORUM_CATEGORIES_TABLE = 'forum_categories' as any;
const FORUM_TOPICS_TABLE = 'forum_topics' as any;
const FORUM_POSTS_TABLE = 'forum_posts' as any;

export function AdminForumPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [topics, setTopics] = useState<ForumTopicRow[]>([]);
  const [posts, setPosts] = useState<ForumPostRow[]>([]);
  const [categories, setCategories] = useState<ForumCategoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [isLegacyMode, setIsLegacyMode] = useState(false);

  const loadLegacyForumData = useCallback(async () => {
    const [
      { data: legacyCategoriesData, error: legacyCategoriesError },
      { data: legacyTopicsData, error: legacyTopicsError },
      { data: legacyPostsData, error: legacyPostsError },
    ] = await Promise.all([
      supabase.from(FORUM_CATEGORIES_TABLE).select('id, name, slug').order('name', { ascending: true }),
      supabase
        .from(FORUM_TOPICS_TABLE)
        .select('id, category_id, user_id, title, slug, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from(FORUM_POSTS_TABLE)
        .select('id, topic_id, user_id, content, created_at, is_deleted')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (legacyCategoriesError || legacyTopicsError || legacyPostsError) {
      console.error('Error loading legacy forum moderation data', {
        legacyCategoriesError,
        legacyTopicsError,
        legacyPostsError,
      });
      return false;
    }

    setCategories((legacyCategoriesData as unknown as ForumCategoryRow[] | null) ?? []);
    setTopics((legacyTopicsData as unknown as ForumTopicRow[] | null) ?? []);
    setPosts((legacyPostsData as unknown as ForumPostRow[] | null) ?? []);
    setIsLegacyMode(true);
    return true;
  }, []);

  const loadForumModeration = useCallback(async () => {
    setIsLoading(true);
    setActionKey(null);

    const [
      { data: categoriesData, error: categoriesError },
      { data: topicsData, error: topicsError },
      { data: postsData, error: postsError },
    ] = await Promise.all([
      supabase.from(FORUM_CATEGORIES_TABLE).select('id, name, slug').order('name', { ascending: true }),
      supabase
        .from(FORUM_TOPICS_TABLE)
        .select('id, category_id, user_id, title, slug, created_at, updated_at, is_deleted')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from(FORUM_POSTS_TABLE)
        .select('id, topic_id, user_id, content, created_at, updated_at, moderation_status, moderation_reason, is_visible, is_flagged, is_deleted, is_ai_generated, ai_agent_name')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (categoriesError || topicsError || postsError) {
      console.error('Error loading forum moderation data', { categoriesError, topicsError, postsError });

      const legacyLoaded = await loadLegacyForumData();
      if (!legacyLoaded) {
        toast.error(t('admin.forum.loadError'));
        setCategories([]);
        setTopics([]);
        setPosts([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      return;
    }

    setIsLegacyMode(false);
    setCategories((categoriesData as unknown as ForumCategoryRow[] | null) ?? []);
    setTopics((topicsData as unknown as ForumTopicRow[] | null) ?? []);
    setPosts((postsData as unknown as ForumPostRow[] | null) ?? []);
    setIsLoading(false);
  }, [loadLegacyForumData, t]);

  useEffect(() => {
    void loadForumModeration();
  }, [loadForumModeration]);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const topicMap = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const reviewPosts = useMemo(
    () => posts.filter((post) => post.moderation_status === 'review' || post.is_flagged || post.moderation_status === 'blocked'),
    [posts],
  );

  const runTopicDeleteState = async (topic: ForumTopicRow, nextDeleted: boolean) => {
    setActionKey(`topic:${topic.id}:${nextDeleted ? 'delete' : 'restore'}`);

    const { error } = await supabase.rpc('forum_admin_set_topic_deleted' as any, {
      p_topic_id: topic.id,
      p_is_deleted: nextDeleted,
    });

    if (error) {
      console.error('Error updating forum topic deletion state', error);
      toast.error(t('admin.forum.topicActionError'));
      setActionKey(null);
      return;
    }

    toast.success(nextDeleted ? t('admin.forum.topicHidden') : t('admin.forum.topicRestored'));
    setActionKey(null);
    await loadForumModeration();
  };

  const runPostAction = async (postId: string, action: 'approve' | 'block' | 'delete' | 'restore') => {
    setActionKey(`post:${postId}:${action}`);

    const { error } = await supabase.rpc('forum_admin_set_post_state' as any, {
      p_post_id: postId,
      p_action: action,
    });

    if (error) {
      console.error('Error applying forum post moderation action', error);
      toast.error(t('admin.forum.postActionError'));
      setActionKey(null);
      return;
    }

    const label = action === 'approve'
      ? t('admin.forum.postApproved')
      : action === 'block'
      ? t('admin.forum.postBlocked')
      : action === 'delete'
      ? t('admin.forum.postDeleted')
      : t('admin.forum.postRestored');

    toast.success(label);
    setActionKey(null);
    await loadForumModeration();
  };

  const canAct = Boolean(user?.id) && !isLegacyMode;
  const getModerationBadgeLabel = (status: ForumPostRow['moderation_status']) => {
    if (status === 'review') return t('forum.review');
    if (status === 'blocked') return t('forum.blocked');
    return '';
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('admin.forum.title')}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t('admin.forum.subtitle')}
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadForumModeration()}>
            {t('common.refresh')}
          </Button>
        </div>
      </Card>

      {isLegacyMode && (
        <Card className="border-amber-900 bg-amber-950/20 p-4 sm:p-5">
          <p className="text-sm text-amber-300">
            {t('admin.forum.legacyNotice')}
          </p>
        </Card>
      )}

      <Card className="p-4 sm:p-5">
        <h3 className="mb-4 text-lg font-semibold text-white">{t('admin.forum.reviewTitle')}</h3>
        {isLoading ? (
          <p className="text-zinc-400">{t('common.loading')}</p>
        ) : isLegacyMode ? (
          <p className="text-zinc-500">
            {t('admin.forum.legacyUnavailable')}
          </p>
        ) : reviewPosts.length === 0 ? (
          <p className="text-zinc-500">{t('admin.forum.reviewEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {reviewPosts.map((post) => {
              const topic = topicMap.get(post.topic_id);
              return (
                <div key={post.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-zinc-500">
                        {topic?.title || post.topic_id} • {formatDateTime(post.created_at)}
                      </p>
                      {post.moderation_status === 'review' && <Badge variant="warning">{getModerationBadgeLabel('review')}</Badge>}
                      {post.moderation_status === 'blocked' && <Badge variant="danger">{getModerationBadgeLabel('blocked')}</Badge>}
                      {post.is_deleted && <Badge variant="info">{t('admin.forum.softDeleted')}</Badge>}
                      {post.is_ai_generated && <Badge variant="info">{post.ai_agent_name || t('forum.aiAssistant')}</Badge>}
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-zinc-200">{post.content}</p>
                    {post.moderation_reason && (
                      <p className="text-xs text-zinc-500">{t('admin.forum.reason')}: {post.moderation_reason}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        isLoading={actionKey === `post:${post.id}:approve`}
                        disabled={!canAct}
                        onClick={() => void runPostAction(post.id, 'approve')}
                      >
                        {t('admin.forum.approve')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        isLoading={actionKey === `post:${post.id}:block`}
                        disabled={!canAct}
                        onClick={() => void runPostAction(post.id, 'block')}
                      >
                        {t('admin.forum.block')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        isLoading={actionKey === `post:${post.id}:delete`}
                        disabled={!canAct}
                        onClick={() => void runPostAction(post.id, 'delete')}
                      >
                        {t('admin.forum.softDelete')}
                      </Button>
                      {post.is_deleted && (
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={actionKey === `post:${post.id}:restore`}
                          disabled={!canAct}
                          onClick={() => void runPostAction(post.id, 'restore')}
                        >
                          {t('admin.forum.restore')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-4 text-lg font-semibold text-white">{t('admin.forum.latestTopics')}</h3>
        {isLoading ? (
          <p className="text-zinc-400">{t('common.loading')}</p>
        ) : topics.length === 0 ? (
          <p className="text-zinc-500">{t('admin.forum.noTopic')}</p>
        ) : (
          <div className="space-y-3">
            {topics.map((topic) => {
              const category = categoryMap.get(topic.category_id);
              return (
                <div key={topic.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-zinc-500">
                          {category?.name || topic.category_id} • {formatDateTime(topic.created_at)}
                        </p>
                        {topic.is_deleted && <Badge variant="warning">{t('admin.forum.hidden')}</Badge>}
                      </div>
                      <h4 className="font-medium text-white">{topic.title}</h4>
                      <p className="text-xs text-zinc-500">{topic.slug}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant={topic.is_deleted ? 'outline' : 'danger'}
                        size="sm"
                        isLoading={actionKey === `topic:${topic.id}:${topic.is_deleted ? 'restore' : 'delete'}`}
                        disabled={!canAct}
                        onClick={() => void runTopicDeleteState(topic, !topic.is_deleted)}
                      >
                        {topic.is_deleted ? t('admin.forum.restore') : t('admin.forum.hide')}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-4 text-lg font-semibold text-white">{t('admin.forum.latestPosts')}</h3>
        {isLoading ? (
          <p className="text-zinc-400">{t('common.loading')}</p>
        ) : posts.length === 0 ? (
          <p className="text-zinc-500">{t('admin.forum.noPost')}</p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => {
              const topic = topicMap.get(post.topic_id);
              const preview = post.content.length > 180 ? `${post.content.slice(0, 180).trim()}...` : post.content;

              return (
                <div key={post.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-zinc-500">
                          {topic?.title || post.topic_id} • {formatDateTime(post.created_at)}
                        </p>
                        {post.moderation_status === 'review' && <Badge variant="warning">{getModerationBadgeLabel('review')}</Badge>}
                        {post.moderation_status === 'blocked' && <Badge variant="danger">{getModerationBadgeLabel('blocked')}</Badge>}
                        {post.is_deleted && <Badge variant="info">{t('admin.forum.softDeleted')}</Badge>}
                        {post.is_ai_generated && <Badge variant="info">{post.ai_agent_name || t('forum.aiAssistant')}</Badge>}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-zinc-200">{preview}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        isLoading={actionKey === `post:${post.id}:approve`}
                        disabled={!canAct}
                        onClick={() => void runPostAction(post.id, 'approve')}
                      >
                        {t('admin.forum.approve')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        isLoading={actionKey === `post:${post.id}:block`}
                        disabled={!canAct}
                        onClick={() => void runPostAction(post.id, 'block')}
                      >
                        {t('admin.forum.block')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        isLoading={actionKey === `post:${post.id}:delete`}
                        disabled={!canAct}
                        onClick={() => void runPostAction(post.id, 'delete')}
                      >
                        {t('admin.forum.softDelete')}
                      </Button>
                      {post.is_deleted && (
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={actionKey === `post:${post.id}:restore`}
                          disabled={!canAct}
                          onClick={() => void runPostAction(post.id, 'restore')}
                        >
                          {t('admin.forum.restore')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
