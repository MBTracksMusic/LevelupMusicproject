import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { AdminPriorityCards } from '../components/admin/AdminPriorityCards';
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { BattleStatus } from '../lib/supabase/types';
import type { Json } from '../lib/supabase/database.types';
import { formatDateTime } from '../lib/utils/format';

interface ProducerLite {
  id: string;
  username: string | null;
  battle_refusal_count: number;
  engagement_score: number;
  battles_participated: number;
  battles_completed: number;
}

interface AdminBattleRow {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  rejection_reason: string | null;
  rejected_at: string | null;
  accepted_at: string | null;
  admin_validated_at: string | null;
  voting_ends_at: string | null;
  custom_duration_days: number | null;
  votes_producer1: number;
  votes_producer2: number;
  producer1?: ProducerLite;
  producer2?: ProducerLite;
}

interface AdminCommentRow {
  id: string;
  battle_id: string;
  content: string;
  is_hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
  user?: { username: string | null };
  battle?: { title: string; slug: string };
}

interface AiActionRow {
  id: string;
  action_type:
    | 'battle_validate'
    | 'battle_cancel'
    | 'battle_finalize'
    | 'comment_moderation'
    | 'match_recommendation'
    | 'battle_duration_set'
    | 'battle_duration_extended';
  entity_type: 'battle' | 'comment' | 'other';
  entity_id: string;
  ai_decision: Record<string, unknown>;
  confidence_score: number | null;
  reason: string | null;
  status: 'proposed' | 'executed' | 'failed' | 'overridden';
  human_override: boolean;
  reversible: boolean;
  created_at: string;
  executed_at: string | null;
  executed_by: string | null;
  error: string | null;
}

