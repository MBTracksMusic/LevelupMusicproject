export type BattleShareTarget = 'battle' | 'feedback';

export interface BattleOgData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  producer1Id: string | null;
  producer2Id: string | null;
  winnerId: string | null;
  producer1Name: string | null;
  producer2Name: string | null;
  producer1AvatarUrl: string | null;
  producer2AvatarUrl: string | null;
  votesProducer1: number;
  votesProducer2: number;
  product1Title: string;
  product2Title: string;
  loserShare: BattleOgLoserShareData | null;
}

export interface BattleOgLoserTrait {
  criterionKey: string;
  count: number;
}

export interface BattleOgLoserShareData {
  producerId: string;
  producerName: string;
  opponentId: string;
  opponentName: string;
  topTraits: BattleOgLoserTrait[];
}

export interface BattleOgParticipant {
  slot: 'producer1' | 'producer2';
  producerId: string | null;
  producerName: string;
  producerAvatarUrl: string | null;
  productTitle: string;
  votes: number;
}

export interface BattleOgWinnerOutcome {
  kind: 'winner';
  winner: BattleOgParticipant;
  opponent: BattleOgParticipant;
  totalVotes: number;
  winnerPercent: number;
  opponentPercent: number;
}

export interface BattleOgTieOutcome {
  kind: 'tie';
  participants: [BattleOgParticipant, BattleOgParticipant];
  totalVotes: number;
}

export interface BattleOgPendingOutcome {
  kind: 'pending';
  participants: [BattleOgParticipant, BattleOgParticipant];
  totalVotes: number;
}

export type BattleOgOutcome = BattleOgWinnerOutcome | BattleOgTieOutcome | BattleOgPendingOutcome;

interface BattleRow {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  status: string | null;
  producer1_id: string | null;
  producer2_id: string | null;
  winner_id: string | null;
  votes_producer1: number | null;
  votes_producer2: number | null;
}

interface BattleSnapshotRow {
  slot: string | null;
  product_id: string | null;
  producer_id: string | null;
  title_snapshot: string | null;
}

interface PublicProducerProfileRow {
  user_id: string;
  username: string | null;
  raw_username?: string | null;
  avatar_url: string | null;
}

interface UserProfileRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

