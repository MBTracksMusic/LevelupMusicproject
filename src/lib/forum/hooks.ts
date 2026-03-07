import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase/client';
import type { ForumAuthor, ForumCategory, ForumPost, ForumTopic, LatestForumTopic, UserProfile } from '../supabase/types';
import { fetchForumPublicProfilesMap } from '../supabase/forumProfiles';
import { useAuth } from '../auth/hooks';
import { useTranslation } from '../i18n';

const FORUM_CATEGORIES_TABLE = 'forum_categories' as any;
const FORUM_TOPICS_TABLE = 'forum_topics' as any;
const FORUM_POSTS_TABLE = 'forum_posts' as any;

type ForumCategoryRow = Omit<ForumCategory, 'topic_count' | 'post_count'>;
type ForumTopicRow = Omit<ForumTopic, 'author'>;
type ForumPostRow = Omit<ForumPost, 'author'>;
type ForumMutationStatus = 'allowed' | 'review';

type ForumCreateTopicResult = {
  ok: boolean;
  status: ForumMutationStatus;
  topic_id: string;
  topic_slug: string;
  category_slug: string;
  post_id: string;
  moderation_score?: number | null;
  moderation_reason?: string | null;
};

type ForumCreatePostResult = {
  ok: boolean;
  status: ForumMutationStatus;
  post_id: string;
  topic_id: string;
  topic_slug?: string | null;
  category_slug?: string | null;
  moderation_score?: number | null;
  moderation_reason?: string | null;
};

type ForumFunctionError = Error & {
  code?: string;
  status?: number;
};

const getFallbackAuthor = (userId: string, profile: UserProfile | null | undefined): ForumAuthor | undefined => {
  if (!profile || profile.id !== userId) return undefined;
  return {
    id: profile.id,
    username: profile.username || profile.full_name || profile.email,
    avatar_url: profile.avatar_url,
  };
};

const attachAuthorsToTopics = async (
  rows: ForumTopicRow[],
  profile: UserProfile | null | undefined,
): Promise<ForumTopic[]> => {
  const producerMap = await fetchForumPublicProfilesMap(rows.map((row) => row.user_id));

  return rows.map((row) => {
    const producer = producerMap.get(row.user_id);
    const fallback = getFallbackAuthor(row.user_id, profile);

    return {
      ...row,
      author: producer
        ? {
            id: producer.user_id,
            username: producer.username,
            avatar_url: producer.avatar_url,
            xp: producer.xp,
            level: producer.level,
            rank_tier: producer.rank_tier,
            reputation_score: producer.reputation_score,
          }
        : fallback,
    };
  });
};

const readFunctionError = async (error: unknown, fallbackMessage: string): Promise<ForumFunctionError> => {
  const enriched = new Error(fallbackMessage) as ForumFunctionError;

  if (!(error instanceof Error)) {
    return enriched;
  }

  enriched.name = error.name;
  const maybeError = error as Error & { context?: Response };
  const response = maybeError.context;

  if (response instanceof Response) {
    enriched.status = response.status;
    try {
      const payload = await response.json() as { error?: string; code?: string };
      enriched.message = payload.error || fallbackMessage;
      enriched.code = payload.code;
      return enriched;
    } catch {
      enriched.message = fallbackMessage;
      return enriched;
    }
  }

  enriched.message = error.message || fallbackMessage;
  return enriched;
};

const invokeForumFunction = async <T,>(
  functionName: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
  sessionExpiredMessage: string,
): Promise<T> => {
  const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession();
  const accessToken = sessionData.session?.access_token;

  if (refreshError || !accessToken) {
    throw new Error(refreshError?.message || sessionExpiredMessage);
  }

  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body,
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      Authorization: `Bearer ${accessToken}`,
      'x-supabase-auth': `Bearer ${accessToken}`,
    },
  });

  if (error) {
    throw await readFunctionError(error, fallbackMessage);
  }

  return data as T;
};

export const isForumFunctionError = (error: unknown): error is ForumFunctionError => {
  return error instanceof Error;
};

export const getForumFunctionErrorCode = (error: unknown) => {
  return isForumFunctionError(error) ? error.code ?? null : null;
};

export const getForumFunctionErrorMessage = (error: unknown, fallbackMessage: string) => {
  return isForumFunctionError(error) ? error.message || fallbackMessage : fallbackMessage;
};

const attachAuthorsToPosts = async (
  rows: ForumPostRow[],
  profile: UserProfile | null | undefined,
): Promise<ForumPost[]> => {
  const producerMap = await fetchForumPublicProfilesMap(rows.map((row) => row.user_id));

  return rows.map((row) => {
    const producer = producerMap.get(row.user_id);
    const fallback = getFallbackAuthor(row.user_id, profile);

    return {
      ...row,
      author: producer
        ? {
            id: producer.user_id,
            username: producer.username,
            avatar_url: producer.avatar_url,
            xp: producer.xp,
            level: producer.level,
            rank_tier: producer.rank_tier,
            reputation_score: producer.reputation_score,
          }
        : row.is_ai_generated && row.ai_agent_name
        ? {
            id: row.user_id,
            username: row.ai_agent_name,
            avatar_url: null,
          }
        : fallback,
    };
  });
};

