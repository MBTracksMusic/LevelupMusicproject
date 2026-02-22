import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Filter, ShieldAlert } from 'lucide-react';
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
  return 'Action admin impossible pour le moment.';
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

export function AdminBattlesPage() {
  const [battles, setBattles] = useState<AdminBattleRow[]>([]);
  const [comments, setComments] = useState<AdminCommentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminFilter>('awaiting_admin');
  const [selectedProducerId, setSelectedProducerId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
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

    const [battlesRes, commentsRes] = await Promise.all([
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

    await loadData();
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
              {visibleBattles.map((battle) => (
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

                  {battle.status === 'rejected' && battle.rejection_reason && (
                    <p className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                      Motif du refus: {battle.rejection_reason}
                    </p>
                  )}
                </li>
              ))}
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
              {comments.map((comment) => (
                <li key={comment.id} className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-4 space-y-2">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="text-sm text-zinc-300">
                        {comment.user?.username || 'Utilisateur'} sur {comment.battle?.title || comment.battle_id}
                      </p>
                      <p className="text-xs text-zinc-500">{new Date(comment.created_at).toLocaleString()}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => toggleCommentModeration(comment)}>
                      {comment.is_hidden ? 'Restaurer' : 'Masquer'}
                    </Button>
                  </div>

                  <p className={`text-sm ${comment.is_hidden ? 'text-zinc-500 italic' : 'text-zinc-200'}`}>
                    {comment.is_hidden ? `Commentaire masque (${comment.hidden_reason || 'admin'}).` : comment.content}
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
