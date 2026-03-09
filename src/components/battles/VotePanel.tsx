import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { BattleVoteFeedbackModal } from './BattleVoteFeedbackModal';
import { useAuth, useIsEmailVerified } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
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

export function VotePanel({ battle, onVoteSuccess }: VotePanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isEmailVerified = useIsEmailVerified();
  const [isLoadingVote, setIsLoadingVote] = useState(false);
  const [userVote, setUserVote] = useState<string | null>(null);
  const [selectedProducerId, setSelectedProducerId] = useState<string | null>(null);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  const voteDisabledReason = useMemo(() => {
    if (!user) return t('battles.voteLoginRequired');
    if (!isEmailVerified) return t('battles.voteVerifyEmailRequired');
    if (!isVotingOpen(battle.status)) return t('battles.votingClosed');
    if (!battle.producer1_id || !battle.producer2_id) return t('battles.voteBattleNotReady');
    if (user.id === battle.producer1_id || user.id === battle.producer2_id) return t('battles.participantsCannotVote');
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

  const openFeedbackModal = (winnerProducerId: string) => {
    if (!user?.id) return;
    setSelectedProducerId(winnerProducerId);
    setIsFeedbackModalOpen(true);
  };

  const closeFeedbackModal = () => {
    setIsFeedbackModalOpen(false);
    setSelectedProducerId(null);
  };

  const handleVoteWithFeedbackSuccess = async (winnerProducerId: string) => {
    setUserVote(winnerProducerId);
    try {
      await onVoteSuccess?.();
    } catch (refreshError) {
      console.error('Error refreshing battle after vote-with-feedback flow:', refreshError);
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{t('battles.vote')}</h2>

      {voteDisabledReason && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-400">{voteDisabledReason}</p>
          {!user && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/login', { state: { from: { pathname: location.pathname } } })}
            >
              {t('auth.loginButton')}
            </Button>
          )}
        </div>
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
            disabled={isFeedbackModalOpen}
            onClick={() => openFeedbackModal(battle.producer1_id)}
          >
            {t('battles.voteFor', {
              name: battle.producer1?.username || t('battleDetail.producer1Fallback'),
            })}
          </Button>
          <Button
            variant="outline"
            disabled={isFeedbackModalOpen}
            onClick={() => battle.producer2_id && openFeedbackModal(battle.producer2_id)}
          >
            {t('battles.voteFor', {
              name: battle.producer2?.username || t('battleDetail.producer2Fallback'),
            })}
          </Button>
        </div>
      )}

      <BattleVoteFeedbackModal
        isOpen={isFeedbackModalOpen}
        battleId={battle.id}
        winnerProducerId={selectedProducerId}
        onSubmitSuccess={(winnerProducerId) => void handleVoteWithFeedbackSuccess(winnerProducerId)}
        onClose={closeFeedbackModal}
      />
    </Card>
  );
}
