import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { supabase } from '../lib/supabase/client';
import type { BattleStatus } from '../lib/supabase/types';

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

function toStatusLabel(status: BattleStatus) {
  if (status === 'pending_acceptance') return 'En attente de reponse';
  if (status === 'awaiting_admin') return 'En attente validation admin';
  if (status === 'rejected') return 'Refusee';
  if (status === 'active') return 'Active';
  if (status === 'voting') return 'Voting (legacy)';
  if (status === 'completed') return 'Terminee';
  if (status === 'cancelled') return 'Annulee';
  if (status === 'approved') return 'Approuvee';
  return 'Pending';
}

function toAdminRpcError(message: string) {
  if (message.includes('admin_required')) return 'Action reservee a un administrateur.';
  if (message.includes('battle_not_found')) return 'Battle introuvable.';
  if (message.includes('battle_not_waiting_admin_validation')) return 'Battle non eligible a la validation admin.';
  if (message.includes('cannot_cancel_completed_battle')) return 'Une battle terminee ne peut pas etre annulee.';
  if (message.includes('battle_cancelled')) return 'Cette battle est deja annulee.';
  if (message.includes('battle_not_open_for_finalization')) return 'Battle non eligible a la cloture.';
  if (message.includes('invalid_extension_days')) return 'Extension invalide (1 a 30 jours).';
  if (message.includes('battle_not_open_for_extension')) return 'Battle non eligible a une extension.';
  if (message.includes('battle_has_no_voting_end')) return 'Cette battle n\'a pas de fin de vote definie.';
  if (message.includes('battle_already_expired')) return 'La battle est deja expiree.';
  if (message.includes('battle_extension_limit_exceeded')) return 'Limite max de duree depassee (60 jours).';
  if (message.includes('maximum_extensions_reached')) return 'Nombre maximal d\'extensions atteint (5).';
  return 'Action admin impossible pour le moment.';
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
  projectRef: string | null
) {
  const fallbackMessage = error instanceof Error ? error.message : 'unknown_edge_function_error';
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
  const status = getEdgeFunctionHttpStatus(error);
  const projectRefHint = projectRef || 'unknown_project_ref';

  if (status === 404) {
    return `Fonction "${functionName}" non deployee (404) sur ${projectRefHint}.`;
  }

  if (status === 401) {
    return `Session invalide/expiree pour "${functionName}" (401). Reconnecte-toi puis reessaye.`;
  }

  if (status === 403) {
    return `Acces refuse a "${functionName}" (403). Compte admin requis.`;
  }

  if (status !== null && status >= 500) {
    return `Erreur serveur "${functionName}" (${status}). Verifie logs Edge Function et secrets Supabase.`;
  }

  if (
    name === 'FunctionsFetchError'
    || fallbackMessage.includes('Failed to send a request to the Edge Function')
    || fallbackMessage.includes('Failed to fetch')
  ) {
    return `Impossible de joindre "${functionName}" (network/CORS/URL). Verifie VITE_SUPABASE_URL et le deploy sur ${projectRefHint}.`;
  }

  if (name === 'FunctionsRelayError') {
    return `Relai Supabase en erreur pour "${functionName}". Reessaye puis verifie la sante du projet ${projectRefHint}.`;
  }

  if (name === 'FunctionsHttpError' && status !== null) {
    return `Erreur HTTP ${status} sur "${functionName}".`;
  }

  return `Erreur "${functionName}": ${fallbackMessage}`;
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

function formatVotingEnd(value: string | null) {
  if (!value) return 'Non definie';
  return new Date(value).toLocaleString();
}

function formatTimeRemaining(value: string | null) {
  if (!value) return 'N/A';
  const endMs = new Date(value).getTime();
  if (!Number.isFinite(endMs)) return 'N/A';
  const diff = endMs - Date.now();
  if (diff <= 0) return 'Expiree';

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function AdminBattlesPage() {
  const [battles, setBattles] = useState<AdminBattleRow[]>([]);
  const [comments, setComments] = useState<AdminCommentRow[]>([]);
  const [aiActions, setAiActions] = useState<AiActionRow[]>([]);
  const [notifications, setNotifications] = useState<AdminNotificationRow[]>([]);
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
        .limit(200),
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
      setError('Impossible de charger les battles admin.');
      setBattles([]);
    } else {
      setBattles((battlesRes.data as AdminBattleRow[] | null) ?? []);
    }

    if (commentsRes.error) {
      console.error('Error loading admin comments:', commentsRes.error);
      setComments([]);
      if (!battlesRes.error) {
        setError('Impossible de charger les commentaires admin.');
      }
    } else {
      setComments((commentsRes.data as AdminCommentRow[] | null) ?? []);
    }

    if (aiActionsRes.error) {
      console.error('Error loading ai admin actions:', aiActionsRes.error);
      setAiActions([]);
      if (!battlesRes.error && !commentsRes.error) {
        setError('Impossible de charger les actions IA.');
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
        setError('Impossible de charger les notifications admin.');
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
  }, []);

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
    void loadData();
    void loadAdminContext();
  }, [loadAdminContext, loadData]);

  const visibleBattles = useMemo(() => {
    if (filter === 'all') return battles;
    return battles.filter((battle) => battle.status === filter);
  }, [battles, filter]);

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
      ai_prediction: action.ai_decision,
      human_decision: humanDecision,
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
      const message = toEdgeFunctionErrorMessage(fnError, 'ai-evaluate-battle', adminContext.projectRef);
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
      const message = toEdgeFunctionErrorMessage(fnError, 'ai-moderate-comment', adminContext.projectRef);
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
      setError('Recommandation IA non applicable.');
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
      setError(toAdminRpcError(rpcError.message));
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
      setError('Impossible de refuser la recommandation IA.');
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
      setError(toAdminRpcError(rpcError.message));
      setActionKey(null);
      return;
    }

    setActionKey(null);
    await loadData();
  };

  const extendBattleDuration = async (battleId: string, days: number, reason: string | null) => {
    setError(null);

    if (!Number.isInteger(days) || days < 1 || days > 30) {
      const message = 'Extension invalide (1 a 30 jours).';
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
      p_reason: trimmedReason.length > 0 ? trimmedReason : null,
    });

    if (rpcError) {
      const message = toAdminRpcError(rpcError.message);
      setError(message);
      toast.error(message);
      setExtendActionKey(null);
      return;
    }

    toast.success(`Duree etendue de ${days} jour${days > 1 ? 's' : ''}.`);
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
      setError('Moderation commentaire impossible.');
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
        ai_prediction: latestCommentAction.ai_decision,
        human_decision: {
          decision: humanAction,
          source: 'admin_comment_toggle',
          comment_id: comment.id,
          override: isOverride,
        },
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
        .update(actionUpdate)
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
    const actionType = asString(notification.payload.action_type) || 'ai_action';
    const confidence = notification.payload.confidence_score;
    const confidenceLabel = typeof confidence === 'number' ? ` (${Math.round(confidence * 100)}%)` : '';
    return `${actionType}${confidenceLabel}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white inline-flex items-center gap-2">
              <ShieldAlert className="w-6 h-6" />
              Admin Battles
            </h1>
            <p className="text-zinc-400 mt-1">Validation, moderation, refus et score d'engagement.</p>
          </div>
          <Link to="/battles">
            <Button variant="outline">Retour Battles</Button>
          </Link>
        </div>

        {error && (
          <Card className="bg-red-900/20 border border-red-800 text-red-300">
            {error}
          </Card>
        )}

        {adminContext.isAdmin === false && (
          <Card className="bg-amber-900/20 border border-amber-800 text-amber-300">
            Compte connecte non admin sur cette base. role={adminContext.dbRole || 'unknown'} uid={adminContext.userId || 'none'}
          </Card>
        )}

        {import.meta.env.DEV && (
          <Card className="bg-zinc-900/70 border border-zinc-800 text-zinc-300 text-xs space-y-1">
            <p className="text-zinc-200 font-medium">Debug Admin Context</p>
            <p>project_ref: {adminContext.projectRef || 'unknown'}</p>
            <p>auth_uid: {adminContext.userId || 'none'}</p>
            <p>profile_role: {adminContext.dbRole || 'unknown'}</p>
            <p>is_admin(): {adminContext.isAdmin === null ? 'unknown' : String(adminContext.isAdmin)}</p>
            {adminContext.error && <p className="text-amber-300">context_error: {adminContext.error}</p>}
          </Card>
        )}

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white">Notifications IA</h2>
            <Badge variant={unreadNotificationsCount > 0 ? 'warning' : 'default'}>
              {unreadNotificationsCount} non lues
            </Badge>
          </div>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : notifications.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucune notification admin.</p>
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
                          {!notification.is_read && <span className="text-amber-300"> • NEW</span>}
                        </p>
                        <p className="text-zinc-500 text-xs">{new Date(notification.created_at).toLocaleString()}</p>
                        {targetUrl && (
                          <Link to={targetUrl} className="text-xs text-sky-300 hover:text-sky-200 inline-block mt-1">
                            Ouvrir la cible
                          </Link>
                        )}
                        {linkedActionId && (
                          <p className="text-zinc-500 text-xs mt-1">Action: {linkedActionId}</p>
                        )}
                      </div>
                      {!notification.is_read && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markNotificationRead(notification.id)}
                        >
                          Marquer lu
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
          <h2 className="text-lg font-semibold text-white">AI Inbox</h2>
          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : proposedAiActions.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucune action IA en attente.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {proposedAiActions.slice(0, 10).map((action) => (
                <li key={action.id} className="border border-zinc-800 rounded p-2 bg-zinc-900/40">
                  <p className="text-zinc-200">
                    {action.action_type} • {action.entity_type}:{action.entity_id}
                  </p>
                  <p className="text-zinc-500 text-xs">
                    {action.confidence_score !== null ? `Confiance ${Math.round(action.confidence_score * 100)}%` : 'Confiance n/a'} • {new Date(action.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white">Expiring Soon (24h)</h2>
            <Badge variant={expiringSoonBattles.length > 0 ? 'warning' : 'default'}>
              {expiringSoonBattles.length}
            </Badge>
          </div>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : expiringSoonBattles.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucune battle proche de l'expiration.</p>
          ) : (
            <ul className="space-y-2">
              {expiringSoonBattles.slice(0, 8).map((battle) => (
                <li key={`expiring-${battle.id}`} className="border border-zinc-800 rounded bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-zinc-100 font-medium">{battle.title}</p>
                      <p className="text-xs text-zinc-400">
                        Fin vote: {formatVotingEnd(battle.voting_ends_at)} • {formatTimeRemaining(battle.voting_ends_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={extendActionKey === `extend:${battle.id}:1`}
                        onClick={() => extendBattleDuration(battle.id, 1, extensionReasonByBattleId[battle.id] ?? null)}
                      >
                        +1j
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={extendActionKey === `extend:${battle.id}:3`}
                        onClick={() => extendBattleDuration(battle.id, 3, extensionReasonByBattleId[battle.id] ?? null)}
                      >
                        +3j
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={extendActionKey === `extend:${battle.id}:7`}
                        onClick={() => extendBattleDuration(battle.id, 7, extensionReasonByBattleId[battle.id] ?? null)}
                      >
                        +7j
                      </Button>
                      <Link to={`/battles/${battle.slug}`}>
                        <Button size="sm" variant="ghost">Ouvrir</Button>
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
            <h2 className="text-lg font-semibold text-white">Battles</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-zinc-500" />
              <Button size="sm" variant={filter === 'all' ? 'primary' : 'outline'} onClick={() => setFilter('all')}>
                Toutes
              </Button>
              <Button
                size="sm"
                variant={filter === 'pending_acceptance' ? 'primary' : 'outline'}
                onClick={() => setFilter('pending_acceptance')}
              >
                pending_acceptance
              </Button>
              <Button
                size="sm"
                variant={filter === 'awaiting_admin' ? 'primary' : 'outline'}
                onClick={() => setFilter('awaiting_admin')}
              >
                awaiting_admin
              </Button>
              <Button
                size="sm"
                variant={filter === 'rejected' ? 'primary' : 'outline'}
                onClick={() => setFilter('rejected')}
              >
                rejected
              </Button>
            </div>
          </div>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : visibleBattles.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucune battle sur ce filtre.</p>
          ) : (
            <ul className="space-y-3">
              {visibleBattles.map((battle) => {
                const latestRecommendation = latestBattleRecommendationByBattleId.get(battle.id);
                const recommendationDecision = latestRecommendation ? asRecord(latestRecommendation.ai_decision) : {};
                const recommendationAction = latestRecommendation?.action_type === 'battle_cancel'
                  ? 'Annuler'
                  : latestRecommendation?.action_type === 'battle_validate'
                  ? 'Valider'
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
                        {battle.producer1?.username || 'P1'} vs {battle.producer2?.username || 'P2'}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Votes: {battle.votes_producer1} - {battle.votes_producer2}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Fin vote: {formatVotingEnd(battle.voting_ends_at)}
                        {battle.voting_ends_at ? ` • ${formatTimeRemaining(battle.voting_ends_at)}` : ''}
                      </p>
                      {battle.custom_duration_days !== null && (
                        <p className="text-xs text-zinc-500">
                          Duree custom: {battle.custom_duration_days} jour{battle.custom_duration_days > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center flex-wrap gap-2">
                      <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status)}</Badge>

                      {battle.status === 'awaiting_admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionKey === `admin_validate_battle:${battle.id}`}
                          onClick={() => runBattleRpc('admin_validate_battle', battle.id)}
                        >
                          Valider
                        </Button>
                      )}

                      {battle.status !== 'cancelled' && battle.status !== 'completed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionKey === `admin_cancel_battle:${battle.id}`}
                          onClick={() => runBattleRpc('admin_cancel_battle', battle.id)}
                        >
                          Annuler
                        </Button>
                      )}

                      {(battle.status === 'active' || battle.status === 'voting') && (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={actionKey === `finalize_battle:${battle.id}`}
                          onClick={() => runBattleRpc('finalize_battle', battle.id)}
                        >
                          Forcer cloture
                        </Button>
                      )}

                      {battle.producer2?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedProducerId(battle.producer2?.id || null)}
                        >
                          Voir refus
                        </Button>
                      )}

                      {battle.producer2?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedProducerId(battle.producer2?.id || null)}
                        >
                          Voir score
                        </Button>
                      )}

                      <Link to={`/battles/${battle.slug}`}>
                        <Button size="sm" variant="ghost">Ouvrir</Button>
                      </Link>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded border border-zinc-800 p-3 bg-zinc-900/60">
                      <p className="text-zinc-400">Producer2 refus</p>
                      <p className="text-white font-semibold">{battle.producer2?.battle_refusal_count ?? 0}</p>
                    </div>
                    <div className="rounded border border-zinc-800 p-3 bg-zinc-900/60">
                      <p className="text-zinc-400">Score engagement Producer2</p>
                      <p className="text-white font-semibold">{battle.producer2?.engagement_score ?? 0}</p>
                    </div>
                  </div>

                  {battle.status === 'awaiting_admin' && (
                    <div className="rounded border border-sky-900 bg-sky-950/30 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-sm text-sky-200 font-medium">Recommandation IA</p>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={evaluatingBattleId === battle.id}
                          onClick={() => evaluateBattleWithAi(battle.id)}
                        >
                          Analyser IA
                        </Button>
                      </div>

                      {latestRecommendation ? (
                        <div className="space-y-2">
                          <p className="text-sm text-zinc-200">
                            Suggestion: <span className="font-semibold">{recommendationAction || latestRecommendation.action_type}</span>
                            {latestRecommendation.confidence_score !== null && (
                              <span className="text-zinc-400"> ({Math.round(latestRecommendation.confidence_score * 100)}%)</span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500">
                            Status action: {latestRecommendation.status} • {new Date(latestRecommendation.created_at).toLocaleString()}
                          </p>
                          {recommendationReason && (
                            <p className="text-xs text-zinc-400">Raison: {recommendationReason}</p>
                          )}

                          {latestRecommendation.status === 'proposed' && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                isLoading={aiActionKey === `manual:${latestRecommendation.id}`}
                                onClick={() => applyBattleRecommendation(latestRecommendation, 'manual')}
                              >
                                Appliquer
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                isLoading={aiActionKey === `reject:${latestRecommendation.id}`}
                                onClick={() => rejectBattleRecommendation(latestRecommendation)}
                              >
                                Refuser
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={(latestRecommendation.confidence_score ?? 0) < 0.98}
                                isLoading={aiActionKey === `auto:${latestRecommendation.id}`}
                                onClick={() => applyBattleRecommendation(latestRecommendation, 'auto')}
                              >
                                Laisser l'IA decider
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-400">Aucune recommandation IA pour cette battle.</p>
                      )}
                    </div>
                  )}

                  {(battle.status === 'active' || battle.status === 'voting') && (
                    <div className="rounded border border-emerald-900 bg-emerald-950/20 p-3 space-y-3">
                      <p className="text-sm text-emerald-200 font-medium">Extension duree de vote</p>
                      <p className="text-xs text-zinc-400">
                        Fin actuelle: {formatVotingEnd(battle.voting_ends_at)} • {formatTimeRemaining(battle.voting_ends_at)}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={extendActionKey === `extend:${battle.id}:1`}
                          onClick={() => extendBattleDuration(battle.id, 1, extensionReasonByBattleId[battle.id] ?? null)}
                        >
                          +1j
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={extendActionKey === `extend:${battle.id}:3`}
                          onClick={() => extendBattleDuration(battle.id, 3, extensionReasonByBattleId[battle.id] ?? null)}
                        >
                          +3j
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={extendActionKey === `extend:${battle.id}:7`}
                          onClick={() => extendBattleDuration(battle.id, 7, extensionReasonByBattleId[battle.id] ?? null)}
                        >
                          +7j
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
                          placeholder="Jours (1-30)"
                          className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        />
                        <input
                          type="text"
                          value={extensionReasonByBattleId[battle.id] ?? ''}
                          onChange={(event) =>
                            setExtensionReasonByBattleId((prev) => ({ ...prev, [battle.id]: event.target.value }))
                          }
                          placeholder="Raison (optionnelle)"
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
                          Etendre
                        </Button>
                      </div>
                    </div>
                  )}

                  {battle.status === 'rejected' && battle.rejection_reason && (
                    <p className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                      Motif du refus: {battle.rejection_reason}
                    </p>
                  )}
                </li>
              );
              })}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Historique des refus</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : rejectionHistory.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucun refus enregistre.</p>
          ) : (
            <ul className="space-y-3">
              {rejectionHistory
                .filter((battle) => !selectedProducerId || battle.producer2?.id === selectedProducerId)
                .map((battle) => (
                  <li key={`rejection-${battle.id}`} className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                    <p className="text-sm text-white font-medium">{battle.title}</p>
                    <p className="text-xs text-zinc-400">
                      {battle.producer2?.username || 'Producteur'} - {battle.rejected_at ? new Date(battle.rejected_at).toLocaleString() : 'date inconnue'}
                    </p>
                    <p className="text-sm text-red-300 mt-1">{battle.rejection_reason}</p>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Scores engagement producteurs</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : engagementRows.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucun score disponible.</p>
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
                    <p className="text-zinc-300">Score: {producer.engagement_score}</p>
                  </div>
                  <p className="text-zinc-500 mt-1">
                    Refus: {producer.battle_refusal_count} | Participations: {producer.battles_participated} | Completees: {producer.battles_completed}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Commentaires</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">Chargement...</p>
          ) : comments.length === 0 ? (
            <p className="text-zinc-500 text-sm">Aucun commentaire.</p>
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
                        {comment.user?.username || 'Utilisateur'} sur {comment.battle?.title || comment.battle_id}
                      </p>
                      <p className="text-xs text-zinc-500">{new Date(comment.created_at).toLocaleString()}</p>
                      {latestAction && (
                        <p className="text-xs text-zinc-500 mt-1">
                          IA: {aiClassification || 'n/a'} • {latestAction.status}
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
                        Analyser IA
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleCommentModeration(comment)}>
                        {comment.is_hidden ? 'Restaurer' : 'Masquer'}
                      </Button>
                    </div>
                  </div>

                  <p className={`text-sm ${comment.is_hidden ? 'text-zinc-500 italic' : 'text-zinc-200'}`}>
                    {comment.is_hidden ? `Commentaire masque (${comment.hidden_reason || 'admin'}).` : comment.content}
                  </p>
                </li>
              );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
