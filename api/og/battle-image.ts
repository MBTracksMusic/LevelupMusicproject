import fs from 'node:fs';
import React, { type CSSProperties, type ReactNode } from 'react';
import sharp from 'sharp';
import satori, { type SatoriOptions } from 'satori';
import {
  fetchBattleOgData,
  getBattleCriterionLabel,
  getBattleOutcome,
  getBattleParticipants,
  getVoteLabel,
  type BattleOgData,
  type BattleOgLoserShareData,
  type BattleOgParticipant,
  type BattleShareTarget,
} from '../_shared/battle-og.js';

interface ApiRequest {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => ApiResponse;
  send: (body: Buffer | string) => void;
}

interface ParticipantView extends BattleOgParticipant {
  avatarDataUrl: string | null;
}

const WIDTH = 1200;
const HEIGHT = 630;
const BAR_WIDTH = 1060;
const FONT_REGULAR_URL = new URL('./fonts/Lato-Regular.ttf', import.meta.url);
const FONT_BOLD_URL = new URL('./fonts/Lato-Bold.ttf', import.meta.url);
const FONT_BLACK_URL = new URL('./fonts/Lato-Black.ttf', import.meta.url);

function queryString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function getTarget(value: string | null): BattleShareTarget {
  return value === 'feedback' ? 'feedback' : 'battle';
}

