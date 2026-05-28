import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLoserShareMessage,
  canShowLoserShareButton,
  getTopLoserTraitKeys,
  isStandardFeedbackShareRole,
  type LoserShareData,
} from '../../src/lib/battles/loserShare.ts';
import type { TranslateFn } from '../../src/lib/i18n/index.ts';

const translations: Record<string, string> = {
  'battleFeedback.share.templates.neutral': 'Neutral -> {url}',
  'battleFeedback.share.templates.traits': 'Traits: {traits} -> {url}',
  'battleFeedback.share.templates.comeback': 'Comeback -> {url}',
  'battleFeedback.share.traitList.three': '{first}, {second} and {third}',
  'battleFeedback.share.traitsWithArticle.groove': 'my groove',
  'battleFeedback.share.traitsWithArticle.melody': 'my melody',
  'battleFeedback.share.traitsWithArticle.ambience': 'my atmosphere',
  'battleFeedback.share.traitsWithArticle.soundDesign': 'my sound design',
  'battleFeedback.share.traitsWithArticle.drums': 'my drums',
  'battleFeedback.share.traitsWithArticle.mix': 'my mix',
  'battleFeedback.share.traitsWithArticle.originality': 'my originality',
  'battleFeedback.share.traitsWithArticle.energy': 'my energy',
  'battleFeedback.share.traitsWithArticle.artisticVibe': 'my artistic vibe',
};

const t: TranslateFn = (key, params) => {
  let text = translations[key] ?? key;
  Object.entries(params ?? {}).forEach(([paramKey, value]) => {
    text = text.replace(`{${paramKey}}`, String(value));
  });
  return text;
};

const shareData: Pick<LoserShareData, 'share_url' | 'top_traits'> = {
  share_url: 'https://www.beatelion.com/share/battle/demo/feedback?is_loser_card=true',
  top_traits: [
    { criterion_key: 'mix', count: 9 },
    { criterion_key: 'groove', count: 7 },
    { criterion_key: 'energy', count: 4 },
  ],
};

test('loser share button is visible only for the completed non-tie participant side', () => {
  assert.equal(canShowLoserShareButton({
    role: 'loser',
    status: 'completed',
    winnerProductId: 'winner-product',
    isTie: false,
  }), true);
});

test('winner keeps the standard victory share and does not see the autonomous share button', () => {
  assert.equal(canShowLoserShareButton({
    role: 'winner',
    status: 'completed',
    winnerProductId: 'winner-product',
    isTie: false,
  }), false);
  assert.equal(isStandardFeedbackShareRole('winner'), true);
});

test('unfinished battles do not expose autonomous share', () => {
  assert.equal(canShowLoserShareButton({
    role: 'loser',
    status: 'voting',
    winnerProductId: null,
    isTie: false,
  }), false);
});

test('tie participants keep the neutral share path', () => {
  assert.equal(canShowLoserShareButton({
    role: 'tie_participant',
    status: 'completed',
    winnerProductId: null,
    isTie: true,
  }), false);
  assert.equal(isStandardFeedbackShareRole('tie_participant'), true);
});

test('non-participants cannot access autonomous share visibility', () => {
  assert.equal(canShowLoserShareButton({
    role: 'visitor_auth',
    status: 'completed',
    winnerProductId: 'winner-product',
    isTie: false,
  }), false);
});

test('traits template uses the top three voted criteria in order', () => {
  assert.deepEqual(getTopLoserTraitKeys(shareData.top_traits), ['mix', 'groove', 'energy']);
  assert.equal(
    buildLoserShareMessage('traits', shareData, t),
    'Traits: my mix, my groove and my energy -> https://www.beatelion.com/share/battle/demo/feedback?is_loser_card=true',
  );
});
