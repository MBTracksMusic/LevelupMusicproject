import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, Copy, Share2 } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase/client';
import {
  BattleScoreRadar,
  type BattleScoreRadarScores,
} from '../components/battles/feedback/BattleScoreRadar';
import { useAuth, useUserRole } from '../lib/auth/hooks';
import { deriveRole, type ViewerRole } from '../lib/feedback/deriveRole';
import { trackBattleShare, type BattleShareMethod } from '../lib/analytics';
import { useTranslation } from '../lib/i18n';
import {
  LOSER_SHARE_TEMPLATE_KEYS,
  buildLoserShareMessage,
  canShowLoserShareButton,
  type LoserShareChannel,
  type LoserShareData,
  type LoserShareTemplateKey,
  type LoserShareTrait,
  type RecordLoserShareResult,
} from '../lib/battles/loserShare';

interface FeedbackBattle {
  id: string;
  slug: string;
  title: string;
  status: string;
  battle_tier: string;
  winner_product_id: string | null;
  is_tie: boolean;
  finalized_at: string | null;
  voting_started_at: string | null;
  voting_ended_at: string | null;
  voting_duration_seconds: number | null;
}

interface FeedbackSnapshot {
  product_id: string;
  producer: { id: string; display_name: string | null; avatar_url: string | null };
  votes_total: number;
  votes_for_product: number;
  win_rate: number | string;
  scores: BattleScoreRadarScores;
  coherence_data_sufficient: boolean;
  quality_index: number | string;
  computed_at: string;
  rank: number;
}

interface FeedbackTopCriterion {
  criterion_key: string;
  count: number;
  share: number;
}

interface FeedbackViewer {
  is_authenticated: boolean;
  voted: boolean;
  vote: { criteria: string[] | null; preferred_product_id: string | null } | null;
}

interface FeedbackMeta {
  total_feedback: number;
  total_voters: number;
  battle_size: 'small' | 'medium' | 'large';
  coherence_data_sufficient: boolean;
  credibility_dynamic: boolean;
}

interface FeedbackPayloadOk {
  battle: FeedbackBattle;
  snapshots: FeedbackSnapshot[];
  top_criteria: FeedbackTopCriterion[];
  ranking: Array<{ product_id: string; rank: number; quality_index: number | string }>;
  viewer: FeedbackViewer;
  meta: FeedbackMeta;
}

interface FeedbackPayloadErr {
  error: 'battle_required' | 'battle_not_found' | 'not_finalized' | string;
  status?: string;
}

type FeedbackPayload = FeedbackPayloadOk | FeedbackPayloadErr;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'not_finalized'; status: string | undefined }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; payload: FeedbackPayloadOk };

type LoserShareLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: LoserShareData };

const CACHE_TTL_MS = 60_000;
const SHARE_PREVIEW_VERSION = '4';
const cache = new Map<string, { expires: number; state: LoadState }>();
type SocialShareMethod = Extract<BattleShareMethod, 'x' | 'facebook' | 'linkedin' | 'whatsapp'>;
type ShareTarget = {
  method: SocialShareMethod;
  label: string;
  marker: string;
  href: string;
};
type NativeShare = (data: ShareData) => Promise<void>;
type NavigatorWithOptionalShare = Navigator & { share?: NativeShare };