interface AdminNotificationRow {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

type AdminFilter = 'all' | 'pending_acceptance' | 'awaiting_admin' | 'rejected';

interface AdminContextState {
  userId: string | null;
  dbRole: string | null;
  isAdmin: boolean | null;
  projectRef: string | null;
  error: string | null;
}

interface AdminBattlesPageProps {
  onAwaitingAdminCountChange?: (count: number) => void;
}

const BATTLES_DEFAULT_PAGE_SIZE = 200;

const badgeByStatus: Record<BattleStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'premium'> = {
  pending: 'warning',
  pending_acceptance: 'warning',
  awaiting_admin: 'info',
  approved: 'info',
  active: 'success',
  voting: 'success',
  completed: 'info',
  cancelled: 'danger',
  rejected: 'danger',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toStatusLabel(status: BattleStatus, t: TranslateFn) {
  if (status === 'pending_acceptance') return t('battleDetail.statusPendingAcceptance');
  if (status === 'awaiting_admin') return t('battleDetail.statusAwaitingAdmin');
  if (status === 'rejected') return t('battleDetail.statusRejected');
  if (status === 'active') return t('battleDetail.statusActive');
  if (status === 'voting') return t('battles.legacyVoting');
  if (status === 'completed') return t('battleDetail.statusCompleted');
  if (status === 'cancelled') return t('battleDetail.statusCancelled');
  if (status === 'approved') return t('battleDetail.statusApproved');
  return t('battleDetail.statusPending');
}

function toAiActionLabel(actionType: AiActionRow['action_type'] | string | null | undefined, t: TranslateFn) {
  if (actionType === 'battle_validate') return t('admin.battles.actionBattleValidate');
  if (actionType === 'battle_cancel') return t('admin.battles.actionBattleCancel');
  if (actionType === 'comment_moderation') return t('admin.battles.actionCommentModeration');
  if (actionType === 'match_recommendation') return t('admin.battles.actionMatchRecommendation');
  if (actionType === 'battle_duration_set') return t('admin.battles.actionBattleDurationSet');
  if (actionType === 'battle_duration_extended') return t('admin.battles.actionBattleDurationExtended');
  return t('admin.battles.actionFallback');
}

function toAiStatusLabel(status: AiActionRow['status'] | string | null | undefined, t: TranslateFn) {
  if (status === 'proposed') return t('admin.battles.statusProposed');
  if (status === 'executed') return t('admin.battles.statusExecuted');
  if (status === 'failed') return t('admin.battles.statusFailed');
  if (status === 'overridden') return t('admin.battles.statusOverridden');
  return t('common.unknown');
}

function toAiEntityLabel(entityType: AiActionRow['entity_type'] | string | null | undefined, t: TranslateFn) {
  if (entityType === 'battle') return t('admin.battles.entityBattle');
  if (entityType === 'comment') return t('admin.battles.entityComment');
  if (entityType === 'other') return t('admin.battles.entityOther');
  return t('common.unknown');
}

function toAdminRpcError(message: string, t: TranslateFn) {
  if (message.includes('admin_required')) return t('admin.battles.rpcAdminRequired');
  if (message.includes('rate_limit_exceeded')) return t('admin.battles.rpcRateLimit');
  if (message.includes('battle_not_found')) return t('admin.battles.rpcBattleNotFound');
  if (message.includes('battle_not_waiting_admin_validation')) return t('admin.battles.rpcAwaitingAdminOnly');
  if (message.includes('cannot_cancel_completed_battle')) return t('admin.battles.rpcCannotCancelCompleted');
  if (message.includes('battle_cancelled')) return t('admin.battles.rpcAlreadyCancelled');
  if (message.includes('battle_not_open_for_finalization')) return t('admin.battles.rpcFinalizeUnavailable');
  if (message.includes('invalid_extension_days')) return t('admin.battles.rpcInvalidExtensionDays');
  if (message.includes('battle_not_open_for_extension')) return t('admin.battles.rpcExtensionUnavailable');
  if (message.includes('battle_has_no_voting_end')) return t('admin.battles.rpcMissingVotingEnd');
  if (message.includes('battle_already_expired')) return t('admin.battles.rpcAlreadyExpired');
  if (message.includes('battle_extension_limit_exceeded')) return t('admin.battles.rpcDurationLimitExceeded');
  if (message.includes('maximum_extensions_reached')) return t('admin.battles.rpcMaxExtensionsReached');
  return t('admin.battles.rpcGenericError');
}

function getEdgeFunctionHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object') return null;

  const status = (context as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function toEdgeFunctionErrorMessage(
  error: unknown,
  functionName: 'ai-evaluate-battle' | 'ai-moderate-comment',
  projectRef: string | null,
  t: TranslateFn,
) {
  const fallbackMessage = error instanceof Error ? error.message : 'unknown_edge_function_error';
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
  const status = getEdgeFunctionHttpStatus(error);
  const projectRefHint = projectRef || 'unknown_project_ref';

  if (status === 404) {
    return t('admin.battles.edgeNotDeployed', { functionName, projectRef: projectRefHint });
  }

  if (status === 401) {
    return t('admin.battles.edgeUnauthorized', { functionName });
  }

  if (status === 403) {
    return t('admin.battles.edgeForbidden', { functionName });
  }

  if (status !== null && status >= 500) {
    return t('admin.battles.edgeServerError', { functionName, status });
  }

  if (
    name === 'FunctionsFetchError'
    || fallbackMessage.includes('Failed to send a request to the Edge Function')
    || fallbackMessage.includes('Failed to fetch')
  ) {
    return t('admin.battles.edgeNetworkError', { functionName, projectRef: projectRefHint });
  }

  if (name === 'FunctionsRelayError') {
    return t('admin.battles.edgeRelayError', { functionName, projectRef: projectRefHint });
  }

  if (name === 'FunctionsHttpError' && status !== null) {
    return t('admin.battles.edgeHttpError', { functionName, status });
  }

  return t('admin.battles.edgeUnknownError', { functionName, message: fallbackMessage });
}

async function invokeEdgeWithFreshJwt(
  functionName: 'ai-evaluate-battle' | 'ai-moderate-comment',
  body: Record<string, unknown>
) {
  const sessionRes = await supabase.auth.getSession();
  const initialToken = sessionRes.data.session?.access_token;

  let result = await supabase.functions.invoke(functionName, {
    body,
    headers: initialToken ? { Authorization: `Bearer ${initialToken}` } : undefined,
  });

  if (!result.error) {
    return result;
  }

  const status = getEdgeFunctionHttpStatus(result.error);
  const message = result.error instanceof Error ? result.error.message.toLowerCase() : '';
  const shouldRetryAfterRefresh = status === 401 && message.includes('invalid jwt');

  if (!shouldRetryAfterRefresh) {
    return result;
  }

  const refreshRes = await supabase.auth.refreshSession();
  const refreshedToken = refreshRes.data.session?.access_token;
  if (refreshRes.error || !refreshedToken) {
    return result;
  }

  result = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${refreshedToken}` },
  });

  return result;
}

function getProjectRef() {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).hostname;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

function formatVotingEnd(value: string | null, t: TranslateFn) {
  if (!value) return t('common.notDefined');
  return formatDateTime(value);
}

function formatTimeRemaining(value: string | null, t: TranslateFn) {
  if (!value) return t('common.notAvailable');
  const endMs = new Date(value).getTime();
  if (!Number.isFinite(endMs)) return t('common.notAvailable');
  const diff = endMs - Date.now();
  if (diff <= 0) return t('admin.battles.expired');

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}${t('battles.daysShort')} ${hours}${t('battles.hoursShort')}`;
  if (hours > 0) return `${hours}${t('battles.hoursShort')} ${minutes}${t('battles.minutesShort')}`;
  return `${minutes}${t('battles.minutesShort')}`;
}

export function AdminBattlesPage({ onAwaitingAdminCountChange }: AdminBattlesPageProps = {}) {
  const { t } = useTranslation();
  const [battles, setBattles] = useState<AdminBattleRow[]>([]);
  const [comments, setComments] = useState<AdminCommentRow[]>([]);
  const [aiActions, setAiActions] = useState<AiActionRow[]>([]);
  const [notifications, setNotifications] = useState<AdminNotificationRow[]>([]);
  const [battlesPage, setBattlesPage] = useState(0);
  const [battlesPageSize] = useState(BATTLES_DEFAULT_PAGE_SIZE);
  const [hasMoreBattles, setHasMoreBattles] = useState(false);
  const [isLoadingMoreBattles, setIsLoadingMoreBattles] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminFilter>('awaiting_admin');
  const [selectedProducerId, setSelectedProducerId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [extendActionKey, setExtendActionKey] = useState<string | null>(null);
  const [extensionDaysByBattleId, setExtensionDaysByBattleId] = useState<Record<string, string>>({});
  const [extensionReasonByBattleId, setExtensionReasonByBattleId] = useState<Record<string, string>>({});
  const [evaluatingBattleId, setEvaluatingBattleId] = useState<string | null>(null);
  const [evaluatingCommentId, setEvaluatingCommentId] = useState<string | null>(null);
  const [aiActionKey, setAiActionKey] = useState<string | null>(null);
  const [adminContext, setAdminContext] = useState<AdminContextState>({
    userId: null,
    dbRole: null,
    isAdmin: null,
    projectRef: getProjectRef(),
    error: null,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const firstPageFrom = 0;
    const firstPageTo = battlesPageSize - 1;

    const [battlesRes, commentsRes, aiActionsRes, notificationsRes] = await Promise.all([
      supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          status,
          rejection_reason,
          rejected_at,
          accepted_at,
          admin_validated_at,
          voting_ends_at,
          custom_duration_days,
          votes_producer1,
          votes_producer2,
          producer1:user_profiles!battles_producer1_id_fkey(
            id,
            username,
            battle_refusal_count,
            engagement_score,
            battles_participated,
            battles_completed
          ),
          producer2:user_profiles!battles_producer2_id_fkey(
            id,
            username,
            battle_refusal_count,
            engagement_score,
            battles_participated,
            battles_completed
          )
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(firstPageFrom, firstPageTo),
      supabase
        .from('battle_comments')
        .select(`
          id,
          battle_id,
          content,
          is_hidden,
          hidden_reason,
          created_at,
          user:user_profiles(username),
          battle:battles(title, slug)
        `)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('ai_admin_actions')
        .select(`
          id,
          action_type,
          entity_type,
          entity_id,
          ai_decision,
          confidence_score,
          reason,
          status,
          human_override,
          reversible,
          created_at,
          executed_at,
          executed_by,
          error
        `)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('admin_notifications')
        .select(`
          id,
          user_id,
          type,
          payload,
          is_read,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (battlesRes.error) {
      console.error('Error loading admin battles:', battlesRes.error);
      setError(t('admin.battles.loadBattlesError'));
      setBattles([]);
      setBattlesPage(0);
      setHasMoreBattles(false);
    } else {
      const firstPageRows = (battlesRes.data as AdminBattleRow[] | null) ?? [];
      setBattles(firstPageRows);
      setBattlesPage(0);
      setHasMoreBattles(firstPageRows.length === battlesPageSize);
    }

    if (commentsRes.error) {
      console.error('Error loading admin comments:', commentsRes.error);
      setComments([]);
      if (!battlesRes.error) {
        setError(t('admin.battles.loadCommentsError'));
      }
    } else {
      setComments((commentsRes.data as AdminCommentRow[] | null) ?? []);
    }

    if (aiActionsRes.error) {
      console.error('Error loading ai admin actions:', aiActionsRes.error);
      setAiActions([]);
      if (!battlesRes.error && !commentsRes.error) {
        setError(t('admin.battles.loadAiActionsError'));
      }
    } else {
      setAiActions(((aiActionsRes.data as AiActionRow[] | null) ?? []).map((row) => ({
        ...row,
        ai_decision: asRecord(row.ai_decision),
      })));
    }

    if (notificationsRes.error) {
      console.error('Error loading admin notifications:', notificationsRes.error);
      setNotifications([]);
      if (!battlesRes.error && !commentsRes.error && !aiActionsRes.error) {
        setError(t('admin.battles.loadNotificationsError'));
      }
    } else {
      setNotifications(
        ((notificationsRes.data as AdminNotificationRow[] | null) ?? []).map((row) => ({
          ...row,
          payload: asRecord(row.payload),
        }))
      );
    }

    setIsLoading(false);
  }, [battlesPageSize, t]);

  const loadMoreBattles = useCallback(async () => {
    if (isLoading || isLoadingMoreBattles || !hasMoreBattles) return;

    setError(null);
    setIsLoadingMoreBattles(true);

    const nextPage = battlesPage + 1;
    const from = nextPage * battlesPageSize;
    const to = from + battlesPageSize - 1;

    const { data, error: battlesError } = await supabase
      .from('battles')
      .select(`
        id,
        title,
        slug,
        status,
        rejection_reason,
        rejected_at,
        accepted_at,
        admin_validated_at,
        voting_ends_at,
        custom_duration_days,
        votes_producer1,
        votes_producer2,
        producer1:user_profiles!battles_producer1_id_fkey(
          id,
          username,
          battle_refusal_count,
          engagement_score,
          battles_participated,
          battles_completed
        ),
        producer2:user_profiles!battles_producer2_id_fkey(
          id,
          username,
          battle_refusal_count,
          engagement_score,
          battles_participated,
          battles_completed
        )
      `)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (battlesError) {
      console.error('Error loading more admin battles:', battlesError);
      setError(t('admin.battles.loadMoreError'));
      setIsLoadingMoreBattles(false);
      return;
    }

    const pageRows = (data as AdminBattleRow[] | null) ?? [];
    setBattles((prev) => [...prev, ...pageRows]);
    setBattlesPage(nextPage);
    setHasMoreBattles(pageRows.length === battlesPageSize);
    setIsLoadingMoreBattles(false);
  }, [battlesPage, battlesPageSize, hasMoreBattles, isLoading, isLoadingMoreBattles, t]);

  const loadAdminContext = useCallback(async () => {
    const projectRef = getProjectRef();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      setAdminContext({
        userId: null,
        dbRole: null,
        isAdmin: null,
        projectRef,
        error: authError.message,
      });
      return;
    }

    const userId = authData.user?.id ?? null;
    if (!userId) {
      setAdminContext({
        userId: null,
        dbRole: null,
        isAdmin: null,
        projectRef,
        error: 'no_active_session',
      });
      return;
    }

    let dbRole: string | null = null;
    let isAdmin: boolean | null = null;
    let contextError: string | null = null;

    const [roleRes, isAdminRes] = await Promise.all([
      supabase.from('user_profiles').select('role').eq('id', userId).maybeSingle(),
      supabase.rpc('is_admin', { p_user_id: userId }),
    ]);

    if (roleRes.error) {
      contextError = roleRes.error.message;
    } else {
      dbRole = (roleRes.data as { role: string } | null)?.role ?? null;
    }

    if (isAdminRes.error) {
      contextError = contextError ? `${contextError} | ${isAdminRes.error.message}` : isAdminRes.error.message;
    } else {
      isAdmin = Boolean(isAdminRes.data);
    }

    setAdminContext({
      userId,
      dbRole,
      isAdmin,
      projectRef,
      error: contextError,
    });
  }, []);

  useEffect(() => {
    void loadAdminContext();
  }, [loadAdminContext]);

  useEffect(() => {
    if (adminContext.isAdmin === true) {
      void loadData();
    }
  }, [adminContext.isAdmin, loadData]);

  const visibleBattles = useMemo(() => {
    if (filter === 'all') return battles;
    return battles.filter((battle) => battle.status === filter);
  }, [battles, filter]);

  const awaitingAdminCount = useMemo(
    () => battles.reduce((count, battle) => count + (battle.status === 'awaiting_admin' ? 1 : 0), 0),
    [battles]
  );

  const rejectionHistory = useMemo(
    () => battles.filter((battle) => battle.status === 'rejected' && !!battle.rejection_reason),
    [battles]
  );

  const expiringSoonBattles = useMemo(() => {
    const nowMs = Date.now();
    const soonMs = nowMs + (24 * 60 * 60 * 1000);

    return battles
      .filter((battle) => {
        if (battle.status !== 'active' && battle.status !== 'voting') return false;
        if (!battle.voting_ends_at) return false;
        const endsAtMs = new Date(battle.voting_ends_at).getTime();
        return Number.isFinite(endsAtMs) && endsAtMs <= soonMs;
      })
      .sort((a, b) => {
        const aMs = a.voting_ends_at ? new Date(a.voting_ends_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bMs = b.voting_ends_at ? new Date(b.voting_ends_at).getTime() : Number.MAX_SAFE_INTEGER;
        return aMs - bMs;
      });
  }, [battles]);

  const engagementRows = useMemo(() => {
    const byId = new Map<string, ProducerLite>();

    for (const battle of battles) {
      if (battle.producer1?.id && !byId.has(battle.producer1.id)) {
        byId.set(battle.producer1.id, battle.producer1);
      }
      if (battle.producer2?.id && !byId.has(battle.producer2.id)) {
        byId.set(battle.producer2.id, battle.producer2);
      }
    }

    return [...byId.values()].sort((a, b) => b.engagement_score - a.engagement_score);
  }, [battles]);

  const latestBattleRecommendationByBattleId = useMemo(() => {
    const byBattle = new Map<string, AiActionRow>();
    for (const action of aiActions) {
      if (action.entity_type !== 'battle') continue;
      if (action.action_type !== 'battle_validate' && action.action_type !== 'battle_cancel') continue;
      if (!byBattle.has(action.entity_id)) {
        byBattle.set(action.entity_id, action);
      }
    }
    return byBattle;
  }, [aiActions]);

  const latestCommentAiActionByCommentId = useMemo(() => {
    const byComment = new Map<string, AiActionRow>();
    for (const action of aiActions) {
      if (action.entity_type !== 'comment') continue;
      if (action.action_type !== 'comment_moderation') continue;
      if (!byComment.has(action.entity_id)) {
        byComment.set(action.entity_id, action);
      }
    }
    return byComment;
  }, [aiActions]);

  const proposedAiActions = useMemo(
    () => aiActions.filter((action) => action.status === 'proposed'),
    [aiActions]
  );

  const unreadNotificationsCount = useMemo(
    () => notifications.reduce((count, notification) => count + (notification.is_read ? 0 : 1), 0),
    [notifications]
  );

  useEffect(() => {
    onAwaitingAdminCountChange?.(awaitingAdminCount);
  }, [awaitingAdminCount, onAwaitingAdminCountChange]);

  const battleSlugById = useMemo(() => {
    const map = new Map<string, string>();
    for (const battle of battles) {
      map.set(battle.id, battle.slug);
    }
    return map;
  }, [battles]);

  const commentBattleSlugByCommentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const comment of comments) {
      if (comment.battle?.slug) {
        map.set(comment.id, comment.battle.slug);
      }
    }
    return map;
  }, [comments]);

  const markNotificationsReadByActionId = async (actionId: string) => {
    await supabase
      .from('admin_notifications')
      .update({ is_read: true })
      .contains('payload', { action_id: actionId });
  };

  const markNotificationRead = async (notificationId: string) => {
    const { error: updateError } = await supabase
      .from('admin_notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (updateError) {
      console.error('Error marking notification as read:', updateError);
      return;
    }

    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === notificationId ? { ...notification, is_read: true } : notification
      )
    );
  };

  const feedbackForBattleAction = async (
    action: AiActionRow,
    humanDecision: Record<string, unknown>,
    delta: number
  ) => {
    const { error: insertError } = await supabase.from('ai_training_feedback').insert({
      action_id: action.id,
      ai_prediction: action.ai_decision as unknown as Json,
      human_decision: humanDecision as unknown as Json,
      delta,
      created_by: adminContext.userId,
    });

    if (insertError) {
      console.error('Error inserting ai training feedback for battle action:', insertError);
    }
  };

  const evaluateBattleWithAi = async (battleId: string) => {
    setError(null);
    setEvaluatingBattleId(battleId);

    const { error: fnError } = await invokeEdgeWithFreshJwt('ai-evaluate-battle', { battleId });

    if (fnError) {
      console.error('Edge Function ai-evaluate-battle failed:', fnError);
      const message = toEdgeFunctionErrorMessage(fnError, 'ai-evaluate-battle', adminContext.projectRef, t);
      setError(message);
      toast.error(message);
      setEvaluatingBattleId(null);
      return;
    }

    setEvaluatingBattleId(null);
    await loadData();
  };

  const evaluateCommentWithAi = async (commentId: string) => {
    setError(null);
    setEvaluatingCommentId(commentId);

    const { error: fnError } = await invokeEdgeWithFreshJwt('ai-moderate-comment', { commentId });

    if (fnError) {
      console.error('Edge Function ai-moderate-comment failed:', fnError);
      const message = toEdgeFunctionErrorMessage(fnError, 'ai-moderate-comment', adminContext.projectRef, t);
      setError(message);
      toast.error(message);
      setEvaluatingCommentId(null);
      return;
    }

    setEvaluatingCommentId(null);
    await loadData();
  };

  const applyBattleRecommendation = async (action: AiActionRow, mode: 'manual' | 'auto') => {
    const rpcName = action.action_type === 'battle_validate'
      ? 'admin_validate_battle'
      : action.action_type === 'battle_cancel'
      ? 'admin_cancel_battle'
      : null;

    if (!rpcName) {
      setError(t('admin.battles.recommendationNotApplicable'));
      return;
    }

    setError(null);
    setAiActionKey(`${mode}:${action.id}`);

    const { error: rpcError } = await supabase.rpc(rpcName, { p_battle_id: action.entity_id });

    if (rpcError) {
      const nowIso = new Date().toISOString();
      await supabase
        .from('ai_admin_actions')
        .update({
          status: 'failed',
          error: rpcError.message,
          executed_at: nowIso,
          executed_by: mode === 'auto' ? null : adminContext.userId,
        })
        .eq('id', action.id);

      setAiActionKey(null);
      setError(toAdminRpcError(rpcError.message, t));
      await loadData();
      return;
    }

    const executedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('ai_admin_actions')
      .update({
        status: 'executed',
        human_override: false,
        error: null,
        executed_at: executedAt,
        executed_by: mode === 'auto' ? null : adminContext.userId,
      })
      .eq('id', action.id);

    if (updateError) {
      console.error('Error updating AI action after recommendation apply:', updateError);
    }

    await feedbackForBattleAction(
      action,
      {
        decision: mode === 'auto' ? 'auto_execute' : 'manual_apply',
        action_type: action.action_type,
        rpc_name: rpcName,
        entity_id: action.entity_id,
      },
      0
    );

    await markNotificationsReadByActionId(action.id);
    setAiActionKey(null);
    await loadData();
  };

  const rejectBattleRecommendation = async (action: AiActionRow) => {
    setError(null);
    setAiActionKey(`reject:${action.id}`);

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('ai_admin_actions')
      .update({
        status: 'overridden',
        human_override: true,
        executed_at: nowIso,
        executed_by: adminContext.userId,
      })
      .eq('id', action.id);

    if (updateError) {
      console.error('Error overriding AI action:', updateError);
      setAiActionKey(null);
      setError(t('admin.battles.rejectRecommendationError'));
      return;
    }

    await feedbackForBattleAction(
      action,
      {
        decision: 'rejected',
        action_type: action.action_type,
        entity_id: action.entity_id,
      },
      1
    );

    await markNotificationsReadByActionId(action.id);
    setAiActionKey(null);
    await loadData();
  };

  const runBattleRpc = async (
    rpcName: 'admin_validate_battle' | 'admin_cancel_battle' | 'finalize_battle',
    battleId: string
  ) => {
    setError(null);
    setActionKey(`${rpcName}:${battleId}`);

    const { error: rpcError } = await supabase.rpc(rpcName, { p_battle_id: battleId });

    if (rpcError) {
      setError(toAdminRpcError(rpcError.message, t));
      setActionKey(null);
      return;
    }

    setActionKey(null);
    await loadData();
  };

  const extendBattleDuration = async (battleId: string, days: number, reason: string | null) => {
    setError(null);

    if (!Number.isInteger(days) || days < 1 || days > 30) {
      const message = t('admin.battles.rpcInvalidExtensionDays');
      setError(message);
      toast.error(message);
      return;
    }

    const actionId = `extend:${battleId}:${days}`;
    setExtendActionKey(actionId);

    const trimmedReason = (reason ?? '').trim();
    const { error: rpcError } = await supabase.rpc('admin_extend_battle_duration', {
      p_battle_id: battleId,
      p_days: days,
      p_reason: trimmedReason.length > 0 ? trimmedReason : undefined,
    });

    if (rpcError) {
      const message = toAdminRpcError(rpcError.message, t);
      setError(message);
      toast.error(message);
      setExtendActionKey(null);
      return;
    }

    toast.success(t('admin.battles.extendSuccess', { days, suffix: days > 1 ? 's' : '' }));
    setExtendActionKey(null);
    await loadData();
  };

  const toggleCommentModeration = async (comment: AdminCommentRow) => {
    setError(null);
    const nextHidden = !comment.is_hidden;
    const { error: updateError } = await supabase
      .from('battle_comments')
      .update({
        is_hidden: nextHidden,
        hidden_reason: nextHidden ? 'hidden_by_admin' : null,
      })
      .eq('id', comment.id);

    if (updateError) {
      console.error('Error moderating comment:', updateError);
      setError(t('admin.battles.commentModerationError'));
      return;
    }

    const latestCommentAction = latestCommentAiActionByCommentId.get(comment.id);
    if (latestCommentAction) {
      const aiDecision = asRecord(latestCommentAction.ai_decision);
      const suggestedAction = asString(aiDecision.suggested_action);
      const humanAction = nextHidden ? 'hide' : 'allow';
      const isOverride = suggestedAction ? suggestedAction !== humanAction : true;
      const nowIso = new Date().toISOString();

      const { error: feedbackError } = await supabase.from('ai_training_feedback').insert({
        action_id: latestCommentAction.id,
        ai_prediction: latestCommentAction.ai_decision as unknown as Json,
        human_decision: {
          decision: humanAction,
          source: 'admin_comment_toggle',
          comment_id: comment.id,
          override: isOverride,
        } as unknown as Json,
        delta: isOverride ? 1 : 0,
        created_by: adminContext.userId,
      });

      if (feedbackError) {
        console.error('Error inserting comment moderation training feedback:', feedbackError);
      }

      const actionUpdate: Partial<AiActionRow> = {
        executed_at: nowIso,
        executed_by: adminContext.userId,
      };
      if (isOverride) {
        actionUpdate.status = 'overridden';
        actionUpdate.human_override = true;
      } else if (latestCommentAction.status === 'proposed') {
        actionUpdate.status = 'executed';
      }

      const { error: aiUpdateError } = await supabase
        .from('ai_admin_actions')
        .update(actionUpdate as Record<string, unknown>)
        .eq('id', latestCommentAction.id);

      if (aiUpdateError) {
        console.error('Error updating comment AI action after moderation:', aiUpdateError);
      }

      await markNotificationsReadByActionId(latestCommentAction.id);
    }

    await loadData();
  };

  const getNotificationActionId = (notification: AdminNotificationRow) =>
    asString(notification.payload.action_id);

  const getNotificationTargetUrl = (notification: AdminNotificationRow) => {
    const entityType = asString(notification.payload.entity_type);
    const entityId = asString(notification.payload.entity_id);
    if (!entityType || !entityId) return null;

    if (entityType === 'battle') {
      const slug = battleSlugById.get(entityId);
      return slug ? `/battles/${slug}` : null;
    }

    if (entityType === 'comment') {
      const slug = commentBattleSlugByCommentId.get(entityId);
      return slug ? `/battles/${slug}` : null;
    }

    return null;
  };

  const getNotificationLabel = (notification: AdminNotificationRow) => {
    const actionType = asString(notification.payload.action_type);
    const confidence = notification.payload.confidence_score;
    const confidenceLabel = typeof confidence === 'number' ? ` (${Math.round(confidence * 100)}%)` : '';
    return `${toAiActionLabel(actionType, t)}${confidenceLabel}`;
  };

  if (adminContext.isAdmin === null) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (adminContext.isAdmin === false) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-white">{t('errors.forbidden')}</h1>
          <p className="text-zinc-400">{t('admin.battles.accessDeniedBody')}</p>
          <Link to="/battles">
            <Button>{t('common.back')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white inline-flex items-center gap-2">
              <ShieldAlert className="w-6 h-6" />
              {t('admin.battles.title')}
            </h1>
            <p className="text-zinc-400 mt-1">{t('admin.battles.subtitle')}</p>
          </div>
          <Link to="/battles">
            <Button variant="outline">{t('admin.battles.backBattles')}</Button>
          </Link>
        </div>

        {error && (
          <Card className="bg-red-900/20 border border-red-800 text-red-300">
            {error}
          </Card>
        )}

        {import.meta.env.DEV && (
          <Card className="bg-zinc-900/70 border border-zinc-800 text-zinc-300 text-xs space-y-1">
            <p className="text-zinc-200 font-medium">{t('admin.battles.debugTitle')}</p>
            <p>{t('admin.battles.debugProjectRef')}: {adminContext.projectRef || t('common.unknown')}</p>
            <p>{t('admin.battles.debugAuthUid')}: {adminContext.userId || t('common.none')}</p>
            <p>{t('admin.battles.debugProfileRole')}: {adminContext.dbRole || t('common.unknown')}</p>
            <p>{t('admin.battles.debugIsAdmin')}: {adminContext.isAdmin === null ? t('common.unknown') : String(adminContext.isAdmin)}</p>
            {adminContext.error && <p className="text-amber-300">{t('admin.battles.debugContextError')}: {adminContext.error}</p>}
          </Card>
        )}

        <section className="space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-rose-400">{t('admin.battles.emergencies')}</p>
          <AdminPriorityCards
            awaitingAdminCount={awaitingAdminCount}
            expiringCount={expiringSoonBattles.length}
            notificationCount={unreadNotificationsCount}
          />
        </section>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white">{t('admin.battles.expiringSoon')}</h2>
            <Badge variant={expiringSoonBattles.length > 0 ? 'warning' : 'default'}>
              {expiringSoonBattles.length}
            </Badge>
          </div>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : expiringSoonBattles.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('admin.battles.noExpiringSoon')}</p>
          ) : (
            <ul className="space-y-2">
              {expiringSoonBattles.slice(0, 8).map((battle) => (
                <li key={`expiring-${battle.id}`} className="border border-zinc-800 rounded bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-zinc-100 font-medium">{battle.title}</p>
                      <p className="text-xs text-zinc-400">
                        {t('admin.battles.voteEndLabel')}: {formatVotingEnd(battle.voting_ends_at, t)} • {formatTimeRemaining(battle.voting_ends_at, t)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={extendActionKey === `extend:${battle.id}:1`}
                        onClick={() => extendBattleDuration(battle.id, 1, extensionReasonByBattleId[battle.id] ?? null)}
                      >
                        {t('admin.battles.extensionPreset', { days: 1, unit: t('battles.daysShort') })}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={extendActionKey === `extend:${battle.id}:3`}
                        onClick={() => extendBattleDuration(battle.id, 3, extensionReasonByBattleId[battle.id] ?? null)}
                      >
                        {t('admin.battles.extensionPreset', { days: 3, unit: t('battles.daysShort') })}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={extendActionKey === `extend:${battle.id}:7`}
                        onClick={() => extendBattleDuration(battle.id, 7, extensionReasonByBattleId[battle.id] ?? null)}
                      >
                        {t('admin.battles.extensionPreset', { days: 7, unit: t('battles.daysShort') })}
                      </Button>
                      <Link to={`/battles/${battle.slug}`}>
                        <Button size="sm" variant="ghost">{t('common.open')}</Button>
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white">{t('admin.battles.battlesTitle')}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-zinc-500" />
              <Button size="sm" variant={filter === 'all' ? 'primary' : 'outline'} onClick={() => setFilter('all')}>
                {t('common.all')}
              </Button>
              <Button
                size="sm"
                variant={filter === 'pending_acceptance' ? 'primary' : 'outline'}
                onClick={() => setFilter('pending_acceptance')}
              >
                {t('battleDetail.statusPendingAcceptance')}
              </Button>
              <Button
                size="sm"
                variant={filter === 'awaiting_admin' ? 'primary' : 'outline'}
                onClick={() => setFilter('awaiting_admin')}
              >
                {t('battleDetail.statusAwaitingAdmin')}
              </Button>
              <Button
                size="sm"
                variant={filter === 'rejected' ? 'primary' : 'outline'}
                onClick={() => setFilter('rejected')}
              >
                {t('battleDetail.statusRejected')}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : visibleBattles.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('admin.battles.noBattleForFilter')}</p>
          ) : (
            <ul className="space-y-3">
              {visibleBattles.map((battle) => {
                const latestRecommendation = latestBattleRecommendationByBattleId.get(battle.id);
                const recommendationDecision = latestRecommendation ? asRecord(latestRecommendation.ai_decision) : {};
                const recommendationAction = latestRecommendation
                  ? toAiActionLabel(latestRecommendation.action_type, t)
                  : null;
                const recommendationReason = asString(recommendationDecision.reason)
                  || asString(recommendationDecision.reasons);
                const customExtensionInput = extensionDaysByBattleId[battle.id] ?? '';
                const parsedCustomExtensionDays = Number.parseInt(customExtensionInput, 10);
                const hasValidCustomExtension = Number.isInteger(parsedCustomExtensionDays)
                  && parsedCustomExtensionDays >= 1
                  && parsedCustomExtensionDays <= 30;

                return (
                <li key={battle.id} className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-4 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-white font-semibold">{battle.title}</p>
                      <p className="text-sm text-zinc-400">
                        {battle.producer1?.username || t('battleDetail.notAssigned')} {t('battles.vs')} {battle.producer2?.username || t('battleDetail.notAssigned')}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t('battles.votes')}: {battle.votes_producer1} - {battle.votes_producer2}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t('admin.battles.voteEndLabel')}: {formatVotingEnd(battle.voting_ends_at, t)}
                        {battle.voting_ends_at ? ` • ${formatTimeRemaining(battle.voting_ends_at, t)}` : ''}
                      </p>
                      {battle.custom_duration_days !== null && (
                        <p className="text-xs text-zinc-500">
                          {t('admin.battles.customDuration', { days: battle.custom_duration_days })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center flex-wrap gap-2">
                      <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status, t)}</Badge>

                      {battle.status === 'awaiting_admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionKey === `admin_validate_battle:${battle.id}`}
                          onClick={() => runBattleRpc('admin_validate_battle', battle.id)}
                        >
                          {t('admin.battles.validate')}
                        </Button>
                      )}

                      {battle.status !== 'cancelled' && battle.status !== 'completed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionKey === `admin_cancel_battle:${battle.id}`}
                          onClick={() => runBattleRpc('admin_cancel_battle', battle.id)}
                        >
                          {t('common.cancel')}
                        </Button>
                      )}

                      {(battle.status === 'active' || battle.status === 'voting') && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionKey === `finalize_battle:${battle.id}`}
                          onClick={() => runBattleRpc('finalize_battle', battle.id)}
                        >
                          {t('admin.battles.forceClose')}
                        </Button>
                      )}

                      {battle.producer2?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedProducerId(battle.producer2?.id || null)}
                        >
                          {t('admin.battles.viewRefusals')}
                        </Button>
                      )}

                      {battle.producer2?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedProducerId(battle.producer2?.id || null)}
                        >
                          {t('admin.battles.viewScore')}
                        </Button>
                      )}

                      <Link to={`/battles/${battle.slug}`}>
                        <Button size="sm" variant="ghost">{t('common.open')}</Button>
                      </Link>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded border border-zinc-800 p-3 bg-zinc-900/60">
                      <p className="text-zinc-400">{t('admin.battles.producer2Refusals')}</p>
                      <p className="text-white font-semibold">{battle.producer2?.battle_refusal_count ?? 0}</p>
                    </div>
                    <div className="rounded border border-zinc-800 p-3 bg-zinc-900/60">
                      <p className="text-zinc-400">{t('admin.battles.producer2EngagementScore')}</p>
                      <p className="text-white font-semibold">{battle.producer2?.engagement_score ?? 0}</p>
                    </div>
                  </div>

                  {battle.status === 'awaiting_admin' && (
                    <div className="rounded border border-sky-900 bg-sky-950/30 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-sm text-sky-200 font-medium">{t('admin.battles.aiRecommendation')}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={evaluatingBattleId === battle.id}
                          onClick={() => evaluateBattleWithAi(battle.id)}
                        >
                          {t('admin.battles.analyzeAi')}
                        </Button>
                      </div>

                      {latestRecommendation ? (
                        <div className="space-y-2">
                          <p className="text-sm text-zinc-200">
                            {t('admin.battles.suggestion')}: <span className="font-semibold">{recommendationAction}</span>
                            {latestRecommendation.confidence_score !== null && (
                              <span className="text-zinc-400"> ({Math.round(latestRecommendation.confidence_score * 100)}%)</span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {t('admin.battles.actionStatus')}: {toAiStatusLabel(latestRecommendation.status, t)} • {formatDateTime(latestRecommendation.created_at)}
                          </p>
                          {recommendationReason && (
                            <p className="text-xs text-zinc-400">{t('admin.battles.reason')}: {recommendationReason}</p>
                          )}

                          {latestRecommendation.status === 'proposed' && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                isLoading={aiActionKey === `manual:${latestRecommendation.id}`}
                                onClick={() => applyBattleRecommendation(latestRecommendation, 'manual')}
                              >
                                {t('admin.battles.apply')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                isLoading={aiActionKey === `reject:${latestRecommendation.id}`}
                                onClick={() => rejectBattleRecommendation(latestRecommendation)}
                              >
                                {t('admin.battles.reject')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={(latestRecommendation.confidence_score ?? 0) < 0.98}
                                isLoading={aiActionKey === `auto:${latestRecommendation.id}`}
                                onClick={() => applyBattleRecommendation(latestRecommendation, 'auto')}
                              >
                                {t('admin.battles.letAiDecide')}
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-400">{t('admin.battles.noAiRecommendation')}</p>
                      )}
                    </div>
                  )}

                  {(battle.status === 'active' || battle.status === 'voting') && (
                    <div className="rounded border border-emerald-900 bg-emerald-950/20 p-3 space-y-3">
                      <p className="text-sm text-emerald-200 font-medium">{t('admin.battles.voteDurationExtension')}</p>
                      <p className="text-xs text-zinc-400">
                        {t('admin.battles.currentVoteEnd')}: {formatVotingEnd(battle.voting_ends_at, t)} • {formatTimeRemaining(battle.voting_ends_at, t)}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={extendActionKey === `extend:${battle.id}:1`}
                          onClick={() => extendBattleDuration(battle.id, 1, extensionReasonByBattleId[battle.id] ?? null)}
                        >
                          {t('admin.battles.extensionPreset', { days: 1, unit: t('battles.daysShort') })}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={extendActionKey === `extend:${battle.id}:3`}
                          onClick={() => extendBattleDuration(battle.id, 3, extensionReasonByBattleId[battle.id] ?? null)}
                        >
                          {t('admin.battles.extensionPreset', { days: 3, unit: t('battles.daysShort') })}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={extendActionKey === `extend:${battle.id}:7`}
                          onClick={() => extendBattleDuration(battle.id, 7, extensionReasonByBattleId[battle.id] ?? null)}
                        >
                          {t('admin.battles.extensionPreset', { days: 7, unit: t('battles.daysShort') })}
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={customExtensionInput}
                          onChange={(event) =>
                            setExtensionDaysByBattleId((prev) => ({ ...prev, [battle.id]: event.target.value }))
                          }
                          placeholder={t('admin.battles.daysPlaceholder')}
                          className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        />
                        <input
                          type="text"
                          value={extensionReasonByBattleId[battle.id] ?? ''}
                          onChange={(event) =>
                            setExtensionReasonByBattleId((prev) => ({ ...prev, [battle.id]: event.target.value }))
                          }
                          placeholder={t('admin.battles.reasonPlaceholder')}
                          className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!hasValidCustomExtension}
                          isLoading={hasValidCustomExtension && extendActionKey === `extend:${battle.id}:${parsedCustomExtensionDays}`}
                          onClick={() => {
                            if (!hasValidCustomExtension) return;
                            void extendBattleDuration(
                              battle.id,
                              parsedCustomExtensionDays,
                              extensionReasonByBattleId[battle.id] ?? null
                            );
                          }}
                        >
                          {t('admin.battles.extend')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {battle.status === 'rejected' && battle.rejection_reason && (
                    <p className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                      {t('producerBattles.rejectionReasonPrefix', { reason: battle.rejection_reason })}
                    </p>
                  )}
                </li>
              );
              })}
            </ul>
          )}

          {!isLoading && hasMoreBattles && (
            <div className="flex justify-center pt-1">
              <Button
                size="sm"
                variant="outline"
                isLoading={isLoadingMoreBattles}
                onClick={() => void loadMoreBattles()}
              >
                {t('admin.battles.loadMore')}
              </Button>
            </div>
          )}
        </Card>

        <section className="space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-rose-400">{t('admin.battles.moderation')}</p>
        </section>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white">{t('admin.battles.aiNotifications')}</h2>
            <Badge variant={unreadNotificationsCount > 0 ? 'warning' : 'default'}>
              {t('admin.battles.unreadCount', { count: unreadNotificationsCount })}
            </Badge>
          </div>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : notifications.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('admin.battles.noNotifications')}</p>
          ) : (
            <ul className="space-y-2">
              {notifications.slice(0, 8).map((notification) => {
                const targetUrl = getNotificationTargetUrl(notification);
                const linkedActionId = getNotificationActionId(notification);

                return (
                  <li key={notification.id} className="border border-zinc-800 rounded bg-zinc-900/60 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-zinc-200 font-medium">
                          {getNotificationLabel(notification)}
                          {!notification.is_read && <span className="text-amber-300"> • {t('admin.battles.newBadge')}</span>}
                        </p>
                        <p className="text-zinc-500 text-xs">{formatDateTime(notification.created_at)}</p>
                        {targetUrl && (
                          <Link to={targetUrl} className="text-xs text-sky-300 hover:text-sky-200 inline-block mt-1">
                            {t('admin.battles.openTarget')}
                          </Link>
                        )}
                        {linkedActionId && (
                          <p className="text-zinc-500 text-xs mt-1">{t('common.action')}: {linkedActionId}</p>
                        )}
                      </div>
                      {!notification.is_read && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markNotificationRead(notification.id)}
                        >
                          {t('admin.battles.markRead')}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-white">{t('admin.battles.aiInbox')}</h2>
          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : proposedAiActions.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('admin.battles.noPendingAiActions')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {proposedAiActions.slice(0, 10).map((action) => (
                <li key={action.id} className="border border-zinc-800 rounded p-2 bg-zinc-900/40">
                  <p className="text-zinc-200">
                    {toAiActionLabel(action.action_type, t)} • {toAiEntityLabel(action.entity_type, t)}: {action.entity_id}
                  </p>
                  <p className="text-zinc-500 text-xs">
                    {action.confidence_score !== null ? t('admin.battles.confidence', { value: Math.round(action.confidence_score * 100) }) : t('admin.battles.confidenceNotAvailable')} • {formatDateTime(action.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">{t('battles.comments')}</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : comments.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('battles.noComments')}</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((comment) => {
                const latestAction = latestCommentAiActionByCommentId.get(comment.id);
                const aiDecision = latestAction ? asRecord(latestAction.ai_decision) : {};
                const aiClassification = asString(aiDecision.classification);

                return (
                <li key={comment.id} className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-4 space-y-2">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="text-sm text-zinc-300">
                        {comment.user?.username || t('user.profile')} {t('admin.battles.onBattle')} {comment.battle?.title || comment.battle_id}
                      </p>
                      <p className="text-xs text-zinc-500">{formatDateTime(comment.created_at)}</p>
                      {latestAction && (
                        <p className="text-xs text-zinc-500 mt-1">
                          {t('admin.battles.aiShort')}: {aiClassification || t('common.notAvailable')} • {toAiStatusLabel(latestAction.status, t)}
                          {latestAction.confidence_score !== null && ` • ${Math.round(latestAction.confidence_score * 100)}%`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={evaluatingCommentId === comment.id}
                        onClick={() => evaluateCommentWithAi(comment.id)}
                      >
                        {t('admin.battles.analyzeAi')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleCommentModeration(comment)}>
                        {comment.is_hidden ? t('admin.forum.restore') : t('admin.forum.hide')}
                      </Button>
                    </div>
                  </div>

                  <p className={`text-sm ${comment.is_hidden ? 'text-zinc-500 italic' : 'text-zinc-200'}`}>
                    {comment.is_hidden
                      ? t('admin.battles.hiddenComment', {
                          reason: comment.hidden_reason === 'hidden_by_admin'
                            ? t('admin.battles.hiddenByAdminReason')
                            : (comment.hidden_reason || t('admin.battles.hiddenByAdminReason')),
                        })
                      : comment.content}
                  </p>
                </li>
              );
              })}
            </ul>
          )}
        </Card>

        <section className="space-y-3">
          <p className="text-xs uppercase tracking-[0.14em] text-rose-400">{t('admin.battles.analysis')}</p>
        </section>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">{t('admin.battles.rejectionHistory')}</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : rejectionHistory.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('admin.battles.noRejections')}</p>
          ) : (
            <ul className="space-y-3">
              {rejectionHistory
                .filter((battle) => !selectedProducerId || battle.producer2?.id === selectedProducerId)
                .map((battle) => (
                  <li key={`rejection-${battle.id}`} className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                    <p className="text-sm text-white font-medium">{battle.title}</p>
                    <p className="text-xs text-zinc-400">
                      {battle.producer2?.username || t('nav.producers')} - {battle.rejected_at ? formatDateTime(battle.rejected_at) : t('common.unknown')}
                    </p>
                    <p className="text-sm text-red-300 mt-1">{battle.rejection_reason}</p>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">{t('admin.battles.engagementScores')}</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : engagementRows.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('admin.battles.noScores')}</p>
          ) : (
            <ul className="space-y-2">
              {engagementRows.map((producer) => (
                <li
                  key={producer.id}
                  className={`border rounded-lg p-3 text-sm ${
                    selectedProducerId === producer.id
                      ? 'border-rose-500 bg-rose-500/10'
                      : 'border-zinc-800 bg-zinc-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-white font-medium">{producer.username || producer.id}</p>
                    <p className="text-zinc-300">{t('admin.battles.scoreLabel', { score: producer.engagement_score })}</p>
                  </div>
                  <p className="text-zinc-500 mt-1">
                    {t('admin.battles.producerStats', {
                      refusals: producer.battle_refusal_count,
                      participated: producer.battles_participated,
                      completed: producer.battles_completed,
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

      </div>
    </div>
  );
}
