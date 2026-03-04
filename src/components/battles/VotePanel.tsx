import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useAuth, useIsEmailVerified } from '../../lib/auth/hooks';
import { useTranslation, type TranslateFn } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import type { BattleWithRelations } from '../../lib/supabase/types';

interface VotePanelProps {
  battle: Pick<BattleWithRelations, 'id' | 'status' | 'producer1_id' | 'producer2_id'> & {
    producer1?: { username: string | null };
    producer2?: { username: string | null };
  };
  onVoteSuccess?: () => Promise<void> | void;
}

const isVotingOpen = (status: BattleWithRelations['status']) => status === 'active';

function toVoteMessage(message: string, t: TranslateFn) {
  if (message.includes('already_voted')) return t('battles.alreadyVoted');
  if (message.includes('vote_not_allowed_unverified_email')) return t('battles.voteVerifyEmailRequired');
  if (message.includes('vote_not_allowed_unconfirmed_user')) return t('battles.mustBeConfirmed');
  if (message.includes('participants_cannot_vote')) return t('battles.participantsCannotVote');
  if (message.includes('battle_not_open_for_voting')) return t('battles.votingClosed');
  if (message.includes('invalid_vote_target')) return t('battles.invalidVoteTarget');
  if (message.includes('auth_required')) return t('battles.voteLoginRequired');
  return t('battles.voteUnavailable');
}

export function VotePanel({ battle, onVoteSuccess }: VotePanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isEmailVerified = useIsEmailVerified();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingVote, setIsLoadingVote] = useState(false);
  const [userVote, setUserVote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const voteDisabledReason = useMemo(() => {
    if (!user) return t('battles.voteLoginRequired');
    if (!isEmailVerified) return t('battles.voteVerifyEmailRequired');
    if (!isVotingOpen(battle.status)) return t('battles.votingClosed');
    if (!battle.producer1_id || !battle.producer2_id) return t('battles.voteBattleNotReady');
    return null;
  }, [battle.producer1_id, battle.producer2_id, battle.status, isEmailVerified, t, user]);

  useEffect(() => {
    let isCancelled = false;

    async function fetchUserVote() {
      if (!user?.id || !battle.id) {
        if (!isCancelled) {
          setUserVote(null);
        }
        return;
      }

      setIsLoadingVote(true);
      const { data, error: fetchError } = await supabase
        .from('battle_votes')
        .select('voted_for_producer_id')
        .eq('battle_id', battle.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!isCancelled) {
        if (fetchError) {
          console.error('Error fetching current user vote:', fetchError);
          setUserVote(null);
        } else {
          setUserVote(data?.voted_for_producer_id || null);
        }
        setIsLoadingVote(false);
      }
    }

    void fetchUserVote();

    return () => {
      isCancelled = true;
    };
  }, [battle.id, user?.id]);

  const submitVote = async (votedForProducerId: string) => {
    if (!user?.id) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const { error: rpcError } = await supabase.rpc('record_battle_vote', {
        p_battle_id: battle.id,
        p_user_id: user.id,
        p_voted_for_producer_id: votedForProducerId,
      });

      if (rpcError) {
        throw rpcError;
      }

      setUserVote(votedForProducerId);
      await onVoteSuccess?.();
    } catch (voteErr) {
      const message = voteErr instanceof Error ? voteErr.message : t('battles.voteUnavailable');
      setError(toVoteMessage(message, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{t('battles.vote')}</h2>

      {voteDisabledReason && (
        <p className="text-sm text-zinc-400">{voteDisabledReason}</p>
      )}

      {!voteDisabledReason && isLoadingVote && (
        <p className="text-sm text-zinc-400">{t('common.loading')}</p>
      )}

      {!voteDisabledReason && !isLoadingVote && userVote && (
        <div className="flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          <span>
            {t('battles.alreadyVoted')} -{' '}
            {userVote === battle.producer1_id
              ? (battle.producer1?.username || t('battleDetail.producer1Fallback'))
              : (battle.producer2?.username || t('battleDetail.producer2Fallback'))}
          </span>
        </div>
      )}

      {!voteDisabledReason && !isLoadingVote && !userVote && (
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            isLoading={isSubmitting}
            onClick={() => submitVote(battle.producer1_id)}
          >
            {t('battles.voteFor', {
              name: battle.producer1?.username || t('battleDetail.producer1Fallback'),
            })}
          </Button>
          <Button
            variant="outline"
            isLoading={isSubmitting}
            onClick={() => battle.producer2_id && submitVote(battle.producer2_id)}
          >
            {t('battles.voteFor', {
              name: battle.producer2?.username || t('battleDetail.producer2Fallback'),
            })}
          </Button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}
    </Card>
  );
}