export function useForumCategories() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<ForumCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [{ data: categoriesData, error: categoriesError }, { data: topicsData, error: topicsError }] =
        await Promise.all([
          supabase.from(FORUM_CATEGORIES_TABLE).select('*').order('position', { ascending: true }).order('created_at', { ascending: true }),
          supabase.from(FORUM_TOPICS_TABLE).select('id, category_id, post_count'),
        ]);

      if (categoriesError) throw categoriesError;
      if (topicsError) {
        console.warn('Forum topics counts unavailable, falling back to zero counts', topicsError);
      }

      const categoryRows = ((categoriesData as unknown as ForumCategoryRow[] | null) ?? []);
      const topicRows = topicsError
        ? []
        : ((topicsData as unknown as Array<Pick<ForumTopicRow, 'id' | 'category_id' | 'post_count'>> | null) ?? []);

      const countsByCategory = new Map<string, { topicCount: number; postCount: number }>();

      for (const topic of topicRows) {
        const current = countsByCategory.get(topic.category_id) ?? { topicCount: 0, postCount: 0 };
        current.topicCount += 1;
        current.postCount += topic.post_count ?? 0;
        countsByCategory.set(topic.category_id, current);
      }

      setCategories(
        categoryRows.map((category) => {
          const counts = countsByCategory.get(category.id);
          return {
            ...category,
            topic_count: counts?.topicCount ?? 0,
            post_count: counts?.postCount ?? 0,
          };
        }),
      );
    } catch (loadError) {
      console.error('Failed to load forum categories', loadError);
      setError(t('forum.categoriesLoadError'));
      setCategories([]);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { categories, isLoading, error, refresh };
}

export function useLatestForumTopics(limit = 8) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [topics, setTopics] = useState<LatestForumTopic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [{ data: categoriesData, error: categoriesError }, { data: topicsData, error: topicsError }] =
        await Promise.all([
          supabase.from(FORUM_CATEGORIES_TABLE).select('*'),
          supabase.from(FORUM_TOPICS_TABLE).select('*').order('last_post_at', { ascending: false }).limit(limit),
        ]);

      if (categoriesError) throw categoriesError;
      if (topicsError) throw topicsError;

      const categoryRows = ((categoriesData as unknown as ForumCategoryRow[] | null) ?? []);
      const topicRows = ((topicsData as unknown as ForumTopicRow[] | null) ?? []);
      const categoriesById = new Map(categoryRows.map((category) => [category.id, category]));
      const topicsWithAuthors = await attachAuthorsToTopics(topicRows, profile);

      setTopics(
        topicsWithAuthors
          .map((topic) => {
            const category = categoriesById.get(topic.category_id);

            return {
              ...topic,
              category_name: category?.name ?? t('forum.unknownCategory'),
              category_slug: category?.slug ?? '',
              category_is_premium_only: category?.is_premium_only ?? false,
            };
          })
          .filter((topic) => topic.category_slug.length > 0),
      );
    } catch (loadError) {
      console.error('Failed to load latest forum topics', loadError);
      setTopics([]);
      setError(t('forum.latestTopicsLoadError'));
    } finally {
      setIsLoading(false);
    }
  }, [limit, profile, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { topics, isLoading, error, refresh };
}

interface UseForumTopicsOptions {
  categorySlug?: string;
  page: number;
  pageSize?: number;
}