interface FeedbackPayloadSnapshot {
  product_id: string | null;
  producer?: {
    id?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
  votes_for_product?: number | null;
  votes_total?: number | null;
}

interface FeedbackPayload {
  snapshots?: FeedbackPayloadSnapshot[] | null;
}

interface LoserShareRpcTrait {
  criterion_key?: unknown;
  count?: unknown;
}

interface LoserShareRpcResponse {
  producer_id?: unknown;
  producer_name?: unknown;
  opponent_id?: unknown;
  opponent_name?: unknown;
  top_traits?: unknown;
  is_loser_role?: unknown;
}

export interface FetchBattleOgOptions {
  isLoserCard?: boolean;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}

function asSupabaseKey(value: unknown): string | null {
  const key = asNonEmptyString(value);
  if (!key) return null;
  if (key === 'your_anon_public_key' || key === 'your_anon_key' || key === 'your_service_role_key') {
    return null;
  }
  return key;
}

function getSupabaseConfig() {
  const url = asNonEmptyString(process.env.SUPABASE_URL) ??
    asNonEmptyString(process.env.VITE_SUPABASE_URL);
  const key = asSupabaseKey(process.env.SUPABASE_SERVICE_ROLE_KEY) ??
    asSupabaseKey(process.env.SUPABASE_ANON_KEY) ??
    asSupabaseKey(process.env.VITE_SUPABASE_ANON_KEY);

  if (!url || !key) {
    throw new Error('Missing Supabase URL or API key for battle OG generation');
  }

  return { url, key };
}

async function fetchSupabaseRows<T>(path: string, params: Record<string, string>) {
  const { url, key } = getSupabaseConfig();
  const endpoint = new URL(`/rest/v1/${path}`, url);
  Object.entries(params).forEach(([name, value]) => endpoint.searchParams.set(name, value));

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase OG query failed: ${response.status}`);
  }

  return response.json() as Promise<T[]>;
}

async function fetchSupabaseRpc<T>(functionName: string, body: Record<string, unknown>) {
  const { url, key } = getSupabaseConfig();
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, url);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Supabase OG RPC failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchProducerProfiles(userIds: Array<string | null | undefined>) {
  const uniqueIds = [...new Set(userIds.filter((value): value is string => Boolean(value)))];
  if (uniqueIds.length === 0) return new Map<string, PublicProducerProfileRow>();

  const profiles = new Map<string, PublicProducerProfileRow>();
  const profileViews = ['public_producer_profiles', 'public_visible_producer_profiles'] as const;

  for (const view of profileViews) {
    if (profiles.size >= uniqueIds.length) break;

    const rows = await fetchSupabaseRows<PublicProducerProfileRow>(view, {
      select: 'user_id,username,raw_username,avatar_url',
      user_id: `in.(${uniqueIds.join(',')})`,
    }).catch(() => []);

    for (const row of rows) {
      if (!row.user_id || profiles.has(row.user_id)) continue;
      profiles.set(row.user_id, row);
    }
  }

  if (profiles.size < uniqueIds.length) {
    const rows = await fetchSupabaseRows<UserProfileRow>('user_profiles', {
      select: 'id,username,avatar_url',
      id: `in.(${uniqueIds.join(',')})`,
    }).catch(() => []);

    for (const row of rows) {
      if (!row.id || profiles.has(row.id)) continue;
      profiles.set(row.id, {
        user_id: row.id,
        username: row.username,
        avatar_url: row.avatar_url,
      });
    }
  }

  return profiles;
}

function getFeedbackSnapshotsByProduct(payload: FeedbackPayload | null) {
  const snapshots = new Map<string, FeedbackPayloadSnapshot>();

  for (const snapshot of payload?.snapshots ?? []) {
    if (!snapshot.product_id) continue;
    snapshots.set(snapshot.product_id, snapshot);
  }

  return snapshots;
}

function parseLoserShareRpcResponse(value: LoserShareRpcResponse | null): BattleOgLoserShareData | null {
  if (!value || value.is_loser_role !== true) return null;
  if (
    typeof value.producer_id !== 'string'
    || typeof value.producer_name !== 'string'
    || typeof value.opponent_id !== 'string'
    || typeof value.opponent_name !== 'string'
  ) {
    return null;
  }

  const topTraits = Array.isArray(value.top_traits)
    ? value.top_traits.flatMap((trait): BattleOgLoserTrait[] => {
        if (trait === null || typeof trait !== 'object' || Array.isArray(trait)) return [];
        const candidate = trait as LoserShareRpcTrait;
        if (typeof candidate.criterion_key !== 'string') return [];
        return [{
          criterionKey: candidate.criterion_key,
          count: typeof candidate.count === 'number' ? candidate.count : 0,
        }];
      })
    : [];

  return {
    producerId: value.producer_id,
    producerName: value.producer_name,
    opponentId: value.opponent_id,
    opponentName: value.opponent_name,
    topTraits,
  };
}

export async function fetchBattleOgData(
  slug: string,
  options: FetchBattleOgOptions = {},
): Promise<BattleOgData | null> {
  const [battle] = await fetchSupabaseRows<BattleRow>('battles', {
    select: 'id,slug,title,description,status,producer1_id,producer2_id,winner_id,votes_producer1,votes_producer2',
    slug: `eq.${slug}`,
    limit: '1',
  });

  if (!battle) return null;

  const snapshots = await fetchSupabaseRows<BattleSnapshotRow>('battle_product_snapshots', {
    select: 'slot,product_id,producer_id,title_snapshot',
    battle_id: `eq.${battle.id}`,
    order: 'slot.asc',
  });

  const product1 = snapshots.find((snapshot) => snapshot.slot === 'producer1');
  const product2 = snapshots.find((snapshot) => snapshot.slot === 'producer2');
  const profileIds = [
    battle.producer1_id,
    battle.producer2_id,
    product1?.producer_id,
    product2?.producer_id,
  ];
  const [profiles, feedbackPayload, loserSharePayload] = await Promise.all([
    fetchProducerProfiles(profileIds),
    fetchSupabaseRpc<FeedbackPayload>('get_battle_feedback_payload', { p_battle_id: battle.id }).catch(() => null),
    options.isLoserCard
      ? fetchSupabaseRpc<LoserShareRpcResponse>('get_loser_share_data', { p_battle_id: battle.id }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const feedbackSnapshots = getFeedbackSnapshotsByProduct(feedbackPayload);
  const feedback1 = product1?.product_id ? feedbackSnapshots.get(product1.product_id) : null;
  const feedback2 = product2?.product_id ? feedbackSnapshots.get(product2.product_id) : null;
  const producer1Id = battle.producer1_id ?? product1?.producer_id ?? feedback1?.producer?.id ?? null;
  const producer2Id = battle.producer2_id ?? product2?.producer_id ?? feedback2?.producer?.id ?? null;
  const producer1 = producer1Id ? profiles.get(producer1Id) : null;
  const producer2 = producer2Id ? profiles.get(producer2Id) : null;

  return {
    id: battle.id,
    slug: battle.slug,
    title: battle.title ?? 'Battle Beatelion',
    description: battle.description,
    status: battle.status ?? 'battle',
    producer1Id,
    producer2Id,
    winnerId: battle.winner_id,
    producer1Name: feedback1?.producer?.display_name ?? producer1?.username ?? producer1?.raw_username ?? null,
    producer2Name: feedback2?.producer?.display_name ?? producer2?.username ?? producer2?.raw_username ?? null,
    producer1AvatarUrl: feedback1?.producer?.avatar_url ?? producer1?.avatar_url ?? null,
    producer2AvatarUrl: feedback2?.producer?.avatar_url ?? producer2?.avatar_url ?? null,
    votesProducer1: feedback1?.votes_for_product ?? battle.votes_producer1 ?? 0,
    votesProducer2: feedback2?.votes_for_product ?? battle.votes_producer2 ?? 0,
    product1Title: product1?.title_snapshot ?? 'Produit 1',
    product2Title: product2?.title_snapshot ?? 'Produit 2',
    loserShare: parseLoserShareRpcResponse(loserSharePayload),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getBattleAppPath(slug: string, target: BattleShareTarget) {
  return target === 'feedback' ? `/battles/${slug}/feedback` : `/battles/${slug}`;
}

export function getBattleSharePath(slug: string, target: BattleShareTarget) {
  return target === 'feedback' ? `/share/battle/${slug}/feedback` : `/share/battle/${slug}`;
}

export function getBattleCriterionLabel(criterionKey: string) {
  switch (criterionKey) {
    case 'groove':
      return 'Groove';
    case 'melody':
      return 'Melodie';
    case 'ambience':
      return 'Univers';
    case 'sound_design':
      return 'Sound design';
    case 'drums':
      return 'Drums';
    case 'mix':
      return 'Mix';
    case 'originality':
      return 'Creativite';
    case 'energy':
      return 'Energie';
    case 'artistic_vibe':
      return 'Vibe artistique';
    default:
      return 'Trait';
  }
}

export function getVoteLabel(count: number) {
  return count > 1 ? 'votes' : 'vote';
}

export function getBattleParticipants(battle: BattleOgData | null): [BattleOgParticipant, BattleOgParticipant] {
  return [
    {
      slot: 'producer1',
      producerId: battle?.producer1Id ?? null,
      producerName: battle?.producer1Name ?? 'Producteur 1',
      producerAvatarUrl: battle?.producer1AvatarUrl ?? null,
      productTitle: battle?.product1Title ?? 'Produit 1',
      votes: battle?.votesProducer1 ?? 0,
    },
    {
      slot: 'producer2',
      producerId: battle?.producer2Id ?? null,
      producerName: battle?.producer2Name ?? 'Producteur 2',
      producerAvatarUrl: battle?.producer2AvatarUrl ?? null,
      productTitle: battle?.product2Title ?? 'Produit 2',
      votes: battle?.votesProducer2 ?? 0,
    },
  ];
}

export function getBattleOutcome(battle: BattleOgData | null): BattleOgOutcome {
  const participants = getBattleParticipants(battle);
  const [producer1, producer2] = participants;
  const totalVotes = producer1.votes + producer2.votes;

  if (totalVotes === 0) {
    return { kind: 'pending', participants, totalVotes };
  }

  if (producer1.votes === producer2.votes) {
    return { kind: 'tie', participants, totalVotes };
  }

  const winner = producer1.votes > producer2.votes ? producer1 : producer2;
  const opponent = winner.slot === 'producer1' ? producer2 : producer1;
  const winnerPercent = Math.round((winner.votes / totalVotes) * 100);

  return {
    kind: 'winner',
    winner,
    opponent,
    totalVotes,
    winnerPercent,
    opponentPercent: 100 - winnerPercent,
  };
}

export function buildBattleShareTitle(
  battle: BattleOgData | null,
  target: BattleShareTarget,
  isLoserCard = false,
) {
  if (!battle) return 'Battle Beatelion';

  if (isLoserCard && battle.loserShare) {
    return `${battle.loserShare.producerName} vs ${battle.loserShare.opponentName} | Beatelion`;
  }

  if (target === 'feedback') {
    const outcome = getBattleOutcome(battle);

    if (outcome.kind === 'winner') {
      return `${outcome.winner.producerName} remporte ${battle.title} | Beatelion`;
    }

    if (outcome.kind === 'tie') {
      return `Match nul sur ${battle.title} | Beatelion`;
    }

    return `${battle.title} - Resultats | Beatelion`;
  }

  return `${battle.title} | Beatelion Battle`;
}

export function buildBattleDescription(
  battle: BattleOgData | null,
  target: BattleShareTarget = 'battle',
  isLoserCard = false,
) {
  if (!battle) return 'Decouvre cette battle de producteurs sur Beatelion.';

  if (isLoserCard && battle.loserShare) {
    const traits = battle.loserShare.topTraits
      .slice(0, 3)
      .map((trait) => getBattleCriterionLabel(trait.criterionKey))
      .join(', ');
    return traits
      ? `Top traits ${battle.loserShare.producerName}: ${traits}.`
      : `Decouvre cette battle sur Beatelion.`;
  }

  if (target === 'feedback') {
    const outcome = getBattleOutcome(battle);

    if (outcome.kind === 'winner') {
      return `${outcome.winner.productTitle} gagne avec ${outcome.winner.votes}/${outcome.totalVotes} ${getVoteLabel(outcome.totalVotes)} (${outcome.winnerPercent}%). Voir le feedback complet sur Beatelion.`;
    }

    if (outcome.kind === 'tie') {
      return `Match nul entre ${outcome.participants[0].productTitle} et ${outcome.participants[1].productTitle}. Voir le feedback complet sur Beatelion.`;
    }

    return `Voir les resultats et le feedback complet de ${battle.title} sur Beatelion.`;
  }

  const totalVotes = battle.votesProducer1 + battle.votesProducer2;
  return `${battle.product1Title} vs ${battle.product2Title} - ${totalVotes} ${getVoteLabel(totalVotes)} sur Beatelion.`;
}
