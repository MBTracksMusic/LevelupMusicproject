import { Award, Sparkles } from 'lucide-react';
import { useTranslation, type TranslateFn } from '../../lib/i18n';
import { Badge } from '../ui/Badge';
import type { ReputationRankTier } from '../../lib/supabase/types';

const rankLabelKeys: Record<ReputationRankTier, 'common.rankBronze' | 'common.rankSilver' | 'common.rankGold' | 'common.rankPlatinum' | 'common.rankDiamond'> = {
  bronze: 'common.rankBronze',
  silver: 'common.rankSilver',
  gold: 'common.rankGold',
  platinum: 'common.rankPlatinum',
  diamond: 'common.rankDiamond',
};

const rankVariant: Record<ReputationRankTier, 'default' | 'info' | 'premium' | 'success'> = {
  bronze: 'default',
  silver: 'info',
  gold: 'premium',
  platinum: 'info',
  diamond: 'success',
};

export function formatRankTier(rankTier: ReputationRankTier | null | undefined, t: TranslateFn) {
  return t(rankLabelKeys[rankTier ?? 'bronze']);
}

interface ReputationBadgeProps {
  rankTier?: ReputationRankTier | null;
  level?: number | null;
  xp?: number | null;
  compact?: boolean;
}

export function ReputationBadge({ rankTier = 'bronze', level = 1, xp, compact = false }: ReputationBadgeProps) {
  const { t } = useTranslation();
  const normalizedRankTier = rankTier ?? 'bronze';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'mt-1'}`}>
      <Badge variant={rankVariant[normalizedRankTier]} className={compact ? '' : 'text-[11px]'}>
        <Award className="h-3 w-3" />
        {formatRankTier(normalizedRankTier, t)}
      </Badge>
      <Badge variant="default" className={compact ? '' : 'text-[11px]'}>
        <Sparkles className="h-3 w-3" />
        {t('producerProfile.statsLevel')} {level ?? 1}
      </Badge>
      {!compact && typeof xp === 'number' && (
        <span className="text-[11px] text-zinc-500">{xp} {t('common.xpShort')}</span>
      )}
    </div>
  );
}
