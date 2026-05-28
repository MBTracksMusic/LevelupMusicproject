import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveRole, type DeriveRoleInput } from '../../src/lib/feedback/deriveRole.ts';

const WINNER_PROD = 'prod-winner-uuid';
const LOSER_PROD = 'prod-loser-uuid';
const WINNER_USER = 'user-winner-uuid';
const LOSER_USER = 'user-loser-uuid';
const OUTSIDER_USER = 'user-outsider-uuid';

const baseSnapshots = [
  { product_id: WINNER_PROD, producer: { id: WINNER_USER } },
  { product_id: LOSER_PROD, producer: { id: LOSER_USER } },
];

function input(over: Partial<DeriveRoleInput>): DeriveRoleInput {
  return {
    userId: null,
    userRole: null,
    battle: { winner_product_id: WINNER_PROD, is_tie: false },
    snapshots: baseSnapshots,
    ...over,
  };
}

test('admin role always wins, even when also a participant', () => {
  const role = deriveRole(input({ userId: WINNER_USER, userRole: 'admin' }));
  assert.equal(role, 'admin');
});

test('winner: authenticated user matches the winning product producer', () => {
  const role = deriveRole(input({ userId: WINNER_USER, userRole: 'producer' }));
  assert.equal(role, 'winner');
});

test('loser: authenticated user matches the losing product producer (non-tie)', () => {
  const role = deriveRole(input({ userId: LOSER_USER, userRole: 'producer' }));
  assert.equal(role, 'loser');
});

test('tie_participant: user participates AND battle is_tie=true', () => {
  const role = deriveRole(
    input({
      userId: LOSER_USER,
      userRole: 'producer',
      battle: { winner_product_id: null, is_tie: true },
    }),
  );
  assert.equal(role, 'tie_participant');
});

test('visitor_auth: authenticated user, not a participant', () => {
  const role = deriveRole(input({ userId: OUTSIDER_USER, userRole: 'confirmed_user' }));
  assert.equal(role, 'visitor_auth');
});

test('visitor_anon: no user', () => {
  const role = deriveRole(input({ userId: null, userRole: null }));
  assert.equal(role, 'visitor_anon');
});
