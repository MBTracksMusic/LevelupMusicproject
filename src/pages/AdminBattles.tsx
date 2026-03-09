import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { BattleAudioPlayer } from '../components/audio/BattleAudioPlayer';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LogoLoader } from '../components/ui/LogoLoader';
import { AdminPriorityCards } from '../components/admin/AdminPriorityCards';
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { BattleStatus } from '../lib/supabase/types';
import type { Json } from '../lib/supabase/database.types';
import { formatDateTime, slugify } from '../lib/utils/format';

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

type AdminBattleCampaignStatus = 'applications_open' | 'selection_locked' | 'launched' | 'cancelled';
type AdminBattleApplicationStatus = 'pending' | 'selected' | 'rejected';

interface AdminBattleCampaignRow {
  id: string;
  title: string;
  description: string | null;
  social_description: string | null;
  cover_image_url: string | null;
  share_slug: string | null;
  status: AdminBattleCampaignStatus;
  participation_deadline: string;
  submission_deadline: string;
  selected_producer1_id: string | null;
  selected_producer2_id: string | null;
  battle_id: string | null;
  created_by: string | null;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminBattleApplicationRow {
  id: string;
  campaign_id: string;
  producer_id: string;
  message: string | null;
  proposed_product_id: string | null;
  admin_feedback: string | null;
  admin_feedback_at: string | null;
  status: AdminBattleApplicationStatus;
  created_at: string;
  updated_at: string;
}

interface CampaignProducerRow {
  id: string;
  username: string | null;
}

interface CampaignProductRow {
  id: string;
  title: string;
  producer_id: string | null;
  product_type: string | null;
  status: string | null;
  is_published: boolean | null;
  deleted_at: string | null;
  preview_url: string | null;
  watermarked_path: string | null;
  exclusive_preview_url: string | null;
  watermarked_bucket: string | null;
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
const CAMPAIGN_IMAGES_BUCKET = 'battle-campaign-images';

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

const campaignStatusBadgeVariant: Record<AdminBattleCampaignStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  applications_open: 'warning',
  selection_locked: 'info',
  launched: 'success',
  cancelled: 'danger',
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

function toCampaignStatusLabel(status: AdminBattleCampaignStatus) {
  if (status === 'applications_open') return 'Applications open';
  if (status === 'selection_locked') return 'Selection locked';
  if (status === 'launched') return 'Launched';
  return 'Cancelled';
}

function toCampaignRpcErrorMessage(message: string) {
  if (message.includes('campaign_selection_not_locked')) {
    return 'Lock selection before launching (or select two producers).';
  }
  if (message.includes('campaign_selection_missing')) {
    return 'Select two producers before launching.';
  }
  if (message.includes('selected_producers_not_active')) {
    return 'Selected producers are not eligible yet (active producer + role sync required).';
  }
  if (message.includes('producer1_product_required') || message.includes('producer2_product_required')) {
    return 'Both selected producers must have an active published beat to launch the battle.';
  }
  if (message.includes('producer1_product_invalid') || message.includes('producer2_product_invalid')) {
    return 'One selected beat is invalid. Select valid active beats and try again.';
  }
  if (message.includes('submission_deadline_in_past')) {
    return 'Submission deadline must be in the future.';
  }
  if (message.includes('campaign_not_found')) {
    return 'Campaign not found.';
  }
  if (message.includes('campaign_already_launched')) {
    return 'Campaign already launched. This action is not available anymore.';
  }
  if (message.includes('application_not_found')) {
    return 'Producer application not found for this campaign.';
  }
  return message;
}

function getCampaignProposedBeatValidation(
  application: AdminBattleApplicationRow,
  product: CampaignProductRow | undefined
) {
  if (!application.proposed_product_id) {
    return { isEligible: false, reason: 'missing_proposed_product' };
  }
  if (!product) {
    return { isEligible: false, reason: 'beat_not_found_or_not_readable' };
  }
  if (product.id !== application.proposed_product_id) {
    return { isEligible: false, reason: 'product_id_mismatch' };
  }
  if (product.producer_id !== application.producer_id) {
    return { isEligible: false, reason: 'not_owned_by_producer' };
  }
  if (product.product_type !== 'beat') {
    return { isEligible: false, reason: `product_type_${product.product_type ?? 'unknown'}` };
  }
  if (product.status !== 'active') {
    return { isEligible: false, reason: `status_${product.status ?? 'unknown'}` };
  }
  if (product.is_published !== true) {
    return { isEligible: false, reason: 'not_published' };
  }
  if (product.deleted_at !== null) {
    return { isEligible: false, reason: 'deleted' };
  }

  return { isEligible: true, reason: null };
}

function toCampaignProposedBeatReason(reason: string | null) {
  if (!reason) return 'Unknown validation issue.';
  if (reason === 'missing_proposed_product') return 'No proposed beat was attached to this application.';
  if (reason === 'beat_not_found_or_not_readable') return 'Beat not found (or not readable with current policies).';
  if (reason === 'product_id_mismatch') return 'Application beat id does not match loaded product id.';
  if (reason === 'not_owned_by_producer') return 'Beat is not owned by this producer.';
  if (reason === 'not_published') return 'Beat is not published.';
  if (reason === 'deleted') return 'Beat is deleted.';
  if (reason.startsWith('status_')) return `Beat status is ${reason.replace('status_', '')}, expected active.`;
  if (reason.startsWith('product_type_')) return `Product type is ${reason.replace('product_type_', '')}, expected beat.`;
  return `Validation failed (${reason}).`;
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
  const [campaigns, setCampaigns] = useState<AdminBattleCampaignRow[]>([]);
  const [campaignApplications, setCampaignApplications] = useState<AdminBattleApplicationRow[]>([]);
  const [campaignProducersById, setCampaignProducersById] = useState<Record<string, CampaignProducerRow>>({});
  const [campaignProductsById, setCampaignProductsById] = useState<Record<string, CampaignProductRow>>({});
  const [campaignBattleSlugById, setCampaignBattleSlugById] = useState<Record<string, string>>({});
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignActionKey, setCampaignActionKey] = useState<string | null>(null);
  const [activeCampaignPreviewPlayerId, setActiveCampaignPreviewPlayerId] = useState<string | null>(null);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [campaignCoverImageFile, setCampaignCoverImageFile] = useState<File | null>(null);
  const [campaignSelectionById, setCampaignSelectionById] = useState<Record<string, { producer1Id: string; producer2Id: string }>>({});
  const [campaignCreateForm, setCampaignCreateForm] = useState({
    title: '',
    description: '',
    socialDescription: '',
    participationDeadline: '',
    submissionDeadline: '',
  });
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

