import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Trophy, Users } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { VotePanel } from '../components/battles/VotePanel';
import { CommentsPanel } from '../components/battles/CommentsPanel';
import { BattleAudioPlayer } from '../components/audio/BattleAudioPlayer';
import { useTranslation } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { BattleWithRelations, ProductWithRelations } from '../lib/supabase/types';

function getStatusVariant(status: BattleWithRelations['status']) {
  if (status === 'active' || status === 'voting') return 'success';
  if (status === 'awaiting_admin') return 'info';
  if (status === 'approved') return 'info';
  if (status === 'completed') return 'info';
  if (status === 'cancelled') return 'danger';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

function getStatusLabel(status: BattleWithRelations['status']) {
  if (status === 'active' || status === 'voting') return 'En cours';
  if (status === 'pending_acceptance') return 'En attente de reponse';
  if (status === 'awaiting_admin') return 'En attente admin';
  if (status === 'approved') return 'Approuvee';
  if (status === 'rejected') return 'Refusee';
  if (status === 'completed') return 'Terminee';
  if (status === 'cancelled') return 'Annulee';
  return 'En attente';
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
  const [battle, setBattle] = useState<BattleWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBattlePlayerId, setActiveBattlePlayerId] = useState<string | null>(null);

  const fetchBattle = useCallback(async () => {
    if (!slug) {
      setError('Battle introuvable.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

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
          producer1:user_profiles!battles_producer1_id_fkey(id, username, avatar_url),
          producer2:user_profiles!battles_producer2_id_fkey(id, username, avatar_url),
          product1:products!battles_product1_id_fkey(id, title, slug, product_type, preview_url, cover_image_url, price),
          product2:products!battles_product2_id_fkey(id, title, slug, product_type, preview_url, cover_image_url, price),
          winner:user_profiles!battles_winner_id_fkey(id, username, avatar_url)
        `)
        .eq('slug', slug)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      setBattle((data as BattleWithRelations | null) ?? null);
    } catch (fetchErr) {
      console.error('Error fetching battle detail:', fetchErr);
      setBattle(null);
      setError('Impossible de charger la battle pour le moment.');
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchBattle();
  }, [fetchBattle]);

  useEffect(() => {
    setActiveBattlePlayerId(null);
  }, [battle?.id]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
        <div className="max-w-5xl mx-auto px-4">
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
        <div className="max-w-5xl mx-auto px-4 space-y-4">
          <Link to="/battles" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            Retour aux battles
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
        <div className="max-w-5xl mx-auto px-4 space-y-4">
          <Link to="/battles" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            Retour aux battles
          </Link>
          <Card>
            <p className="text-zinc-300">Battle introuvable.</p>
          </Card>
        </div>
      </div>
    );
  }

  const product1Url = getProductUrl(battle.product1 || null);
  const product2Url = getProductUrl(battle.product2 || null);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/battles" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
            Retour aux battles
          </Link>
          <Badge variant={getStatusVariant(battle.status)}>{getStatusLabel(battle.status)}</Badge>
        </div>

        <Card className="space-y-5">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{battle.title}</h1>
            {battle.description ? (
              <p className="text-zinc-400">{battle.description}</p>
            ) : (
              <p className="text-zinc-500">Aucune description.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="bg-zinc-800/50 rounded-lg p-4">
              <p className="text-zinc-500 text-xs uppercase mb-1">Producteur 1</p>
              <p className="text-white font-semibold">{battle.producer1?.username || 'Producteur 1'}</p>
              <p className="text-rose-400 text-sm mt-1">{battle.votes_producer1} {t('battles.votes')}</p>
              {battle.product1 && product1Url && (
                <Link to={product1Url} className="text-xs text-zinc-400 hover:text-white mt-2 inline-block">
                  {battle.product1.title}
                </Link>
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
                  {new Date(battle.voting_ends_at).toLocaleString()}
                </p>
              )}
            </div>

            <div className="bg-zinc-800/50 rounded-lg p-4 text-right">
              <p className="text-zinc-500 text-xs uppercase mb-1">Producteur 2</p>
              <p className="text-white font-semibold">{battle.producer2?.username || 'Producteur 2'}</p>
              <p className="text-orange-400 text-sm mt-1">{battle.votes_producer2} {t('battles.votes')}</p>
              {battle.product2 && product2Url && (
                <Link to={product2Url} className="text-xs text-zinc-400 hover:text-white mt-2 inline-block">
                  {battle.product2.title}
                </Link>
              )}
            </div>
          </div>

          {battle.status === 'rejected' && battle.rejection_reason && (
            <Card className="bg-red-900/20 border border-red-800">
              <p className="text-sm text-red-300">Refus du producteur invite: {battle.rejection_reason}</p>
            </Card>
          )}

          {battle.status === 'awaiting_admin' && (
            <Card className="bg-sky-900/20 border border-sky-800">
              <p className="text-sm text-sky-300">Battle acceptee par le producteur invite, en attente de validation admin.</p>
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
              <span>{totalVotes} votes</span>
              <span>{producer2Percent.toFixed(0)}%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-zinc-800/30">
              <p className="text-zinc-500 text-xs uppercase mb-2">Produit 1</p>
              {battle.product1 ? (
                <div className="space-y-2">
                  <p className="text-white font-medium">{battle.product1.title}</p>
                  <BattleAudioPlayer
                    src={battle.product1.preview_url}
                    label="Preview producteur 1"
                    playerId={`battle-${battle.id}-product-1`}
                    activePlayerId={activeBattlePlayerId}
                    onActivePlayerChange={setActiveBattlePlayerId}
                  />
                  {product1Url && (
                    <Link to={product1Url} className="text-xs text-zinc-400 hover:text-white">
                      Lien vers la page produit
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">Pas encore assigne.</p>
              )}
            </Card>

            <Card className="bg-zinc-800/30">
              <p className="text-zinc-500 text-xs uppercase mb-2">Produit 2</p>
              {battle.product2 ? (
                <div className="space-y-2">
                  <p className="text-white font-medium">{battle.product2.title}</p>
                  <BattleAudioPlayer
                    src={battle.product2.preview_url}
                    label="Preview producteur 2"
                    playerId={`battle-${battle.id}-product-2`}
                    activePlayerId={activeBattlePlayerId}
                    onActivePlayerChange={setActiveBattlePlayerId}
                  />
                  {product2Url && (
                    <Link to={product2Url} className="text-xs text-zinc-400 hover:text-white">
                      Lien vers la page produit
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">Pas encore assigne.</p>
              )}
            </Card>
          </div>

          <div className="text-xs text-zinc-500 inline-flex items-center gap-1">
            <Users className="w-3 h-3" />
            Battle: {battle.slug}
          </div>
        </Card>

        <VotePanel
          battle={battle}
          onVoteSuccess={fetchBattle}
        />

        <CommentsPanel
          battleId={battle.id}
          commentsOpen={battle.status === 'active' || battle.status === 'voting'}
        />
      </div>
    </div>
  );
}
