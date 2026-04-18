import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Clock, Copy, Share2, Trophy, Users } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ReputationBadge } from '../components/reputation/ReputationBadge';
import { VotePanel } from '../components/battles/VotePanel';
import { CommentsPanel } from '../components/battles/CommentsPanel';
import { BattleAudioPlayer } from '../components/audio/BattleAudioPlayer';
import { useTranslation } from '../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { fetchPublicProducerProfilesMap } from '../lib/supabase/publicProfiles';
import type { BattleProductSnapshot, BattleWithRelations, ProductWithRelations } from '../lib/supabase/types';
import { formatDateTime } from '../lib/utils/format';
import { useAuth } from '../lib/auth/hooks';
import { getReferrer, storeReferrer, trackBattleShare, trackBattleVote, trackBattleView } from '../lib/analytics';

type BattleSnapshotSlot = 'producer1' | 'producer2';
type BattleSnapshotMap = Partial<Record<BattleSnapshotSlot, BattleProductSnapshot>>;

function getStatusVariant(status: BattleWithRelations['status']) {
  if (status === 'active' || status === 'voting') return 'success';
  if (status === 'awaiting_admin') return 'info';
  if (status === 'approved') return 'info';
  if (status === 'completed') return 'info';
  if (status === 'cancelled') return 'danger';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

function getStatusLabelKey(status: BattleWithRelations['status']) {
  if (status === 'active' || status === 'voting') return 'battleDetail.statusActive';
  if (status === 'pending_acceptance') return 'battleDetail.statusPendingAcceptance';
  if (status === 'awaiting_admin') return 'battleDetail.statusAwaitingAdmin';
  if (status === 'approved') return 'battleDetail.statusApproved';
  if (status === 'rejected') return 'battleDetail.statusRejected';
  if (status === 'completed') return 'battleDetail.statusCompleted';
  if (status === 'cancelled') return 'battleDetail.statusCancelled';
  return 'battleDetail.statusPending';
}

function getProductUrl(product: Pick<ProductWithRelations, 'slug' | 'product_type'> | null | undefined) {
  if (!product?.slug) return null;
  if (product.product_type === 'exclusive') return `/exclusives/${product.slug}`;
  if (product.product_type === 'kit') return `/kits/${product.slug}`;
  return `/beats/${product.slug}`;
}

export function BattleDetailPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [battle, setBattle] = useState<BattleWithRelations | null>(null);
  const [battleSnapshots, setBattleSnapshots] = useState<BattleSnapshotMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchBattle = useCallback(async () => {
    if (!slug) {
      setError(t('battleDetail.missingSlug'));
      setBattleSnapshots({});
      setHistoryWarning(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setHistoryWarning(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          description,
          producer1_id,
          producer2_id,
          product1_id,
          product2_id,
          status,
          accepted_at,
          rejected_at,
          admin_validated_at,
          rejection_reason,
          response_deadline,
          submission_deadline,
          starts_at,
          voting_ends_at,
          winner_id,
          votes_producer1,
          votes_producer2,
          featured,
          prize_description,
          created_at,
          updated_at,
          product1:products!battles_product1_id_fkey(id, title, slug, product_type, preview_url, cover_image_url, price),
          product2:products!battles_product2_id_fkey(id, title, slug, product_type, preview_url, cover_image_url, price)
        `)
        .eq('slug', slug)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      const row = (data as BattleWithRelations | null) ?? null;
      if (!row) {
        setBattle(null);
        setBattleSnapshots({});
      } else {
        const { data: snapshotData, error: snapshotError } = await supabase
          .from('battle_product_snapshots')
          .select('id, battle_id, slot, product_id, title_snapshot, preview_url_snapshot, producer_id, created_at, updated_at')
          .eq('battle_id', row.id);

        if (snapshotError) {
          console.error('[battle-detail] failed to load battle product snapshots', snapshotError);
          setHistoryWarning(t('battleDetail.historyWarning'));
          setBattleSnapshots({});
        } else {
          const nextSnapshots = ((snapshotData as BattleProductSnapshot[] | null) ?? []).reduce<BattleSnapshotMap>((acc, snapshot) => {
            if (snapshot.slot === 'producer1' || snapshot.slot === 'producer2') {
              acc[snapshot.slot] = snapshot;
            }
            return acc;
          }, {});
          setBattleSnapshots(nextSnapshots);
        }

        let nextBattle: BattleWithRelations = row;

        try {
          const producerProfilesMap = await fetchPublicProducerProfilesMap([
            row.producer1_id,
            row.producer2_id,
            row.winner_id,
          ]);
          const producer1 = producerProfilesMap.get(row.producer1_id);
          const producer2 = row.producer2_id ? producerProfilesMap.get(row.producer2_id) : undefined;
          const winner = row.winner_id ? producerProfilesMap.get(row.winner_id) : undefined;

          nextBattle = {
            ...row,
            producer1: producer1
              ? {
                  id: producer1.user_id,
                  username: producer1.username,
                  avatar_url: producer1.avatar_url,
                  xp: producer1.xp,
                  level: producer1.level,
                  rank_tier: producer1.rank_tier,
                  reputation_score: producer1.reputation_score,
                }
              : undefined,
            producer2: producer2
              ? {
                  id: producer2.user_id,
                  username: producer2.username,
                  avatar_url: producer2.avatar_url,
                  xp: producer2.xp,
                  level: producer2.level,
                  rank_tier: producer2.rank_tier,
                  reputation_score: producer2.reputation_score,
                }
              : undefined,
            winner: winner
              ? {
                  id: winner.user_id,
                  username: winner.username,
                  avatar_url: winner.avatar_url,
                  xp: winner.xp,
                  level: winner.level,
                  rank_tier: winner.rank_tier,
                  reputation_score: winner.reputation_score,
                }
              : undefined,
          } as BattleWithRelations;
        } catch (enrichError) {
          console.error('[battle-detail] failed to enrich producer profiles', enrichError);
          nextBattle = {
            ...row,
            producer1: undefined,
            producer2: undefined,
            winner: undefined,
          } as BattleWithRelations;
        }

        setBattle(nextBattle);
      }
    } catch (fetchErr) {
      console.error('Error fetching battle detail:', fetchErr);
      setBattle(null);
      setBattleSnapshots({});
      setHistoryWarning(null);
      setError(t('battleDetail.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [slug, t]);

  useEffect(() => {
    void fetchBattle();
  }, [fetchBattle]);

  // Realtime subscription — met à jour uniquement les compteurs de votes
  useEffect(() => {
    if (!battle?.id) return;

    const channel = supabase
      .channel(`battle-votes:${battle.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'battles',
          filter: `id=eq.${battle.id}`,
        },
        (payload) => {
          const updated = payload.new as { votes_producer1?: number; votes_producer2?: number };
          setBattle((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              votes_producer1: updated.votes_producer1 ?? prev.votes_producer1,
              votes_producer2: updated.votes_producer2 ?? prev.votes_producer2,
            };
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [battle?.id]);

  // Lit le paramètre ?ref= à l'arrivée et le stocke une seule fois
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) storeReferrer(ref);
  }, []);

  // Met à jour le titre de la page quand la battle est chargée
  useEffect(() => {
    if (!battle) return;
    const prev = document.title;
    document.title = `${battle.title} – Beatelion`;
    return () => { document.title = prev; };
  }, [battle?.title]);

  // Track la vue battle une fois que l'ID est connu
  useEffect(() => {
    if (!battle) return;
    trackBattleView({ battleId: battle.id, slug: battle.slug, referrer: getReferrer() });
  }, [battle?.id]);

  const handleShare = useCallback(async () => {
    if (!battle) return;
    const shareUrl = user?.id
      ? `${window.location.origin}/battles/${battle.slug}?ref=${user.id}`
      : `${window.location.origin}/battles/${battle.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: battle.title, url: shareUrl });
        trackBattleShare({ battleId: battle.id, method: 'native' });
        return;
      } catch {
        // annulé par l'utilisateur ou non supporté — fallback clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      trackBattleShare({ battleId: battle.id, method: 'clipboard' });
    } catch {
      // clipboard non disponible (HTTP sans HTTPS) — aucune action
    }
  }, [battle, user?.id]);

  // Mise à jour optimiste locale après vote (sans re-fetch)
  const handleVoteSuccess = useCallback((votedForProducerId: string) => {
    if (battle) {
      trackBattleVote({ battleId: battle.id, referrer: getReferrer() });
    }
    setBattle((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        votes_producer1:
          votedForProducerId === prev.producer1_id
            ? prev.votes_producer1 + 1
            : prev.votes_producer1,
        votes_producer2:
          votedForProducerId === prev.producer2_id
            ? prev.votes_producer2 + 1
            : prev.votes_producer2,
      };
    });
  }, [battle]);

  const totalVotes = useMemo(() => {
    if (!battle) return 0;
    return (battle.votes_producer1 || 0) + (battle.votes_producer2 || 0);
  }, [battle]);

  const producer1Percent = useMemo(() => {
    if (!battle || totalVotes === 0) return 50;
    return (battle.votes_producer1 / totalVotes) * 100;
  }, [battle, totalVotes]);

  const producer2Percent = useMemo(() => {
    if (!battle || totalVotes === 0) return 50;
    return (battle.votes_producer2 / totalVotes) * 100;
  }, [battle, totalVotes]);

  const product1Snapshot = battleSnapshots.producer1;
  const product2Snapshot = battleSnapshots.producer2;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 animate-pulse">
            <div className="h-6 bg-zinc-800 rounded w-1/3 mb-4" />
            <div className="h-4 bg-zinc-800 rounded w-2/3 mb-8" />
            <div className="h-40 bg-zinc-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <Link to="/battles" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            {t('battleDetail.backToBattles')}
          </Link>
          <Card>
            <p className="text-red-400">{error}</p>
          </Card>
        </div>
      </div>
    );
  }

  if (!battle) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <Link to="/battles" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            {t('battleDetail.backToBattles')}
          </Link>
          <Card>
            <p className="text-zinc-300">{t('battleDetail.notFound')}</p>
          </Card>
        </div>
      </div>
    );
  }

  const product1Url = getProductUrl(battle.product1 || null);
  const product2Url = getProductUrl(battle.product2 || null);
  const product1Title = battle.product1?.title ?? product1Snapshot?.title_snapshot ?? null;
  const product2Title = battle.product2?.title ?? product2Snapshot?.title_snapshot ?? null;
  const product1PreviewUrl = battle.product1?.preview_url ?? product1Snapshot?.preview_url_snapshot ?? null;
  const product2PreviewUrl = battle.product2?.preview_url ?? product2Snapshot?.preview_url_snapshot ?? null;
  const product1IsHistoricalOnly = !battle.product1 && Boolean(product1Snapshot);
  const product2IsHistoricalOnly = !battle.product2 && Boolean(product2Snapshot);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/battles" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            {t('battleDetail.backToBattles')}
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title={t('battleDetail.shareButton')}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" />
                  <span className="text-green-400">{t('battleDetail.linkCopied')}</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 sm:hidden" />
                  <Copy className="w-4 h-4 hidden sm:block" />
                  <span className="hidden sm:inline">{t('battleDetail.copyLink')}</span>
                </>
              )}
            </button>
            <Badge variant={getStatusVariant(battle.status)}>{t(getStatusLabelKey(battle.status) as 'battleDetail.statusActive' | 'battleDetail.statusPendingAcceptance' | 'battleDetail.statusAwaitingAdmin' | 'battleDetail.statusApproved' | 'battleDetail.statusRejected' | 'battleDetail.statusCompleted' | 'battleDetail.statusCancelled' | 'battleDetail.statusPending')}</Badge>
          </div>
        </div>

        <Card className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{battle.title}</h1>
            {battle.description ? (
              <p className="text-zinc-400">{battle.description}</p>
            ) : (
              <p className="text-zinc-500">{t('battleDetail.noDescription')}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="bg-zinc-800/50 rounded-lg p-4">
              <p className="text-zinc-500 text-xs uppercase mb-1">{t('battleDetail.producer1Label')}</p>
              <p className="text-white font-semibold">{battle.producer1?.username || t('battleDetail.producer1Fallback')}</p>
              {battle.producer1 && (
                <ReputationBadge
                  compact
                  rankTier={battle.producer1.rank_tier}
                  level={battle.producer1.level}
                  xp={battle.producer1.xp}
                />
              )}
              <p className="text-rose-400 text-sm mt-1">{battle.votes_producer1} {t('battles.votes')}</p>
              {battle.product1 && product1Url && (
                <Link to={product1Url} className="text-xs text-zinc-400 hover:text-white mt-2 inline-block">
                  {battle.product1.title}
                </Link>
              )}
              {!battle.product1 && product1Snapshot?.title_snapshot && (
                <p className="text-xs text-amber-300 mt-2">{t('battleDetail.deletedProductWithTitle', { title: product1Snapshot.title_snapshot })}</p>
              )}
            </div>

            <div className="text-center">
              <p className="text-zinc-500 uppercase tracking-wide text-xs">{t('battles.vs')}</p>
              {battle.status === 'completed' && battle.winner?.username && (
                <div className="inline-flex items-center gap-2 text-amber-400 mt-2">
                  <Trophy className="w-4 h-4" />
                  <span className="text-sm">{battle.winner.username}</span>
                </div>
              )}
              {battle.voting_ends_at && (
                <p className="text-zinc-400 text-xs mt-2 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(battle.voting_ends_at)}
                </p>
              )}
            </div>

            <div className="bg-zinc-800/50 rounded-lg p-4 text-right">
              <p className="text-zinc-500 text-xs uppercase mb-1">{t('battleDetail.producer2Label')}</p>
              <p className="text-white font-semibold">{battle.producer2?.username || t('battleDetail.producer2Fallback')}</p>
              {battle.producer2 && (
                <div className="flex justify-end">
                  <ReputationBadge
                    compact
                    rankTier={battle.producer2.rank_tier}
                    level={battle.producer2.level}
                    xp={battle.producer2.xp}
                  />
                </div>
              )}
              <p className="text-orange-400 text-sm mt-1">{battle.votes_producer2} {t('battles.votes')}</p>
              {battle.product2 && product2Url && (
                <Link to={product2Url} className="text-xs text-zinc-400 hover:text-white mt-2 inline-block">
                  {battle.product2.title}
                </Link>
              )}
              {!battle.product2 && product2Snapshot?.title_snapshot && (
                <p className="text-xs text-amber-300 mt-2">{t('battleDetail.deletedProductWithTitle', { title: product2Snapshot.title_snapshot })}</p>
              )}
            </div>
          </div>

          {historyWarning && (
            <Card className="bg-amber-900/20 border border-amber-800">
              <p className="text-sm text-amber-200">{historyWarning}</p>
            </Card>
          )}

          {battle.status === 'rejected' && battle.rejection_reason && (
            <Card className="bg-red-900/20 border border-red-800">
              <p className="text-sm text-red-300">{t('battleDetail.invitedProducerRejected', { reason: battle.rejection_reason })}</p>
            </Card>
          )}

          {battle.status === 'awaiting_admin' && (
            <Card className="bg-sky-900/20 border border-sky-800">
              <p className="text-sm text-sky-300">{t('battleDetail.awaitingAdmin')}</p>
            </Card>
          )}

          <div>
            <div className="h-2 rounded-full overflow-hidden bg-zinc-800 flex">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-rose-400"
                style={{ width: `${producer1Percent}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-orange-400 to-orange-500"
                style={{ width: `${producer2Percent}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-sm text-zinc-500">
              <span>{producer1Percent.toFixed(0)}%</span>
              <span>{t('battleDetail.totalVotes', { count: totalVotes })}</span>
              <span>{producer2Percent.toFixed(0)}%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-zinc-800/30">
              <p className="text-zinc-500 text-xs uppercase mb-2">{t('battleDetail.product1Label')}</p>
              {battle.product1 || product1Snapshot ? (
                <div className="space-y-2">
                  <p className="text-white font-medium">{product1Title || t('battleDetail.productUnavailable')}</p>
                  {product1IsHistoricalOnly && (
                    <p className="text-xs text-amber-300">{t('battleDetail.deletedProductHistory')}</p>
                  )}
                  <BattleAudioPlayer
                    productId={battle.product1?.id ?? product1Snapshot?.product_id ?? null}
                    src={product1PreviewUrl}
                    label={product1IsHistoricalOnly ? t('battleDetail.historicalPreviewProducer1') : t('battleDetail.previewProducer1')}
                  />
                  {battle.product1 && product1Url && (
                    <Link to={product1Url} className="text-xs text-zinc-400 hover:text-white">
                      {t('battleDetail.productPageLink')}
                    </Link>
                  )}
                  {product1IsHistoricalOnly && !product1PreviewUrl && (
                    <p className="text-xs text-zinc-500">{t('battleDetail.noHistoricalPreview')}</p>
                  )}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">{t('battleDetail.notAssigned')}</p>
              )}
            </Card>

            <Card className="bg-zinc-800/30">
              <p className="text-zinc-500 text-xs uppercase mb-2">{t('battleDetail.product2Label')}</p>
              {battle.product2 || product2Snapshot ? (
                <div className="space-y-2">
                  <p className="text-white font-medium">{product2Title || t('battleDetail.productUnavailable')}</p>
                  {product2IsHistoricalOnly && (
                    <p className="text-xs text-amber-300">{t('battleDetail.deletedProductHistory')}</p>
                  )}
                  <BattleAudioPlayer
                    productId={battle.product2?.id ?? product2Snapshot?.product_id ?? null}
                    src={product2PreviewUrl}
                    label={product2IsHistoricalOnly ? t('battleDetail.historicalPreviewProducer2') : t('battleDetail.previewProducer2')}
                  />
                  {battle.product2 && product2Url && (
                    <Link to={product2Url} className="text-xs text-zinc-400 hover:text-white">
                      {t('battleDetail.productPageLink')}
                    </Link>
                  )}
                  {product2IsHistoricalOnly && !product2PreviewUrl && (
                    <p className="text-xs text-zinc-500">{t('battleDetail.noHistoricalPreview')}</p>
                  )}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">{t('battleDetail.notAssigned')}</p>
              )}
            </Card>
          </div>

          <div className="text-xs text-zinc-500 inline-flex items-center gap-1">
            <Users className="w-3 h-3" />
            {t('battleDetail.slugLabel')}: {battle.slug}
          </div>
        </Card>

        <VotePanel
          battle={battle}
          onVoteSuccess={handleVoteSuccess}
        />

        <CommentsPanel
          battleId={battle.id}
          commentsOpen={battle.status === 'active' || battle.status === 'voting'}
        />
      </div>
    </div>
  );
}
