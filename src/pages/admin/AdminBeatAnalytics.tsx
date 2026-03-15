import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime } from '../../lib/utils/format';

interface TopCriterion {
  criterion: string;
  count: number;
  rank: number;
}

interface BeatFeedbackOverviewRow {
  battle_id: string;
  battle_slug: string | null;
  battle_title: string | null;
  battle_status: string | null;
  product_id: string;
  product_title: string | null;
  producer_id: string | null;
  producer_username: string | null;
  quality_index: number;
  preference_score: number;
  artistic_score: number;
  coherence_score: number;
  credibility_score: number;
  votes_total: number;
  votes_for_product: number;
  win_rate: number;
  total_feedback: number;
  top_criteria: TopCriterion[] | null;
  structure_score: number;
  melody_score: number;
  rhythm_score: number;
  sound_design_score: number;
  mix_score: number;
  identity_score: number;
  computed_at: string;
}

function parseTopCriteria(value: unknown): TopCriterion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;

      return {
        criterion: typeof row.criterion === 'string' ? row.criterion : 'unknown',
        count: Number(row.count ?? 0),
        rank: Number(row.rank ?? 0),
      };
    })
    .filter((row): row is TopCriterion => Boolean(row))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 6);
}

function getCriterionLabel(criterion: string, t: ReturnType<typeof useTranslation>['t']) {
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

export function AdminBeatAnalyticsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BeatFeedbackOverviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [recomputingBattleId, setRecomputingBattleId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);

    const { data, error } = await supabase.rpc('rpc_admin_get_beat_feedback_overview' as any, {
      p_limit: 120,
      p_offset: 0,
      p_battle_id: null,
    });

    if (error) {
      console.error('Error loading beat analytics overview:', error);
      toast.error(t('admin.beatAnalytics.loadError'));
      setRows([]);
      setIsLoading(false);
      return;
    }

    const nextRows = ((data as BeatFeedbackOverviewRow[] | null) ?? []).map((row) => ({
      ...row,
      top_criteria: parseTopCriteria(row.top_criteria),
    }));

    setRows(nextRows);
    setIsLoading(false);
  }, [t]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const recomputeBattle = async (battleId: string) => {
    setRecomputingBattleId(battleId);

    const { error } = await supabase.rpc('rpc_compute_battle_quality_snapshot' as any, {
      p_battle_id: battleId,
    });

    if (error) {
      console.error('Error recomputing quality snapshot:', error);
      toast.error(t('admin.beatAnalytics.recomputeError'));
      setRecomputingBattleId(null);
      return;
    }

    toast.success(t('admin.beatAnalytics.recomputeSuccess'));
    await loadOverview();
    setRecomputingBattleId(null);
  };

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('admin.beatAnalytics.title')}</h2>
            <p className="text-sm text-zinc-400">{t('admin.beatAnalytics.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={() => void loadOverview()}>
            <RefreshCw className="w-4 h-4" />
            {t('common.refresh')}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        {isLoading ? (
          <p className="text-zinc-400">{t('common.loading')}</p>
        ) : !hasRows ? (
          <p className="text-zinc-500">{t('admin.beatAnalytics.empty')}</p>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => (
              <div key={`${row.battle_id}:${row.product_id}`} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-zinc-500">{row.battle_title || row.battle_slug || row.battle_id}</p>
                    <p className="text-lg font-semibold text-white">{row.product_title || row.product_id}</p>
                    <p className="text-sm text-zinc-400">
                      {t('admin.beatAnalytics.byProducer', {
                        producer: row.producer_username || row.producer_id || t('common.unknown'),
                      })}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t('admin.beatAnalytics.updatedAt', { date: formatDateTime(row.computed_at) })}
                    </p>
                  </div>

                  <div className="flex flex-col items-start lg:items-end gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm font-semibold text-rose-200">
                      <Sparkles className="w-4 h-4" />
                      {t('admin.beatAnalytics.qualityIndexLabel', {
                        value: Number(row.quality_index ?? 0).toFixed(1),
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      isLoading={recomputingBattleId === row.battle_id}
                      onClick={() => void recomputeBattle(row.battle_id)}
                    >
                      {t('admin.beatAnalytics.recompute')}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">{t('admin.beatAnalytics.topCriteria')}</p>
                    <div className="mt-2 space-y-1 text-sm text-zinc-300">
                      {(row.top_criteria ?? []).length === 0 ? (
                        <p className="text-zinc-500">{t('admin.beatAnalytics.noFeedback')}</p>
                      ) : (
                        (row.top_criteria ?? []).map((criterion) => (
                          <p key={`${row.product_id}:${criterion.rank}:${criterion.criterion}`}>
                            {criterion.rank}. {getCriterionLabel(criterion.criterion, t)} ({criterion.count})
                          </p>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">{t('admin.beatAnalytics.signalBreakdown')}</p>
                    <div className="mt-2 space-y-1 text-sm text-zinc-300">
                      <p>{t('admin.beatAnalytics.preferenceScore', { value: Number(row.preference_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.artisticScore', { value: Number(row.artistic_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.coherenceScore', { value: Number(row.coherence_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.credibilityScore', { value: Number(row.credibility_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.votesLine', { won: row.votes_for_product, total: row.votes_total })}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">{t('admin.beatAnalytics.axisScores')}</p>
                    <div className="mt-2 space-y-1 text-sm text-zinc-300">
                      <p>{t('admin.beatAnalytics.axisStructure', { value: Number(row.structure_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.axisMelody', { value: Number(row.melody_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.axisRhythm', { value: Number(row.rhythm_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.axisSoundDesign', { value: Number(row.sound_design_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.axisMix', { value: Number(row.mix_score ?? 0).toFixed(1) })}</p>
                      <p>{t('admin.beatAnalytics.axisIdentity', { value: Number(row.identity_score ?? 0).toFixed(1) })}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
