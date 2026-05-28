export type ViewerRole =
  | 'admin'
  | 'winner'
  | 'loser'
  | 'tie_participant'
  | 'visitor_auth'
  | 'visitor_anon';

export interface DeriveRoleBattle {
  winner_product_id: string | null;
  is_tie: boolean;
}

export interface DeriveRoleSnapshot {
  product_id: string;
  producer: { id: string };
}

export interface DeriveRoleInput {
  userId: string | null | undefined;
  userRole: string | null | undefined;
  battle: DeriveRoleBattle;
  snapshots: ReadonlyArray<DeriveRoleSnapshot>;
}

export function deriveRole({ userId, userRole, battle, snapshots }: DeriveRoleInput): ViewerRole {
  if (userRole === 'admin') return 'admin';
  if (!userId) return 'visitor_anon';

  const isParticipant = snapshots.some((s) => s.producer.id === userId);
  if (!isParticipant) return 'visitor_auth';

  if (battle.is_tie) return 'tie_participant';

  const winnerSnap = snapshots.find((s) => s.product_id === battle.winner_product_id);
  return winnerSnap?.producer.id === userId ? 'winner' : 'loser';
}