export function useForumTopics({ categorySlug, page, pageSize = 20 }: UseForumTopicsOptions) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [category, setCategory] = useState<ForumCategoryRow | null>(null);
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCount / pageSize)),
    [pageSize, totalCount],
  );

  const refresh = useCallback(async () => {
    if (!categorySlug) {
      setCategory(null);
      setTopics([]);
      setTotalCount(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: categoryData, error: categoryError } = await supabase
        .from(FORUM_CATEGORIES_TABLE)
        .select('*')
        .eq('slug', categorySlug)
        .maybeSingle();

      if (categoryError) throw categoryError;

      const categoryRow = (categoryData as unknown as ForumCategoryRow | null) ?? null;
      if (!categoryRow) {
        setCategory(null);
        setTopics([]);
        setTotalCount(0);
        setError(t('forum.categoryUnavailable'));
        return;
      }

      setCategory(categoryRow);

      const from = Math.max(0, (page - 1) * pageSize);
      const to = from + pageSize - 1;

      const { data: topicData, error: topicError, count } = await supabase
        .from(FORUM_TOPICS_TABLE)
        .select('*', { count: 'exact' })
        .eq('category_id', categoryRow.id)
        .order('is_pinned', { ascending: false })
        .order('last_post_at', { ascending: false })
        .range(from, to);

      if (topicError) throw topicError;

      const topicRows = ((topicData as unknown as ForumTopicRow[] | null) ?? []);
      setTopics(await attachAuthorsToTopics(topicRows, profile));
      setTotalCount(count ?? 0);
    } catch (loadError) {
      console.error('Failed to load forum topics', loadError);
      setCategory(null);
      setTopics([]);
      setTotalCount(0);
      setError(t('forum.categoryLoadError'));
    } finally {
      setIsLoading(false);
    }
  }, [categorySlug, page, pageSize, profile, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { category, topics, totalCount, totalPages, isLoading, error, refresh };
}

interface UseForumPostsOptions {
  categorySlug?: string;
  topicSlug?: string;
  page: number;
  pageSize?: number;
}

export function useForumPosts({ categorySlug, topicSlug, page, pageSize = 20 }: UseForumPostsOptions) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [category, setCategory] = useState<ForumCategoryRow | null>(null);
  const [topic, setTopic] = useState<ForumTopic | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCount / pageSize)),
    [pageSize, totalCount],
  );

  const refresh = useCallback(async () => {
    if (!categorySlug || !topicSlug) {
      setCategory(null);
      setTopic(null);
      setPosts([]);
      setTotalCount(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: categoryData, error: categoryError } = await supabase
        .from(FORUM_CATEGORIES_TABLE)
        .select('*')
        .eq('slug', categorySlug)
        .maybeSingle();

      if (categoryError) throw categoryError;

      const categoryRow = (categoryData as unknown as ForumCategoryRow | null) ?? null;
      if (!categoryRow) {
        setCategory(null);
        setTopic(null);
        setPosts([]);
        setTotalCount(0);
        setError(t('forum.topicUnavailable'));
        return;
      }

      setCategory(categoryRow);

      const { data: topicData, error: topicError } = await supabase
        .from(FORUM_TOPICS_TABLE)
        .select('*')
        .eq('category_id', categoryRow.id)
        .eq('slug', topicSlug)
        .maybeSingle();

      if (topicError) throw topicError;

      const topicRow = (topicData as unknown as ForumTopicRow | null) ?? null;
      if (!topicRow) {
        setTopic(null);
        setPosts([]);
        setTotalCount(0);
        setError(t('forum.topicUnavailable'));
        return;
      }

      const [topicWithAuthor] = await attachAuthorsToTopics([topicRow], profile);
      setTopic(topicWithAuthor ?? null);

      const from = Math.max(0, (page - 1) * pageSize);
      const to = from + pageSize - 1;

      const { data: postData, error: postError, count } = await supabase
        .from(FORUM_POSTS_TABLE)
        .select('*', { count: 'exact' })
        .eq('topic_id', topicRow.id)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (postError) throw postError;

      const postRows = ((postData as unknown as ForumPostRow[] | null) ?? []);
      setPosts(await attachAuthorsToPosts(postRows, profile));
      setTotalCount(count ?? 0);
    } catch (loadError) {
      console.error('Failed to load forum topic', loadError);
      setCategory(null);
      setTopic(null);
      setPosts([]);
      setTotalCount(0);
      setError(t('forum.topicLoadError'));
    } finally {
      setIsLoading(false);
    }
  }, [categorySlug, topicSlug, page, pageSize, profile, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { category, topic, posts, totalCount, totalPages, isLoading, error, refresh };
}

export function useForumActions() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createTopic = useCallback(async (input: { categorySlug: string; title: string; content: string }) => {
    if (!user) {
      throw new Error(t('forum.loginRequiredCreateTopic'));
    }

    setIsSubmitting(true);

    try {
      return await invokeForumFunction<ForumCreateTopicResult>(
        'forum-create-topic',
        {
          category_slug: input.categorySlug,
          title: input.title.trim(),
          content: input.content.trim(),
        },
        t('forum.createTopicError'),
        t('forum.sessionExpired'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [t, user]);

  const createReply = useCallback(async (input: { topicId: string; content: string }) => {
    if (!user) {
      throw new Error(t('forum.loginRequiredReply'));
    }

    setIsSubmitting(true);

    try {
      return await invokeForumFunction<ForumCreatePostResult>(
        'forum-create-post',
        {
          topic_id: input.topicId,
          content: input.content.trim(),
        },
        t('forum.publishReplyError'),
        t('forum.sessionExpired'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [t, user]);

  const likePost = useCallback(async (input: { postId: string }) => {
    if (!user) {
      throw new Error(t('forum.loginRequiredReply'));
    }

    const postId = input.postId.trim();
    if (!postId) {
      throw new Error('post_id_required');
    }

    const { error } = await supabase.rpc('rpc_like_forum_post' as any, {
      p_post_id: postId,
    });

    if (error) {
      throw error;
    }
  }, [t, user]);

  return { createTopic, createReply, likePost, isSubmitting };
}