  const loadCampaignData = useCallback(async () => {
    setIsCampaignsLoading(true);
    setCampaignError(null);

    const [campaignsRes, applicationsRes] = await Promise.all([
      supabase
        .from('admin_battle_campaigns' as any)
        .select(`
          id,
          title,
          description,
          social_description,
          cover_image_url,
          share_slug,
          status,
          participation_deadline,
          submission_deadline,
          selected_producer1_id,
          selected_producer2_id,
          battle_id,
          created_by,
          launched_at,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false }),
      supabase
        .from('admin_battle_applications' as any)
        .select(`
          id,
          campaign_id,
          producer_id,
          message,
          proposed_product_id,
          admin_feedback,
          admin_feedback_at,
          status,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false }),
    ]);

    if (campaignsRes.error) {
      console.error('Error loading admin battle campaigns:', campaignsRes.error);
      setCampaigns([]);
      setCampaignApplications([]);
      setCampaignProducersById({});
      setCampaignProductsById({});
      setCampaignBattleSlugById({});
      setCampaignError(campaignsRes.error.message);
      setIsCampaignsLoading(false);
      return;
    }

    if (applicationsRes.error) {
      console.error('Error loading admin battle campaign applications:', applicationsRes.error);
      setCampaigns((campaignsRes.data as unknown as AdminBattleCampaignRow[] | null) ?? []);
      setCampaignApplications([]);
      setCampaignProducersById({});
      setCampaignProductsById({});
      setCampaignBattleSlugById({});
      setCampaignError(applicationsRes.error.message);
      setIsCampaignsLoading(false);
      return;
    }

    const campaignRows = (campaignsRes.data as unknown as AdminBattleCampaignRow[] | null) ?? [];
    const applicationRows = (applicationsRes.data as unknown as AdminBattleApplicationRow[] | null) ?? [];

    const producerIds = new Set<string>();
    const productIds = new Set<string>();
    const battleIds = new Set<string>();

    for (const campaign of campaignRows) {
      if (campaign.selected_producer1_id) producerIds.add(campaign.selected_producer1_id);
      if (campaign.selected_producer2_id) producerIds.add(campaign.selected_producer2_id);
      if (campaign.battle_id) battleIds.add(campaign.battle_id);
    }

    for (const application of applicationRows) {
      producerIds.add(application.producer_id);
      if (application.proposed_product_id) productIds.add(application.proposed_product_id);
    }

    const [producersRes, productsRes, battlesRes] = await Promise.all([
      producerIds.size > 0
        ? supabase
            .from('user_profiles')
            .select('id, username')
            .in('id', [...producerIds])
        : Promise.resolve({ data: [], error: null }),
      productIds.size > 0
        ? supabase.rpc('admin_get_products_for_campaign' as any, { p_product_ids: [...productIds] })
        : Promise.resolve({ data: [], error: null }),
      battleIds.size > 0
        ? supabase
            .from('battles')
            .select('id, slug')
            .in('id', [...battleIds])
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (producersRes.error) {
      console.error('Error loading campaign producers:', producersRes.error);
    }

    if (productsRes.error) {
      console.error('Error loading campaign proposed products:', productsRes.error);
    }

    if (battlesRes.error) {
      console.error('Error loading campaign launched battles:', battlesRes.error);
    }

    const producerMap: Record<string, CampaignProducerRow> = {};
    for (const row of ((producersRes.data as CampaignProducerRow[] | null) ?? [])) {
      producerMap[row.id] = row;
    }

    const productMap: Record<string, CampaignProductRow> = {};
    for (const row of ((productsRes.data as CampaignProductRow[] | null) ?? [])) {
      productMap[row.id] = row;
    }

    const battleSlugMap: Record<string, string> = {};
    for (const row of ((battlesRes.data as Array<{ id: string; slug: string }> | null) ?? [])) {
      battleSlugMap[row.id] = row.slug;
    }

    setCampaigns(campaignRows);
    setCampaignApplications(applicationRows);
    setCampaignProducersById(producerMap);
    setCampaignProductsById(productMap);
    setCampaignBattleSlugById(battleSlugMap);
    setCampaignSelectionById((prev) => {
      const next = { ...prev };
      for (const campaign of campaignRows) {
        const previous = next[campaign.id] ?? { producer1Id: '', producer2Id: '' };
        next[campaign.id] = {
          producer1Id: previous.producer1Id || campaign.selected_producer1_id || '',
          producer2Id: previous.producer2Id || campaign.selected_producer2_id || '',
        };
      }
      return next;
    });
    setIsCampaignsLoading(false);
  }, []);

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
      void Promise.all([loadData(), loadCampaignData()]);
    }
  }, [adminContext.isAdmin, loadCampaignData, loadData]);

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

  const campaignApplicationsByCampaignId = useMemo(() => {
    const map = new Map<string, AdminBattleApplicationRow[]>();
    for (const application of campaignApplications) {
      const list = map.get(application.campaign_id);
      if (list) {
        list.push(application);
      } else {
        map.set(application.campaign_id, [application]);
      }
    }
    return map;
  }, [campaignApplications]);

  const campaignPublicBaseUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/battle-campaign/';
    return `${window.location.origin}/battle-campaign/`;
  }, []);

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

  const onCampaignCoverImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setCampaignCoverImageFile(file);
  };

  const createOfficialBattleCampaign = async () => {
    const title = campaignCreateForm.title.trim();
    const description = campaignCreateForm.description.trim() || null;
    const socialDescription = campaignCreateForm.socialDescription.trim() || null;

    if (!title) {
      setCampaignError('Title is required.');
      return;
    }

    if (!campaignCreateForm.participationDeadline || !campaignCreateForm.submissionDeadline) {
      setCampaignError('Participation and submission deadlines are required.');
      return;
    }

    const participationDate = new Date(campaignCreateForm.participationDeadline);
    const submissionDate = new Date(campaignCreateForm.submissionDeadline);

    if (!Number.isFinite(participationDate.getTime()) || !Number.isFinite(submissionDate.getTime())) {
      setCampaignError('Invalid campaign deadlines.');
      return;
    }

    if (submissionDate.getTime() <= Date.now()) {
      setCampaignError('Submission deadline must be in the future.');
      return;
    }

    if (submissionDate.getTime() < participationDate.getTime()) {
      setCampaignError('Submission deadline must be after participation deadline.');
      return;
    }

    setCampaignError(null);
    setIsCreatingCampaign(true);

    let coverImageUrl: string | null = null;
    if (campaignCoverImageFile) {
      const safeFileName = campaignCoverImageFile.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      const imagePath = `campaigns/${adminContext.userId || 'admin'}/${Date.now()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage
        .from(CAMPAIGN_IMAGES_BUCKET)
        .upload(imagePath, campaignCoverImageFile, {
          upsert: false,
          cacheControl: '3600',
        });

      if (uploadError) {
        console.error('Error uploading campaign image:', uploadError);
        setCampaignError(uploadError.message);
        setIsCreatingCampaign(false);
        return;
      }

      coverImageUrl = supabase.storage.from(CAMPAIGN_IMAGES_BUCKET).getPublicUrl(imagePath).data.publicUrl;
    }

    const baseShareSlug = slugify(title) || `official-battle-${Date.now()}`;
    let shareSlugCandidate = baseShareSlug;
    let created = false;
    let lastErrorMessage = 'Unable to create campaign.';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { error: insertError } = await supabase
        .from('admin_battle_campaigns' as any)
        .insert({
          title,
          description,
          social_description: socialDescription,
          cover_image_url: coverImageUrl,
          share_slug: shareSlugCandidate,
          status: 'applications_open',
          participation_deadline: participationDate.toISOString(),
          submission_deadline: submissionDate.toISOString(),
          created_by: adminContext.userId,
        });

      if (!insertError) {
        created = true;
        break;
      }

      lastErrorMessage = insertError.message;
      const isUniqueSlugError = insertError.code === '23505'
        || insertError.message.toLowerCase().includes('share_slug');
      if (!isUniqueSlugError) {
        break;
      }

      shareSlugCandidate = `${baseShareSlug}-${crypto.randomUUID().slice(0, 6)}`;
    }

    if (!created) {
      setCampaignError(lastErrorMessage);
      setIsCreatingCampaign(false);
      return;
    }

    setCampaignCreateForm({
      title: '',
      description: '',
      socialDescription: '',
      participationDeadline: '',
      submissionDeadline: '',
    });
    setCampaignCoverImageFile(null);
    setIsCreatingCampaign(false);
    await loadCampaignData();
  };

  const saveCampaignSelection = async (campaignId: string) => {
    const selection = campaignSelectionById[campaignId] ?? { producer1Id: '', producer2Id: '' };
    if (!selection.producer1Id || !selection.producer2Id) {
      setCampaignError('Select two producers before locking the campaign.');
      return;
    }

    if (selection.producer1Id === selection.producer2Id) {
      setCampaignError('Producer 1 and Producer 2 must be different.');
      return;
    }

    setCampaignError(null);
    setCampaignActionKey(`select:${campaignId}`);

    const { error: rpcError } = await supabase.rpc('admin_set_campaign_selection' as any, {
      p_campaign_id: campaignId,
      p_producer1_id: selection.producer1Id,
      p_producer2_id: selection.producer2Id,
    });

    if (rpcError) {
      console.error('Error setting campaign selection:', rpcError);
      setCampaignError(toCampaignRpcErrorMessage(rpcError.message));
      setCampaignActionKey(null);
      return;
    }

    setCampaignActionKey(null);
    await loadCampaignData();
  };

  const launchCampaignBattle = async (campaign: AdminBattleCampaignRow) => {
    setCampaignError(null);
    setCampaignActionKey(`launch:${campaign.id}`);

    const selection = campaignSelectionById[campaign.id] ?? {
      producer1Id: campaign.selected_producer1_id ?? '',
      producer2Id: campaign.selected_producer2_id ?? '',
    };
    const producer1Id = selection.producer1Id || campaign.selected_producer1_id || '';
    const producer2Id = selection.producer2Id || campaign.selected_producer2_id || '';

    if (campaign.status !== 'selection_locked') {
      if (!producer1Id || !producer2Id) {
        setCampaignError('Select two producers before launching the battle.');
        setCampaignActionKey(null);
        return;
      }

      if (producer1Id === producer2Id) {
        setCampaignError('Producer 1 and Producer 2 must be different.');
        setCampaignActionKey(null);
        return;
      }

      const { error: lockError } = await supabase.rpc('admin_set_campaign_selection' as any, {
        p_campaign_id: campaign.id,
        p_producer1_id: producer1Id,
        p_producer2_id: producer2Id,
      });

      if (lockError) {
        console.error('Error auto-locking campaign selection before launch:', lockError);
        setCampaignError(toCampaignRpcErrorMessage(lockError.message));
        setCampaignActionKey(null);
        return;
      }
    }

    const { data: launchData, error: rpcError } = await supabase.rpc('admin_launch_battle_campaign' as any, {
      p_campaign_id: campaign.id,
    });

    if (rpcError) {
      console.error('Error launching campaign battle:', rpcError);
      setCampaignError(toCampaignRpcErrorMessage(rpcError.message));
      setCampaignActionKey(null);
      return;
    }

    const launchRow = (Array.isArray(launchData) ? launchData[0] : launchData) as
      | { status?: string | null }
      | null
      | undefined;
    if (launchRow?.status === 'launched') {
      toast.success('Battle launched and activated.');
    } else if (launchRow?.status === 'already_launched') {
      toast('Battle already launched for this campaign.');
    }

    setCampaignActionKey(null);
    await Promise.all([loadCampaignData(), loadData()]);
  };

  const requestCampaignBeatResubmission = async (
    campaign: AdminBattleCampaignRow,
    application: AdminBattleApplicationRow
  ) => {
    if (campaign.status === 'launched') {
      setCampaignError('Campaign already launched. You cannot request a beat replacement now.');
      return;
    }

    const producerName = campaignProducersById[application.producer_id]?.username || 'Producer';
    const defaultFeedback = `${producerName}, ton titre propose n'est pas valide pour ce battle. Merci de soumettre un autre beat actif et publie.`;
    const feedback = window.prompt('Message envoye au producteur :', defaultFeedback);
    if (feedback === null) return;

    setCampaignError(null);
    setCampaignActionKey(`request:${application.id}`);

    const { error: rpcError } = await supabase.rpc('admin_request_campaign_application_update' as any, {
      p_campaign_id: campaign.id,
      p_producer_id: application.producer_id,
      p_feedback: feedback.trim() || null,
    });

    if (rpcError) {
      console.error('Error requesting campaign beat resubmission:', rpcError);
      setCampaignError(toCampaignRpcErrorMessage(rpcError.message));
      setCampaignActionKey(null);
      return;
    }

    toast.success('Producer notified. Campaign reopened for another beat submission.');
    setCampaignActionKey(null);
    await loadCampaignData();
  };

  const deleteCampaign = async (campaign: AdminBattleCampaignRow) => {
    const confirmationMessage = campaign.battle_id
      ? 'Delete this campaign? The linked battle will be closed when possible before deletion.'
      : 'Delete this campaign and all producer applications?';

    if (!window.confirm(confirmationMessage)) return;

    setCampaignError(null);
    setCampaignActionKey(`delete:${campaign.id}`);

    if (campaign.battle_id) {
      const { data: battleRow, error: battleLookupError } = await supabase
        .from('battles')
        .select('id, status')
        .eq('id', campaign.battle_id)
        .maybeSingle();

      if (battleLookupError) {
        console.error('Error loading linked battle before campaign deletion:', battleLookupError);
        setCampaignError(battleLookupError.message);
        setCampaignActionKey(null);
        return;
      }

      const linkedBattle = battleRow as { id: string; status: BattleStatus } | null;
      if (linkedBattle) {
        if (linkedBattle.status === 'active' || linkedBattle.status === 'voting') {
          const { error: finalizeError } = await supabase.rpc('finalize_battle', { p_battle_id: linkedBattle.id });
          if (finalizeError) {
            console.error('Error force-closing linked battle before campaign deletion:', finalizeError);
            setCampaignError(toAdminRpcError(finalizeError.message, t));
            setCampaignActionKey(null);
            return;
          }
          toast.success('Linked battle force-closed.');
        } else if (
          linkedBattle.status === 'awaiting_admin'
          || linkedBattle.status === 'pending_acceptance'
          || linkedBattle.status === 'approved'
        ) {
          const { error: cancelError } = await supabase.rpc('admin_cancel_battle', { p_battle_id: linkedBattle.id });
          if (cancelError) {
            console.error('Error cancelling linked battle before campaign deletion:', cancelError);
            setCampaignError(toAdminRpcError(cancelError.message, t));
            setCampaignActionKey(null);
            return;
          }
          toast.success('Linked battle cancelled.');
        }
      }
    }

    const { error: deleteError } = await supabase
      .from('admin_battle_campaigns' as any)
      .delete()
      .eq('id', campaign.id);

    if (deleteError) {
      console.error('Error deleting campaign:', deleteError);
      setCampaignError(deleteError.message);
      setCampaignActionKey(null);
      return;
    }

    toast.success('Campaign deleted.');
    setCampaignActionKey(null);
    await Promise.all([loadCampaignData(), loadData()]);
  };

  if (adminContext.isAdmin === null) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label={t('common.loading')} />
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

        {campaignError && (
          <Card className="bg-red-900/20 border border-red-800 text-red-300">
            {campaignError}
          </Card>
        )}

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Create Official Battle</h2>
          <p className="text-sm text-zinc-400">
            Create a campaign, open producer applications, lock the final selection, then launch a normal battle.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Title</label>
              <input
                type="text"
                value={campaignCreateForm.title}
                onChange={(event) => setCampaignCreateForm((prev) => ({ ...prev, title: event.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500"
                placeholder="Official Drill Battle #1"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Description</label>
              <textarea
                value={campaignCreateForm.description}
                onChange={(event) => setCampaignCreateForm((prev) => ({ ...prev, description: event.target.value }))}
                className="w-full min-h-24 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500"
                placeholder="Battle rules, context and expectations."
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Social Description</label>
              <textarea
                value={campaignCreateForm.socialDescription}
                onChange={(event) => setCampaignCreateForm((prev) => ({ ...prev, socialDescription: event.target.value }))}
                className="w-full min-h-20 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500"
                placeholder="Short description for social sharing."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Participation deadline</label>
              <input
                type="datetime-local"
                value={campaignCreateForm.participationDeadline}
                onChange={(event) =>
                  setCampaignCreateForm((prev) => ({ ...prev, participationDeadline: event.target.value }))
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Submission deadline</label>
              <input
                type="datetime-local"
                value={campaignCreateForm.submissionDeadline}
                onChange={(event) => setCampaignCreateForm((prev) => ({ ...prev, submissionDeadline: event.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Cover image</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onCampaignCoverImageChange}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white"
              />
              {campaignCoverImageFile && (
                <p className="text-xs text-zinc-500 mt-1">Selected file: {campaignCoverImageFile.name}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button isLoading={isCreatingCampaign} onClick={() => void createOfficialBattleCampaign()}>
              Create Official Battle
            </Button>
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-white">Official Battle Campaigns</h2>
            <Badge variant={campaigns.length > 0 ? 'info' : 'default'}>{campaigns.length}</Badge>
          </div>

          {isCampaignsLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : campaigns.length === 0 ? (
            <p className="text-zinc-500 text-sm">No official campaign yet.</p>
          ) : (
            <ul className="space-y-4">
              {campaigns.map((campaign) => {
                const applications = campaignApplicationsByCampaignId.get(campaign.id) ?? [];
                const uniqueApplicants = [...new Map(applications.map((row) => [row.producer_id, row])).values()];
                const selectionState = campaignSelectionById[campaign.id] ?? {
                  producer1Id: campaign.selected_producer1_id ?? '',
                  producer2Id: campaign.selected_producer2_id ?? '',
                };
                const shareUrl = campaign.share_slug ? `${campaignPublicBaseUrl}${campaign.share_slug}` : null;
                const launchedBattleSlug = campaign.battle_id ? campaignBattleSlugById[campaign.battle_id] : null;

                return (
                  <li key={campaign.id} className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-4 space-y-4">
                    <div className="flex flex-col lg:flex-row gap-4">
                      {campaign.cover_image_url ? (
                        <img
                          src={campaign.cover_image_url}
                          alt={campaign.title}
                          className="w-full lg:w-48 h-32 object-cover rounded border border-zinc-800"
                        />
                      ) : (
                        <div className="w-full lg:w-48 h-32 rounded border border-dashed border-zinc-700 flex items-center justify-center text-xs text-zinc-500">
                          No image
                        </div>
                      )}

                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <h3 className="text-white font-semibold">{campaign.title}</h3>
                          <Badge variant={campaignStatusBadgeVariant[campaign.status]}>
                            {toCampaignStatusLabel(campaign.status)}
                          </Badge>
                        </div>

                        {campaign.description && (
                          <p className="text-sm text-zinc-300">{campaign.description}</p>
                        )}

                        <p className="text-xs text-zinc-500">
                          Participation: {formatDateTime(campaign.participation_deadline)} • Submission: {formatDateTime(campaign.submission_deadline)}
                        </p>

                        {shareUrl && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Link to={`/battle-campaign/${campaign.share_slug}`} className="text-sky-300 hover:text-sky-200">
                              Open public campaign page
                            </Link>
                            <button
                              type="button"
                              className="text-zinc-400 hover:text-white"
                              onClick={() => navigator.clipboard.writeText(shareUrl)}
                            >
                              Copy link
                            </button>
                          </div>
                        )}

                        {launchedBattleSlug && (
                          <Link to={`/battles/${launchedBattleSlug}`} className="text-xs text-emerald-300 hover:text-emerald-200">
                            Open launched battle
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-zinc-200">Applications ({applications.length})</h4>
                      {applications.length === 0 ? (
                        <p className="text-sm text-zinc-500">No producer applications yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {applications.map((application) => (
                            <li key={application.id} className="border border-zinc-800 rounded bg-zinc-950/60 p-2 text-sm">
                              <p className="text-zinc-100">
                                {campaignProducersById[application.producer_id]?.username || application.producer_id}
                                <span className="text-zinc-500"> • {application.status}</span>
                              </p>
                              {application.message && <p className="text-zinc-400 text-xs mt-1">{application.message}</p>}
                              {(application.proposed_product_id || application.admin_feedback) && (
                                (() => {
                                  const hasProposedBeat = Boolean(application.proposed_product_id);
                                  const proposedProduct = application.proposed_product_id
                                    ? campaignProductsById[application.proposed_product_id]
                                    : undefined;
                                  const validation = hasProposedBeat
                                    ? getCampaignProposedBeatValidation(application, proposedProduct)
                                    : { isEligible: false, reason: 'missing_proposed_product' };
                                  const producerName = campaignProducersById[application.producer_id]?.username || 'Producer';
                                  const productLabel = proposedProduct?.title || application.proposed_product_id || 'None';
                                  const reasonLabel = toCampaignProposedBeatReason(validation.reason);

                                  return (
                                    <div className="mt-1 space-y-1">
                                      {hasProposedBeat ? (
                                        <p className="text-zinc-500 text-xs">
                                          Proposed beat: {productLabel}
                                        </p>
                                      ) : (
                                        <p className="text-zinc-500 text-xs">
                                          Proposed beat: waiting for producer update.
                                        </p>
                                      )}
                                      {hasProposedBeat && application.proposed_product_id && (
                                        <BattleAudioPlayer
                                          productId={application.proposed_product_id}
                                          src={proposedProduct?.preview_url || proposedProduct?.exclusive_preview_url || null}
                                          label="Campaign beat preview"
                                          playerId={`campaign-preview-${campaign.id}-${application.id}`}
                                          activePlayerId={activeCampaignPreviewPlayerId}
                                          onActivePlayerChange={setActiveCampaignPreviewPlayerId}
                                        />
                                      )}
                                      {application.admin_feedback && (
                                        <p className="text-[11px] text-sky-300">
                                          Latest admin request: {application.admin_feedback}
                                        </p>
                                      )}
                                      {hasProposedBeat && !validation.isEligible && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <p className="text-amber-400 text-xs">
                                            Invalid beat for launch: {reasonLabel}
                                          </p>
                                          <button
                                            type="button"
                                            className="text-[11px] text-emerald-300 hover:text-emerald-200 underline"
                                            disabled={campaignActionKey === `request:${application.id}` || campaign.status === 'launched'}
                                            onClick={() => void requestCampaignBeatResubmission(campaign, application)}
                                          >
                                            {campaignActionKey === `request:${application.id}` ? 'Requesting...' : 'Request new beat'}
                                          </button>
                                          <button
                                            type="button"
                                            className="text-[11px] text-zinc-300 hover:text-white underline"
                                            onClick={() => {
                                              const message = `${producerName}, ton beat propose "${productLabel}" n'est pas valide pour le battle (${reasonLabel}). Merci de reproposer un beat actif et publie.`;
                                              navigator.clipboard.writeText(message);
                                              toast.success('Request message copied.');
                                            }}
                                          >
                                            Copy request
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1">Producer 1</label>
                        <select
                          value={selectionState.producer1Id}
                          onChange={(event) =>
                            setCampaignSelectionById((prev) => ({
                              ...prev,
                              [campaign.id]: {
                                ...selectionState,
                                producer1Id: event.target.value,
                              },
                            }))
                          }
                          className="w-full h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        >
                          <option value="">Select producer</option>
                          {uniqueApplicants.map((application) => (
                            <option key={`p1-${campaign.id}-${application.producer_id}`} value={application.producer_id}>
                              {campaignProducersById[application.producer_id]?.username || application.producer_id}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-zinc-400 mb-1">Producer 2</label>
                        <select
                          value={selectionState.producer2Id}
                          onChange={(event) =>
                            setCampaignSelectionById((prev) => ({
                              ...prev,
                              [campaign.id]: {
                                ...selectionState,
                                producer2Id: event.target.value,
                              },
                            }))
                          }
                          className="w-full h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        >
                          <option value="">Select producer</option>
                          {uniqueApplicants.map((application) => (
                            <option key={`p2-${campaign.id}-${application.producer_id}`} value={application.producer_id}>
                              {campaignProducersById[application.producer_id]?.username || application.producer_id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={campaignActionKey === `delete:${campaign.id}`}
                        onClick={() => void deleteCampaign(campaign)}
                      >
                        Delete Campaign
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={campaignActionKey === `select:${campaign.id}`}
                        onClick={() => void saveCampaignSelection(campaign.id)}
                      >
                        Lock Selection
                      </Button>
                      <Button
                        size="sm"
                        isLoading={campaignActionKey === `launch:${campaign.id}`}
                        disabled={campaign.status === 'cancelled'}
                        onClick={() => void launchCampaignBattle(campaign)}
                      >
                        Launch Battle
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

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