function isErr(p: FeedbackPayload): p is FeedbackPayloadErr {
  return typeof (p as FeedbackPayloadErr).error === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseLoserShareTrait(value: unknown): LoserShareTrait | null {
  if (!isRecord(value)) return null;
  const criterionKey = value.criterion_key;
  const count = value.count;

  if (typeof criterionKey !== 'string') return null;

  return {
    criterion_key: criterionKey,
    count: typeof count === 'number' ? count : 0,
  };
}

function parseLoserShareData(value: unknown): LoserShareData | null {
  if (!isRecord(value)) return null;

  const topTraits = Array.isArray(value.top_traits)
    ? value.top_traits.map(parseLoserShareTrait).filter((trait): trait is LoserShareTrait => trait !== null)
    : [];

  if (typeof value.error === 'string') {
    return {
      battle_id: '',
      battle_slug: '',
      producer_id: '',
      producer_name: '',
      producer_slug: null,
      opponent_id: '',
      opponent_name: '',
      opponent_slug: null,
      top_traits: topTraits,
      share_url: '',
      is_loser_role: false,
      error: value.error,
    };
  }

  if (
    typeof value.battle_id !== 'string'
    || typeof value.battle_slug !== 'string'
    || typeof value.producer_id !== 'string'
    || typeof value.producer_name !== 'string'
    || typeof value.opponent_id !== 'string'
    || typeof value.opponent_name !== 'string'
    || typeof value.share_url !== 'string'
    || value.is_loser_role !== true
  ) {
    return null;
  }

  return {
    battle_id: value.battle_id,
    battle_slug: value.battle_slug,
    producer_id: value.producer_id,
    producer_name: value.producer_name,
    producer_slug: typeof value.producer_slug === 'string' ? value.producer_slug : null,
    opponent_id: value.opponent_id,
    opponent_name: value.opponent_name,
    opponent_slug: typeof value.opponent_slug === 'string' ? value.opponent_slug : null,
    top_traits: topTraits,
    share_url: value.share_url,
    is_loser_role: true,
  };
}

function parseRecordLoserShareResult(value: unknown): RecordLoserShareResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.share_event_id !== 'string') return null;

  return {
    share_event_id: value.share_event_id,
    xp_awarded: value.xp_awarded === true,
    xp_delta: typeof value.xp_delta === 'number' ? value.xp_delta : 0,
    reputation_event_id: typeof value.reputation_event_id === 'string' ? value.reputation_event_id : null,
    skipped_reason: typeof value.skipped_reason === 'string' ? value.skipped_reason : null,
  };
}

async function fetchLoserShareData(battleId: string): Promise<LoserShareData> {
  const { data, error } = await supabase.rpc('get_loser_share_data', { p_battle_id: battleId });

  if (error) {
    throw new Error(error.message);
  }

  const parsed = parseLoserShareData(data);
  if (!parsed || parsed.error || !parsed.is_loser_role) {
    throw new Error(parsed?.error ?? 'loser_share_unavailable');
  }

  return parsed;
}

