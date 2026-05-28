import type { ViewerRole } from '../feedback/deriveRole';
import type { TranslateFn, TranslationKey } from '../i18n';

export const LOSER_SHARE_TEMPLATE_KEYS = ['neutral', 'traits', 'comeback'] as const;

export type LoserShareTemplateKey = (typeof LOSER_SHARE_TEMPLATE_KEYS)[number];
export type LoserShareChannel = 'x' | 'facebook' | 'linkedin' | 'whatsapp' | 'copy';

export interface LoserShareTrait {
  criterion_key: string;
  count: number;
}

export interface LoserShareData {
  battle_id: string;
  battle_slug: string;
  producer_id: string;
  producer_name: string;
  producer_slug: string | null;
  opponent_id: string;
  opponent_name: string;
  opponent_slug: string | null;
  top_traits: LoserShareTrait[];
  share_url: string;
  is_loser_role: boolean;
  error?: string;
}

export interface RecordLoserShareResult {
  share_event_id: string;
  xp_awarded: boolean;
  xp_delta: number;
  reputation_event_id: string | null;
  skipped_reason: string | null;
}

export interface LoserShareVisibilityInput {
  role: ViewerRole;
  status: string;
  winnerProductId: string | null;
  isTie: boolean;
}

const BATTLE_CRITERION_KEYS = [
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

export type BattleCriterionKey = (typeof BATTLE_CRITERION_KEYS)[number];

const battleCriterionSet = new Set<string>(BATTLE_CRITERION_KEYS);
const FALLBACK_TRAIT_KEYS: BattleCriterionKey[] = ['groove', 'melody', 'energy'];

const TRAIT_WITH_ARTICLE_KEYS: Record<BattleCriterionKey, TranslationKey> = {
  groove: 'battleFeedback.share.traitsWithArticle.groove',
  melody: 'battleFeedback.share.traitsWithArticle.melody',
  ambience: 'battleFeedback.share.traitsWithArticle.ambience',
  sound_design: 'battleFeedback.share.traitsWithArticle.soundDesign',
  drums: 'battleFeedback.share.traitsWithArticle.drums',
  mix: 'battleFeedback.share.traitsWithArticle.mix',
  originality: 'battleFeedback.share.traitsWithArticle.originality',
  energy: 'battleFeedback.share.traitsWithArticle.energy',
  artistic_vibe: 'battleFeedback.share.traitsWithArticle.artisticVibe',
};

export function isBattleCriterionKey(value: string): value is BattleCriterionKey {
  return battleCriterionSet.has(value);
}

export function canShowLoserShareButton(input: LoserShareVisibilityInput) {
  return (
    input.role === 'loser'
    && input.status === 'completed'
    && input.winnerProductId !== null
    && !input.isTie
  );
}

export function isStandardFeedbackShareRole(role: ViewerRole) {
  return role === 'winner' || role === 'admin' || role === 'tie_participant';
}

export function getTopLoserTraitKeys(traits: ReadonlyArray<LoserShareTrait>) {
  const seen = new Set<string>();
  const keys: BattleCriterionKey[] = [];

  for (const trait of traits) {
    if (!isBattleCriterionKey(trait.criterion_key) || seen.has(trait.criterion_key)) {
      continue;
    }
    seen.add(trait.criterion_key);
    keys.push(trait.criterion_key);
    if (keys.length === 3) return keys;
  }

  for (const fallbackKey of FALLBACK_TRAIT_KEYS) {
    if (seen.has(fallbackKey)) continue;
    keys.push(fallbackKey);
    if (keys.length === 3) break;
  }

  return keys;
}

export function buildLoserTraitList(traits: ReadonlyArray<LoserShareTrait>, t: TranslateFn) {
  const [first, second, third] = getTopLoserTraitKeys(traits).map((key) => t(TRAIT_WITH_ARTICLE_KEYS[key]));

  return t('battleFeedback.share.traitList.three', {
    first: first ?? t(TRAIT_WITH_ARTICLE_KEYS.groove),
    second: second ?? t(TRAIT_WITH_ARTICLE_KEYS.melody),
    third: third ?? t(TRAIT_WITH_ARTICLE_KEYS.energy),
  });
}

export function buildLoserShareMessage(
  templateKey: LoserShareTemplateKey,
  shareData: Pick<LoserShareData, 'share_url' | 'top_traits'>,
  t: TranslateFn,
) {
  if (templateKey === 'traits') {
    return t('battleFeedback.share.templates.traits', {
      traits: buildLoserTraitList(shareData.top_traits, t),
      url: shareData.share_url,
    });
  }

  return t(`battleFeedback.share.templates.${templateKey}`, {
    url: shareData.share_url,
  });
}
