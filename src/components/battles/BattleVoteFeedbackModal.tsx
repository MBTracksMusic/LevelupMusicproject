import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useTranslation, type TranslateFn } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';

const FEEDBACK_CRITERIA = [
  'groove',
  'melody',
  'ambience',
  'sound_design',
  'drums',
  'mix',
  'originality',
  'energy',
  'artistic_vibe',
] as const;

type FeedbackCriterion = (typeof FEEDBACK_CRITERIA)[number];

interface BattleVoteFeedbackModalProps {
  isOpen: boolean;
  battleId: string;
  winnerProducerId: string | null;
  onSubmitSuccess?: (winnerProducerId: string) => Promise<void> | void;
  onClose: () => void;
}

function toVoteWithFeedbackErrorMessage(message: string, t: TranslateFn) {
  if (message.includes('already_voted')) return t('battles.alreadyVoted');
  if (message.includes('vote_not_allowed_unverified_email')) return t('battles.voteVerifyEmailRequired');
  if (message.includes('vote_not_allowed_unconfirmed_user')) return t('battles.mustBeConfirmed');
  if (message.includes('account_too_new')) return t('battles.accountTooNew');
  if (message.includes('participants_cannot_vote')) return t('battles.participantsCannotVote');
  if (message.includes('self_vote_not_allowed')) return t('battles.participantsCannotVote');
  if (message.includes('battle_not_open_for_voting')) return t('battles.votingClosed');
  if (message.includes('battle_not_started')) return t('battles.votingClosed');
  if (message.includes('battle_voting_expired')) return t('battles.votingClosed');
  if (message.includes('battle_not_ready_for_voting')) return t('battles.voteBattleNotReady');
  if (message.includes('battle_not_found')) return t('battles.voteUnavailable');
  if (message.includes('vote_cooldown')) return t('battles.voteCooldown');
  if (message.includes('invalid_vote_target')) return t('battles.invalidVoteTarget');
  if (message.includes('auth_required')) return t('battles.voteLoginRequired');
  if (message.includes('not_authenticated')) return t('battles.voteLoginRequired');
  if (message.includes('rate_limit_exceeded')) return t('battles.tooManyActions');
  if (message.includes('winner_product_not_found')) return t('battles.voteUnavailable');
  if (message.includes('invalid_feedback_payload')) return t('battles.feedbackUnavailable');
  if (message.includes('feedback_empty')) return t('battles.feedbackSelectAtLeastOne');
  if (message.includes('feedback_already_submitted')) return t('battles.feedbackAlreadySubmitted');
  if (message.includes('feedback_max_3_criteria')) return t('battles.feedbackMaxThree');
  if (message.includes('feedback_invalid_criterion')) return t('battles.feedbackInvalidCriterion');
  if (message.includes('feedback_winner_mismatch')) return t('battles.feedbackWinnerMismatch');
  if (message.includes('vote_not_found')) return t('battles.feedbackVoteNotFound');
  return t('battles.feedbackUnavailable');
}

function getRpcErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return fallback;
}

function getCriterionLabel(criterion: FeedbackCriterion, t: TranslateFn) {
  switch (criterion) {
    case 'groove':
      return t('battles.feedbackCriteria.groove');
    case 'melody':
      return t('battles.feedbackCriteria.melody');
    case 'ambience':
      return t('battles.feedbackCriteria.ambience');
    case 'sound_design':
      return t('battles.feedbackCriteria.sound_design');
    case 'drums':
      return t('battles.feedbackCriteria.drums');
    case 'mix':
      return t('battles.feedbackCriteria.mix');
    case 'originality':
      return t('battles.feedbackCriteria.originality');
    case 'energy':
      return t('battles.feedbackCriteria.energy');
    case 'artistic_vibe':
      return t('battles.feedbackCriteria.artistic_vibe');
    default:
      return criterion;
  }
}

export function BattleVoteFeedbackModal({
  isOpen,
  battleId,
  winnerProducerId,
  onSubmitSuccess,
  onClose,
}: BattleVoteFeedbackModalProps) {
  const { t } = useTranslation();
  const [selectedCriteria, setSelectedCriteria] = useState<FeedbackCriterion[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSelectedCriteria([]);
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen]);

  const selectedCount = selectedCriteria.length;

  const canSubmit = useMemo(
    () => Boolean(winnerProducerId) && selectedCount > 0 && selectedCount <= 3 && !isSubmitting,
    [isSubmitting, selectedCount, winnerProducerId]
  );

  const toggleCriterion = (criterion: FeedbackCriterion) => {
    setError(null);

    setSelectedCriteria((current) => {
      if (current.includes(criterion)) {
        return current.filter((value) => value !== criterion);
      }

      if (current.length >= 3) {
        setError(t('battles.feedbackMaxThree'));
        return current;
      }

      return [...current, criterion];
    });
  };

  const submitFeedback = async () => {
    if (!winnerProducerId) {
      setError(t('battles.feedbackUnavailable'));
      return;
    }

    if (selectedCriteria.length === 0) {
      setError(t('battles.feedbackSelectAtLeastOne'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: rpcError } = await supabase.rpc(
        'rpc_vote_with_feedback' as never,
        {
          p_battle_id: battleId,
          p_winner_producer_id: winnerProducerId,
          p_criteria: selectedCriteria,
        } as never
      );

      if (rpcError) {
        throw rpcError;
      }

      if (onSubmitSuccess) {
        try {
          await onSubmitSuccess(winnerProducerId);
        } catch (successHandlerError) {
          console.error('Error handling vote-with-feedback success callback:', successHandlerError);
        }
      }
      toast.success(t('battles.feedbackSubmitSuccess'));
      onClose();
    } catch (submitErr) {
      const message = getRpcErrorMessage(submitErr, t('battles.feedbackUnavailable'));
      const translatedMessage = toVoteWithFeedbackErrorMessage(message, t);
      setError(translatedMessage);
      console.error('Vote-with-feedback RPC failed:', message, submitErr);

      if (message.includes('already_voted') || message.includes('feedback_already_submitted')) {
        toast(translatedMessage);
      } else if (message.includes('rate_limit_exceeded')) {
        toast.error(translatedMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('battles.feedbackTitle')}
      description={t('battles.feedbackSubtitle')}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          {t('battles.feedbackHelp')} {t('battles.feedbackSelectedCount', { count: selectedCount })}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FEEDBACK_CRITERIA.map((criterion) => {
            const isSelected = selectedCriteria.includes(criterion);
            return (
              <button
                key={criterion}
                type="button"
                onClick={() => toggleCriterion(criterion)}
                disabled={!isSelected && selectedCount >= 3}
                className={[
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'border-rose-500/80 bg-rose-500/20 text-rose-100'
                    : 'border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-500 hover:text-white',
                  !isSelected && selectedCount >= 3 ? 'opacity-60 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {getCriterionLabel(criterion, t)}
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-amber-400">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('battles.feedbackSkip')}
          </Button>
          <Button onClick={() => void submitFeedback()} isLoading={isSubmitting} disabled={!canSubmit}>
            {t('battles.feedbackSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