async function recordLoserBattleShare(
  battleId: string,
  shareChannel: LoserShareChannel,
  templateKey: LoserShareTemplateKey,
) {
  const { data, error } = await supabase.rpc('record_loser_battle_share', {
    p_battle_id: battleId,
    p_share_channel: shareChannel,
    p_template_used: templateKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  const parsed = parseRecordLoserShareResult(data);
  if (!parsed) {
    throw new Error('invalid_share_response');
  }

  return parsed;
}

async function fetchFeedback(slug: string): Promise<LoadState> {
  const { data: battle, error: battleErr } = await supabase
    .from('battles')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (battleErr) {
    return { kind: 'error', message: battleErr.message };
  }
  if (!battle) {
    return { kind: 'not_found' };
  }

  const { data, error } = await supabase.rpc('get_battle_feedback_payload', {
    p_battle_id: battle.id,
  });

  if (error) {
    return { kind: 'error', message: error.message };
  }

  const payload = data as unknown as FeedbackPayload;
  if (isErr(payload)) {
    if (payload.error === 'not_finalized') {
      return { kind: 'not_finalized', status: payload.status };
    }
    if (payload.error === 'battle_not_found') {
      return { kind: 'not_found' };
    }
    return { kind: 'error', message: payload.error };
  }
  return { kind: 'ok', payload };
}

function useFeedbackPayload(slug: string | undefined): { state: LoadState; refetch: () => void } {
  const cached = slug ? cache.get(slug) : undefined;
  const initial: LoadState =
    cached && cached.expires > Date.now() ? cached.state : { kind: 'loading' };
  const [state, setState] = useState<LoadState>(initial);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!slug) return;
    const hit = cache.get(slug);
    if (hit && hit.expires > Date.now() && nonce === 0) {
      setState(hit.state);
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchFeedback(slug).then((next) => {
      if (cancelled) return;
      cache.set(slug, { state: next, expires: Date.now() + CACHE_TTL_MS });
      setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, nonce]);

  return { state, refetch: () => setNonce((n) => n + 1) };
}

function splitSnapshots(payload: FeedbackPayloadOk) {
  const { battle, snapshots } = payload;
  if (battle.is_tie || battle.winner_product_id == null) {
    return { winner: snapshots[0], opponent: snapshots[1] };
  }
  const winner = snapshots.find((s) => s.product_id === battle.winner_product_id);
  const opponent = snapshots.find((s) => s.product_id !== battle.winner_product_id);
  return { winner: winner ?? snapshots[0], opponent: opponent ?? snapshots[1] };
}

function buildShareText(payload: FeedbackPayloadOk): string {
  const { battle } = payload;
  if (battle.is_tie) {
    const [p1, p2] = payload.snapshots;
    const n1 = p1?.producer.display_name ?? 'Producer 1';
    const n2 = p2?.producer.display_name ?? 'Producer 2';
    return `🤝 Match nul entre ${n1} et ${n2} dans "${battle.title}" sur Beatelion`;
  }
  const winner = payload.snapshots.find((s) => s.product_id === battle.winner_product_id);
  const winnerName = winner?.producer.display_name ?? 'Le gagnant';
  return `🏆 ${winnerName} remporte la battle "${battle.title}" sur Beatelion`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getNativeShare(): NativeShare | null {
  if (typeof navigator === 'undefined') return null;
  const share = (navigator as NavigatorWithOptionalShare).share;
  return typeof share === 'function' ? share.bind(navigator) : null;
}

function buildSocialShareTargets(
  shareText: string,
  shareUrl: string,
  options: { textIncludesUrl?: boolean } = {},
): ShareTarget[] {
  const text = encodeURIComponent(shareText);
  const url = encodeURIComponent(shareUrl);
  const textWithUrl = options.textIncludesUrl
    ? text
    : encodeURIComponent(`${shareText} ${shareUrl}`);

  return [
    {
      method: 'x',
      label: 'X',
      marker: 'X',
      href: options.textIncludesUrl
        ? `https://twitter.com/intent/tweet?text=${text}`
        : `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    },
    {
      method: 'facebook',
      label: 'Facebook',
      marker: 'f',
      href: `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`,
    },
    {
      method: 'linkedin',
      label: 'LinkedIn',
      marker: 'in',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    },
    {
      method: 'whatsapp',
      label: 'WhatsApp',
      marker: 'WA',
      href: `https://wa.me/?text=${textWithUrl}`,
    },
  ];
}

function ProducerCard({
  snapshot,
  variant,
  highlight,
  credibilityDynamic,
  size,
}: {
  snapshot: FeedbackSnapshot;
  variant: 'primary' | 'secondary';
  highlight: 'winner' | 'loser' | 'tie' | 'none';
  credibilityDynamic: boolean;
  size: number;
}) {
  const name = snapshot.producer.display_name ?? 'Producer';
  const badge =
    highlight === 'winner' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        Gagnant
      </span>
    ) : highlight === 'tie' ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
        Match nul
      </span>
    ) : null;

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4">
      <BattleScoreRadar
        scores={snapshot.scores}
        size={size}
        variant={variant}
        coherenceDataSufficient={snapshot.coherence_data_sufficient}
        credibilityDynamic={credibilityDynamic}
        ariaLabel={`Radar ${name}`}
      />
      <div className="text-center">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm font-medium text-zinc-100">
          <span>{name}</span>
          {badge}
        </p>
        <p className="mt-1 text-xs text-zinc-500 font-mono">
          quality {Number(snapshot.quality_index).toFixed(1)} · {snapshot.votes_for_product}/
          {snapshot.votes_total} votes
        </p>
      </div>
    </div>
  );
}