function isTruthyFlag(value: string | null) {
  return value === '1' || value === 'true';
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function percent(value: number, total: number) {
  if (total <= 0) return 50;
  return Math.round((value / total) * 100);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function getInitial(value: string | null | undefined, fallback: string) {
  const candidate = value?.trim().match(/[a-z0-9]/i)?.[0];
  return (candidate ?? fallback).toUpperCase();
}

let fontCache: SatoriOptions['fonts'] | null = null;

function getFonts(): SatoriOptions['fonts'] {
  if (fontCache) return fontCache;

  fontCache = [
    {
      name: 'Lato',
      data: fs.readFileSync(FONT_REGULAR_URL),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Lato',
      data: fs.readFileSync(FONT_BOLD_URL),
      weight: 700,
      style: 'normal',
    },
    {
      name: 'Lato',
      data: fs.readFileSync(FONT_BLACK_URL),
      weight: 900,
      style: 'normal',
    },
  ];

  return fontCache;
}

function box(style: CSSProperties, ...children: ReactNode[]) {
  return React.createElement('div', { style: { display: 'flex', ...style } }, ...children);
}

function image(src: string, style: CSSProperties) {
  return React.createElement('img', { src, style });
}

function progressBar(leftPercent: number, top: number) {
  const leftWidth = Math.max(0, Math.min(100, leftPercent)) * (BAR_WIDTH / 100);
  const rightWidth = BAR_WIDTH - leftWidth;

  return box(
    {
      position: 'absolute',
      left: 70,
      top,
      width: BAR_WIDTH,
      height: 18,
      borderRadius: 999,
      backgroundColor: '#27272A',
      overflow: 'hidden',
      flexDirection: 'row',
    },
    box({
      width: leftWidth,
      height: 18,
      backgroundColor: '#FB3F72',
      borderRadius: 999,
    }),
    box({
      width: rightWidth,
      height: 18,
      backgroundColor: '#FF7A1A',
      borderRadius: 999,
    }),
  );
}

async function fetchAvatarDataUrl(avatarUrl: string | null, size: number) {
  if (!avatarUrl) return null;

  try {
    const url = new URL(avatarUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const response = await fetch(url);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.startsWith('image/')) return null;

    const source = Buffer.from(await response.arrayBuffer());
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    const buffer = await sharp(source)
      .resize(size, size, { fit: 'cover' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function buildParticipantViews(battle: BattleOgData | null) {
  const participants = getBattleParticipants(battle);
  const views = await Promise.all(
    participants.map(async (participant) => ({
      ...participant,
      avatarDataUrl: await fetchAvatarDataUrl(participant.producerAvatarUrl, 180),
    })),
  );

  return views as [ParticipantView, ParticipantView];
}

function avatar(participant: ParticipantView, size: number, fallback: string) {
  const common: CSSProperties = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: '#111114',
    border: '2px solid #3F3F46',
    flexShrink: 0,
  };

  if (participant.avatarDataUrl) {
    return image(participant.avatarDataUrl, common);
  }

  return box(
    {
      ...common,
      alignItems: 'center',
      justifyContent: 'center',
      color: '#D4D4D8',
      fontFamily: 'Lato',
      fontSize: Math.round(size * 0.44),
      fontWeight: 700,
    },
    getInitial(participant.producerName, fallback),
  );
}

function root(...children: ReactNode[]) {
  return box(
    {
      width: WIDTH,
      height: HEIGHT,
      position: 'relative',
      backgroundColor: '#08080D',
      color: '#FAFAFA',
      fontFamily: 'Lato',
    },
    box({
      position: 'absolute',
      left: 32,
      top: 32,
      width: 1136,
      height: 566,
      borderRadius: 28,
      backgroundColor: '#141417',
      border: '2px solid #2A2A32',
    }),
    ...children,
  );
}

function brand(subtitle: string) {
  return [
    box(
      {
        position: 'absolute',
        left: 70,
        top: 68,
        width: 64,
        height: 64,
        borderRadius: 18,
        backgroundColor: '#FF5A1F',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#08080D',
        fontSize: 36,
        fontWeight: 900,
      },
      'B',
    ),
    box(
      {
        position: 'absolute',
        left: 154,
        top: 70,
        flexDirection: 'column',
      },
      box({ color: '#FF7A2F', fontSize: 26, fontWeight: 900 }, 'BEATELION'),
      box({ color: '#A1A1AA', fontSize: 20, marginTop: 6 }, subtitle),
    ),
  ];
}

function pill(text: string, left: number, top: number, width: number) {
  return box(
    {
      position: 'absolute',
      left,
      top,
      width,
      height: 42,
      borderRadius: 21,
      backgroundColor: '#202026',
      border: '1px solid #3F3F46',
      color: '#D4D4D8',
      fontSize: 17,
      fontWeight: 700,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text,
  );
}

function battleParticipantCard(
  participant: ParticipantView,
  left: number,
  top: number,
  accentColor: string,
  fallback: string,
) {
  return box(
    {
      position: 'absolute',
      left,
      top,
      width: 450,
      height: 156,
      borderRadius: 22,
      backgroundColor: '#1F1F24',
      border: '1px solid #2D2D35',
      alignItems: 'center',
      padding: 28,
      flexDirection: 'row',
    },
    avatar(participant, 76, fallback),
    box(
      {
        marginLeft: 20,
        flexDirection: 'column',
        width: 300,
      },
      box({ color: '#FAFAFA', fontSize: 22, fontWeight: 700 }, truncate(participant.producerName, 24)),
      box({ color: '#D4D4D8', fontSize: 24, fontWeight: 700, marginTop: 10 }, truncate(participant.productTitle, 36)),
      box(
        { color: accentColor, fontSize: 24, fontWeight: 700, marginTop: 20 },
        `${participant.votes} ${getVoteLabel(participant.votes)}`,
      ),
    ),
  );
}

function renderBattleImage({
  battle,
  participants,
  slug,
  host,
}: {
  battle: BattleOgData | null;
  participants: [ParticipantView, ParticipantView];
  slug: string | null;
  host: string;
}) {
  const [producer1, producer2] = participants;
  const totalVotes = producer1.votes + producer2.votes;
  const percent1 = percent(producer1.votes, totalVotes);
  const percent2 = 100 - percent1;

  return root(
    ...brand('Producer Battle'),
    pill((battle?.status ?? 'battle').toUpperCase(), 945, 78, 155),
    box(
      {
        position: 'absolute',
        left: 70,
        top: 172,
        width: 1060,
        color: '#FAFAFA',
        fontSize: 54,
        fontWeight: 900,
        lineHeight: 1.05,
      },
      truncate(battle?.title ?? 'Battle Beatelion', 58),
    ),
    battleParticipantCard(producer1, 70, 278, '#FB7185', '1'),
    box({
      position: 'absolute',
      left: 578,
      top: 340,
      color: '#71717A',
      fontSize: 30,
      fontWeight: 900,
    }, 'VS'),
    battleParticipantCard(producer2, 680, 278, '#FB923C', '2'),
    progressBar(percent1, 486),
    box({ position: 'absolute', left: 70, top: 520, color: '#A1A1AA', fontSize: 22 }, `${percent1}%`),
    box({ position: 'absolute', left: 560, top: 520, width: 140, justifyContent: 'center', color: '#A1A1AA', fontSize: 22 }, `${totalVotes} ${getVoteLabel(totalVotes)}`),
    box({ position: 'absolute', right: 70, top: 520, color: '#A1A1AA', fontSize: 22 }, `${percent2}%`),
    box({ position: 'absolute', left: 70, top: 558, color: '#71717A', fontSize: 18 }, host),
    box({ position: 'absolute', right: 70, top: 558, color: '#71717A', fontSize: 18 }, truncate(slug ?? 'battle', 54)),
  );
}

function winnerFeedbackCard(winner: ParticipantView, opponent: ParticipantView, totalVotes: number, winnerPercent: number) {
  return box(
    {
      position: 'absolute',
      left: 70,
      top: 238,
      width: 1060,
      height: 236,
      borderRadius: 28,
      backgroundColor: '#1F1F24',
      border: '2px solid #32323A',
      padding: 24,
      flexDirection: 'row',
      alignItems: 'center',
    },
    box(
      {
        width: 152,
        height: 152,
        borderRadius: 30,
        backgroundColor: '#27272A',
        border: '2px solid #3F3F46',
        alignItems: 'center',
        justifyContent: 'center',
      },
      avatar(winner, 108, 'W'),
    ),
    box(
      {
        marginLeft: 32,
        width: 540,
        flexDirection: 'column',
      },
      box({ color: '#FF7A2F', fontSize: 24, fontWeight: 900 }, 'VICTOIRE'),
      box({ color: '#FAFAFA', fontSize: 46, fontWeight: 900, lineHeight: 1.05, marginTop: 10 }, truncate(winner.producerName, 30)),
      box({ color: '#D4D4D8', fontSize: 25, fontWeight: 700, marginTop: 14 }, truncate(winner.productTitle, 40)),
      box(
        { color: '#FB7185', fontSize: 24, fontWeight: 700, marginTop: 18 },
        `${winner.votes}/${totalVotes} ${getVoteLabel(totalVotes)} - ${winnerPercent}%`,
      ),
    ),
    box(
      {
        marginLeft: 'auto',
        width: 220,
        height: 122,
        borderRadius: 22,
        backgroundColor: '#18181C',
        border: '1px solid #303038',
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
      },
      avatar(opponent, 56, '2'),
      box(
        {
          marginLeft: 12,
          width: 128,
          flexDirection: 'column',
        },
        box({ color: '#71717A', fontSize: 18, fontWeight: 700 }, 'Face a'),
        box({ color: '#FAFAFA', fontSize: 20, fontWeight: 700, marginTop: 4 }, truncate(opponent.producerName, 18)),
        box({ color: '#A1A1AA', fontSize: 16, marginTop: 6, lineHeight: 1.15 }, truncate(opponent.productTitle, 24)),
      ),
    ),
  );
}

function tieFeedbackCard(participants: [ParticipantView, ParticipantView]) {
  const [producer1, producer2] = participants;

  return box(
    {
      position: 'absolute',
      left: 70,
      top: 238,
      width: 1060,
      height: 236,
      borderRadius: 28,
      backgroundColor: '#1F1F24',
      border: '2px solid #32323A',
      padding: 24,
      flexDirection: 'column',
    },
    box({ color: '#FF7A2F', fontSize: 26, fontWeight: 900, justifyContent: 'center', width: '100%' }, 'MATCH NUL'),
    box(
      {
        marginTop: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
      },
      tieParticipantCard(producer1, '#FB7185', '1'),
      tieParticipantCard(producer2, '#FB923C', '2'),
    ),
  );
}

function tieParticipantCard(participant: ParticipantView, accentColor: string, fallback: string) {
  return box(
    {
      width: 490,
      height: 136,
      borderRadius: 22,
      backgroundColor: '#18181C',
      border: '1px solid #303038',
      padding: 20,
      alignItems: 'center',
      flexDirection: 'row',
    },
    avatar(participant, 82, fallback),
    box(
      {
        marginLeft: 20,
        width: 330,
        flexDirection: 'column',
      },
      box({ color: '#FAFAFA', fontSize: 26, fontWeight: 900, lineHeight: 1.05 }, truncate(participant.producerName, 24)),
      box({ color: '#D4D4D8', fontSize: 20, fontWeight: 700, marginTop: 10 }, truncate(participant.productTitle, 34)),
      box({ color: accentColor, fontSize: 20, fontWeight: 700, marginTop: 14 }, `${participant.votes} ${getVoteLabel(participant.votes)}`),
    ),
  );
}

function pendingFeedbackCard() {
  return box(
    {
      position: 'absolute',
      left: 70,
      top: 238,
      width: 1060,
      height: 236,
      borderRadius: 28,
      backgroundColor: '#1F1F24',
      border: '2px solid #32323A',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#D4D4D8',
      fontSize: 36,
      fontWeight: 900,
    },
    'Feedback disponible',
  );
}

function loserShareTraitBadges(loserShare: BattleOgLoserShareData) {
  const traits = loserShare.topTraits.slice(0, 3);
  const fallbackTraits = ['Groove', 'Melodie', 'Energie'];
  const labels = [0, 1, 2].map((index) => {
    const trait = traits[index];
    return trait ? getBattleCriterionLabel(trait.criterionKey) : fallbackTraits[index];
  });

  return box(
    {
      position: 'absolute',
      left: 150,
      top: 420,
      width: 900,
      flexDirection: 'row',
      justifyContent: 'center',
    },
    ...labels.map((label, index) => box(
      {
        width: 270,
        height: 58,
        marginLeft: index === 0 ? 0 : 20,
        borderRadius: 29,
        backgroundColor: '#202026',
        border: '1px solid #3F3F46',
        color: '#FAFAFA',
        fontSize: 22,
        fontWeight: 900,
        alignItems: 'center',
        justifyContent: 'center',
      },
      truncate(label, 20),
    )),
  );
}

function renderLoserShareImage({
  battle,
  slug,
  host,
}: {
  battle: BattleOgData | null;
  slug: string | null;
  host: string;
}) {
  const loserShare = battle?.loserShare;
  const producerName = loserShare?.producerName ?? 'Producteur 1';
  const opponentName = loserShare?.opponentName ?? 'Producteur 2';

  // The non-winning producer gets a neutral OG card to avoid humiliation while
  // using a curiosity gap that can bring new listeners back to Beatelion.
  return root(
    box({
      position: 'absolute',
      left: 70,
      top: 78,
      color: '#A1A1AA',
      fontSize: 22,
      fontWeight: 900,
      letterSpacing: 2.6,
      textTransform: 'uppercase',
    }, 'Battle Beatelion'),
    box({
      position: 'absolute',
      right: 70,
      top: 72,
      width: 58,
      height: 58,
      borderRadius: 16,
      backgroundColor: '#FF5A1F',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#08080D',
      fontSize: 34,
      fontWeight: 900,
    }, 'B'),
    box(
      {
        position: 'absolute',
        left: 100,
        top: 205,
        width: 1000,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
      },
      box({
        width: 430,
        color: '#FAFAFA',
        fontSize: 50,
        fontWeight: 900,
        lineHeight: 1.05,
        justifyContent: 'flex-end',
        textAlign: 'right',
      }, truncate(producerName, 22)),
      box({
        width: 140,
        color: '#71717A',
        fontSize: 34,
        fontWeight: 900,
        justifyContent: 'center',
      }, 'vs'),
      box({
        width: 430,
        color: '#FAFAFA',
        fontSize: 50,
        fontWeight: 900,
        lineHeight: 1.05,
      }, truncate(opponentName, 22)),
    ),
    box({
      position: 'absolute',
      left: 70,
      top: 344,
      width: 1060,
      color: '#D4D4D8',
      fontSize: 30,
      fontWeight: 700,
      justifyContent: 'center',
    }, `Top traits ${truncate(producerName, 26)}`),
    loserShareTraitBadges(loserShare ?? {
      producerId: '',
      producerName,
      opponentId: '',
      opponentName,
      topTraits: [],
    }),
    box({
      position: 'absolute',
      left: 70,
      top: 548,
      color: '#A1A1AA',
      fontSize: 22,
      fontWeight: 700,
    }, 'Qui a gagné ? → beatelion.com'),
    box({ position: 'absolute', right: 70, top: 552, color: '#71717A', fontSize: 18 }, truncate(slug ?? host, 54)),
  );
}

function renderFeedbackImage({
  battle,
  participants,
  slug,
  host,
}: {
  battle: BattleOgData | null;
  participants: [ParticipantView, ParticipantView];
  slug: string | null;
  host: string;
}) {
  const outcome = getBattleOutcome(battle);
  const totalVotes = participants[0].votes + participants[1].votes;
  const percent1 = percent(participants[0].votes, totalVotes);
  const percent2 = 100 - percent1;
  const outcomeCard = (() => {
    if (outcome.kind === 'winner') {
      const winner = outcome.winner.slot === 'producer1' ? participants[0] : participants[1];
      const opponent = outcome.opponent.slot === 'producer1' ? participants[0] : participants[1];
      return winnerFeedbackCard(winner, opponent, outcome.totalVotes, outcome.winnerPercent);
    }

    if (outcome.kind === 'tie') {
      return tieFeedbackCard(participants);
    }

    return pendingFeedbackCard();
  })();

  return root(
    ...brand('Feedback de battle'),
    pill('RESULTAT FINAL', 914, 78, 186),
    box(
      {
        position: 'absolute',
        left: 70,
        top: 158,
        width: 1060,
        color: '#FAFAFA',
        fontSize: 48,
        fontWeight: 900,
        lineHeight: 1.05,
      },
      truncate(battle?.title ?? 'Battle Beatelion', 58),
    ),
    outcomeCard,
    progressBar(percent1, 510),
    box({ position: 'absolute', left: 70, top: 544, color: '#A1A1AA', fontSize: 22 }, `${percent1}%`),
    box({ position: 'absolute', left: 560, top: 544, width: 140, justifyContent: 'center', color: '#A1A1AA', fontSize: 22 }, `${totalVotes} ${getVoteLabel(totalVotes)}`),
    box({ position: 'absolute', right: 70, top: 544, color: '#A1A1AA', fontSize: 22 }, `${percent2}%`),
    box({ position: 'absolute', left: 70, top: 568, color: '#71717A', fontSize: 18 }, host),
    box({ position: 'absolute', right: 70, top: 568, color: '#71717A', fontSize: 18 }, truncate(slug ?? 'battle', 54)),
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = queryString(req.query?.slug)?.trim() || null;
  const target = getTarget(queryString(req.query?.target));
  const isLoserCard = isTruthyFlag(queryString(req.query?.is_loser_card));
  const host = headerString(req.headers?.['x-forwarded-host']) ??
    headerString(req.headers?.host) ??
    'www.beatelion.com';
  const battle = slug
    ? await fetchBattleOgData(slug, { isLoserCard }).catch((error) => {
        console.error('[battle-og-image] unable to fetch battle data', error);
        return null;
      })
    : null;
  const participants = await buildParticipantViews(battle);
  const tree = isLoserCard
    ? renderLoserShareImage({ battle, slug, host })
    : target === 'feedback'
    ? renderFeedbackImage({ battle, participants, slug, host })
    : renderBattleImage({ battle, participants, slug, host });
  const svg = await satori(tree, {
    width: WIDTH,
    height: HEIGHT,
    fonts: getFonts(),
  });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.status(200).send(png);
}