function TopCriteria({ items }: { items: FeedbackTopCriterion[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">
        Top critères qui ont fait la différence
      </h3>
      <ul className="space-y-2">
        {items.map((c) => (
          <li
            key={c.criterion_key}
            className="flex items-center justify-between text-sm text-zinc-200"
          >
            <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
              {c.criterion_key}
            </span>
            <span className="text-zinc-300">
              {c.count} <span className="text-zinc-500">({Math.round(c.share * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoserShareModal({
  battleId,
  isOpen,
  onClose,
}: {
  battleId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loadState, setLoadState] = useState<LoserShareLoadState>({ kind: 'idle' });
  const [selectedTemplate, setSelectedTemplate] = useState<LoserShareTemplateKey>('neutral');
  const [draftText, setDraftText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setLoadState({ kind: 'idle' });
      setSelectedTemplate('neutral');
      setDraftText('');
      setIsSubmitting(false);
      return;
    }

    let cancelled = false;
    setLoadState({ kind: 'loading' });
    fetchLoserShareData(battleId)
      .then((data) => {
        if (cancelled) return;
        setLoadState({ kind: 'ok', data });
        setSelectedTemplate('neutral');
        setDraftText(buildLoserShareMessage('neutral', data, t));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'loser_share_unavailable';
        setLoadState({ kind: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [battleId, isOpen, t]);

  const shareData = loadState.kind === 'ok' ? loadState.data : null;
  const shareTargets = useMemo(
    () => buildSocialShareTargets(draftText, shareData?.share_url ?? '', { textIncludesUrl: true }),
    [draftText, shareData?.share_url],
  );

  const selectTemplate = (templateKey: LoserShareTemplateKey) => {
    setSelectedTemplate(templateKey);
    if (shareData) {
      setDraftText(buildLoserShareMessage(templateKey, shareData, t));
    }
  };

  const showShareToast = (result: RecordLoserShareResult) => {
    toast.success(result.xp_awarded ? t('battleFeedback.share.storytellerXp') : t('battleFeedback.share.shared'));
  };

  const recordShare = async (shareChannel: LoserShareChannel) => {
    const result = await recordLoserBattleShare(battleId, shareChannel, selectedTemplate);
    showShareToast(result);
  };

  const onSocialShare = (target: ShareTarget) => {
    if (!shareData || !draftText.trim()) return;

    const opened = window.open('', '_blank', 'width=720,height=640');
    if (opened) {
      opened.opener = null;
      opened.location.href = target.href;
      opened.focus();
      onClose();
      void recordShare(target.method).catch((error: unknown) => {
        console.error('Unable to record loser battle share:', error);
        toast.error(t('battleFeedback.share.unavailable'));
      });
    } else {
      onClose();
      void recordShare(target.method)
        .catch((error: unknown) => {
          console.error('Unable to record loser battle share:', error);
          toast.error(t('battleFeedback.share.unavailable'));
        })
        .finally(() => {
          window.location.assign(target.href);
        });
    }
  };

  const onCopy = async () => {
    if (!shareData || !draftText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await navigator.clipboard.writeText(draftText);
      toast.success(t('battleFeedback.share.copied'));
      const result = await recordLoserBattleShare(battleId, 'copy', selectedTemplate);
      showShareToast(result);
      onClose();
    } catch (error) {
      console.error('Unable to copy loser battle share:', error);
      toast.error(t('battleFeedback.share.unavailable'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('battleFeedback.share.modalTitle')}
      description={t('battleFeedback.share.modalDescription')}
      size="lg"
    >
      {loadState.kind === 'loading' || loadState.kind === 'idle' ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
          {t('battleFeedback.share.loading')}
        </div>
      ) : loadState.kind === 'error' ? (
        <div className="space-y-4">
          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {t('battleFeedback.share.unavailable')}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadState({ kind: 'loading' });
              fetchLoserShareData(battleId)
                .then((data) => {
                  setLoadState({ kind: 'ok', data });
                  setDraftText(buildLoserShareMessage(selectedTemplate, data, t));
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : loadState.message;
                  setLoadState({ kind: 'error', message });
                });
            }}
            className="inline-flex items-center justify-center rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
          >
            {t('battleFeedback.share.retry')}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <fieldset className="space-y-3">
            {LOSER_SHARE_TEMPLATE_KEYS.map((templateKey) => (
              <label
                key={templateKey}
                className="flex cursor-pointer gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 transition-colors hover:border-zinc-600"
              >
                <input
                  type="radio"
                  name="loser-share-template"
                  value={templateKey}
                  checked={selectedTemplate === templateKey}
                  onChange={() => selectTemplate(templateKey)}
                  className="mt-1 h-4 w-4 accent-[var(--brand-primary)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-100">
                    {t(`battleFeedback.share.templateLabels.${templateKey}`)}
                  </span>
                  <span className="mt-1 block text-sm text-zinc-400">
                    {t(`battleFeedback.share.templateDescriptions.${templateKey}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-zinc-200">
              {t('battleFeedback.share.textareaLabel')}
            </span>
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--brand-primary)]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            {shareTargets.map((target) => (
              <button
                key={target.method}
                type="button"
                onClick={() => onSocialShare(target)}
                disabled={!draftText.trim()}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-black text-zinc-950">
                  {target.marker}
                </span>
                {t('battleFeedback.share.shareOn', { channel: target.label })}
              </button>
            ))}

            <button
              type="button"
              onClick={() => void onCopy()}
              disabled={!draftText.trim() || isSubmitting}
              className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy className="h-5 w-5 text-zinc-300" />
              {t('battleFeedback.share.copyText')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RoleCTA({
  role,
  battleId,
  battleStatus,
  winnerProductId,
  isTie,
  shareTitle,
  shareText,
  shareUrl,
  slug,
}: {
  role: ViewerRole;
  battleId: string;
  battleStatus: string;
  winnerProductId: string | null;
  isTie: boolean;
  shareTitle: string;
  shareText: string;
  shareUrl: string;
  slug: string;
}) {
  const { t } = useTranslation();
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied'>('idle');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoserShareModalOpen, setIsLoserShareModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSharing = shareState === 'sharing';
  const isCopied = shareState === 'copied';
  const nativeShare = getNativeShare();
  const shareTargets = useMemo(
    () => buildSocialShareTargets(shareText, shareUrl),
    [shareText, shareUrl],
  );

  useEffect(() => {
    if (!isMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setIsMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMenuOpen]);

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    trackBattleShare({ battleId, method: 'clipboard' });
    setIsMenuOpen(false);
    setShareState('copied');
    toast.success('Lien copié.');
    window.setTimeout(() => setShareState('idle'), 2000);
  };

  const onNativeShare = async () => {
    if (isSharing) return;
    setShareState('sharing');

    try {
      if (!nativeShare) {
        await copyShareLink();
        return;
      }

      await nativeShare({
        title: shareTitle,
        text: shareText,
        url: shareUrl,
      });
      trackBattleShare({ battleId, method: 'native' });
      setIsMenuOpen(false);
      setShareState('idle');
    } catch (shareError) {
      if (isAbortError(shareError)) {
        setShareState('idle');
        return;
      }
      console.error('Unable to share battle feedback:', shareError);
      toast.error('Partage indisponible pour le moment.');
      setShareState('idle');
    }
  };

  const onSocialShare = (target: ShareTarget) => {
    setIsMenuOpen(false);
    trackBattleShare({ battleId, method: target.method });

    const opened = window.open('', '_blank', 'width=720,height=640');
    if (opened) {
      opened.opener = null;
      opened.location.href = target.href;
      opened.focus();
      return;
    }

    window.location.assign(target.href);
  };

  const renderShareMenu = () => (
    <div className="absolute bottom-full left-1/2 z-30 mb-3 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950 p-2 shadow-2xl">
      <div className="grid grid-cols-2 gap-2">
        {shareTargets.map((target) => (
          <button
            key={target.method}
            type="button"
            onClick={() => onSocialShare(target)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-black text-zinc-950">
              {target.marker}
            </span>
            {target.label}
          </button>
        ))}

        {nativeShare && (
          <button
            type="button"
            onClick={() => void onNativeShare()}
            disabled={isSharing}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Share2 className="h-5 w-5 text-zinc-300" />
            Autres apps
          </button>
        )}

        <button
          type="button"
          onClick={() => void copyShareLink()}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
        >
          {isCopied ? (
            <Check className="h-5 w-5 text-emerald-400" />
          ) : (
            <Copy className="h-5 w-5 text-zinc-300" />
          )}
          Copier le lien
        </button>
      </div>
    </div>
  );

  const showLoserShare = canShowLoserShareButton({
    role,
    status: battleStatus,
    winnerProductId,
    isTie,
  });

  if (role === 'winner') {
    return (
      <div ref={containerRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          disabled={isSharing}
          aria-expanded={isMenuOpen}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white shadow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {isCopied ? 'Lien copié' : 'Partager ma victoire'}
        </button>
        {isMenuOpen && renderShareMenu()}
      </div>
    );
  }
  if (role === 'admin') {
    return (
      <div ref={containerRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          disabled={isSharing}
          aria-expanded={isMenuOpen}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white shadow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {isCopied ? 'Lien copié' : 'Partager le résultat'}
        </button>
        {isMenuOpen && renderShareMenu()}
      </div>
    );
  }
  if (showLoserShare) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setIsLoserShareModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white shadow hover:opacity-90"
        >
          <Share2 className="h-4 w-4" />
          {t('battleFeedback.share.openModal')}
        </button>
        <Link
          to="/battles"
          className="inline-flex items-center justify-center rounded-md border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
        >
          Recommencer une battle
        </Link>
        <LoserShareModal
          battleId={battleId}
          isOpen={isLoserShareModalOpen}
          onClose={() => setIsLoserShareModalOpen(false)}
        />
      </div>
    );
  }
  if (role === 'tie_participant') {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <div ref={containerRef} className="relative inline-flex">
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            disabled={isSharing}
            aria-expanded={isMenuOpen}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-500/90 px-5 py-3 text-sm font-semibold text-zinc-950 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {isCopied ? 'Lien copié' : 'Match nul honorable'}
          </button>
          {isMenuOpen && renderShareMenu()}
        </div>
        <Link
          to={`/battles/${slug}`}
          className="inline-flex items-center justify-center rounded-md border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
        >
          Rejouer
        </Link>
      </div>
    );
  }
  if (role === 'visitor_auth') {
    return (
      <Link
        to="/battles"
        className="inline-flex items-center justify-center rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
      >
        Voter sur la prochaine battle
      </Link>
    );
  }
  return (
    <Link
      to="/register"
      className="inline-flex items-center justify-center rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
    >
      Inscris-toi pour voter
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-8 md:px-8">
      <div className="mb-6 h-7 w-2/3 animate-pulse rounded bg-zinc-800/60" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-6"
          >
            <div className="h-[280px] w-[280px] animate-pulse rounded-full bg-zinc-800/40" />
            <div className="h-4 w-32 animate-pulse rounded bg-zinc-800/60" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { label: string; to: string } | { label: string; onClick: () => void };
}) {
  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-16 text-center md:px-8">
      <h1 className="mb-3 text-2xl font-bold text-zinc-100">{title}</h1>
      <p className="mb-6 text-zinc-400">{body}</p>
      {'to' in cta ? (
        <Link
          to={cta.to}
          className="inline-flex items-center justify-center rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          {cta.label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={cta.onClick}
          className="inline-flex items-center justify-center rounded-md bg-[var(--brand-primary)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

export function BattleFeedbackPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const userRole = useUserRole();
  const { state, refetch } = useFeedbackPayload(slug);

  const [radarSize, setRadarSize] = useState<number>(280);
  useEffect(() => {
    const apply = () => setRadarSize(window.matchMedia('(min-width: 768px)').matches ? 320 : 280);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const viewerRole: ViewerRole = useMemo(() => {
    if (state.kind !== 'ok') return user ? 'visitor_auth' : 'visitor_anon';
    return deriveRole({
      userId: user?.id,
      userRole,
      battle: state.payload.battle,
      snapshots: state.payload.snapshots,
    });
  }, [state, user, userRole]);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  useEffect(() => {
    if (viewerRole !== 'admin') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setShowAdminPanel((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerRole]);

  if (!slug) {
    return (
      <MessageState
        title="Battle introuvable"
        body="L'URL ne contient pas de slug de battle."
        cta={{ label: 'Voir les battles', to: '/battles' }}
      />
    );
  }

  if (state.kind === 'loading') return <LoadingSkeleton />;

  if (state.kind === 'not_found') {
    return (
      <MessageState
        title="Battle introuvable"
        body="Cette battle n'existe pas ou n'est plus accessible."
        cta={{ label: 'Voir les battles', to: '/battles' }}
      />
    );
  }

  if (state.kind === 'not_finalized') {
    return (
      <MessageState
        title="Battle en cours"
        body="Les résultats détaillés seront disponibles à la fin du vote."
        cta={{ label: 'Voir la battle', to: `/battles/${slug}` }}
      />
    );
  }

  if (state.kind === 'error') {
    return (
      <MessageState
        title="Une erreur est survenue"
        body={state.message}
        cta={{ label: 'Réessayer', onClick: refetch }}
      />
    );
  }

  const { payload } = state;
  const { battle, snapshots, top_criteria, meta } = payload;

  if (snapshots.length === 0) {
    return (
      <MessageState
        title="Pas encore de données"
        body="Les statistiques de cette battle ne sont pas encore disponibles."
        cta={{ label: 'Voir la battle', to: `/battles/${slug}` }}
      />
    );
  }

  const { winner, opponent } = splitSnapshots(payload);
  const shareUrl = `${window.location.origin}/share/battle/${slug}/feedback?v=${SHARE_PREVIEW_VERSION}`;
  const shareText = buildShareText(payload);

  return (
    <div className="min-h-screen bg-[var(--brand-bg)] text-zinc-100">
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 md:px-8">
        <Link
          to={`/battles/${slug}`}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Voir la battle
        </Link>
        <header className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
              {battle.is_tie ? 'Match nul' : 'Terminée'}
            </span>
            <span className="text-xs text-zinc-500">
              {meta.total_voters} votes · {meta.total_feedback} feedbacks
            </span>
          </div>
          <h1 className="text-2xl font-bold text-zinc-50 md:text-3xl">{battle.title}</h1>
        </header>

        <section className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {winner && (
            <ProducerCard
              snapshot={winner}
              variant="primary"
              highlight={battle.is_tie ? 'tie' : 'winner'}
              credibilityDynamic={meta.credibility_dynamic}
              size={radarSize}
            />
          )}
          {opponent && (
            <ProducerCard
              snapshot={opponent}
              variant="secondary"
              highlight={battle.is_tie ? 'tie' : 'loser'}
              credibilityDynamic={meta.credibility_dynamic}
              size={radarSize}
            />
          )}
        </section>

        {(viewerRole === 'loser' || viewerRole === 'admin') && (
          <div className="mb-8">
            <TopCriteria items={top_criteria} />
          </div>
        )}

        <section className="mb-8 flex flex-col items-center gap-3">
          <RoleCTA
            role={viewerRole}
            battleId={battle.id}
            battleStatus={battle.status}
            winnerProductId={battle.winner_product_id}
            isTie={battle.is_tie}
            shareTitle={battle.title}
            shareText={shareText}
            shareUrl={shareUrl}
            slug={slug}
          />
        </section>

        {(viewerRole === 'winner' || viewerRole === 'tie_participant' || viewerRole === 'loser') && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur md:hidden">
            <div className="mx-auto flex max-w-5xl items-center justify-center">
              <RoleCTA
                role={viewerRole}
                battleId={battle.id}
                battleStatus={battle.status}
                winnerProductId={battle.winner_product_id}
                isTie={battle.is_tie}
                shareTitle={battle.title}
                shareText={shareText}
                shareUrl={shareUrl}
                slug={slug}
              />
            </div>
          </div>
        )}

        {viewerRole === 'admin' && showAdminPanel && (
          <aside className="fixed bottom-4 right-4 z-30 max-h-[70vh] w-[min(420px,calc(100vw-2rem))] overflow-auto rounded-lg border border-amber-500/40 bg-zinc-950/95 p-4 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Admin debug · Cmd+Shift+D
              </h2>
              <button
                type="button"
                onClick={() => setShowAdminPanel(false)}
                className="text-xs text-zinc-500 hover:text-zinc-200"
              >
                close
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-all text-[10px] text-zinc-400">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </aside>
        )}
      </div>
    </div>
  );
}
