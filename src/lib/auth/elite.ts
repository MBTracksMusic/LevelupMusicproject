import type { UserProfile } from '../supabase/types';

type EliteAccessProfile = Pick<UserProfile, 'account_type' | 'is_verified'> | null | undefined;

export function isEliteProducer(profile: EliteAccessProfile): boolean {
  return profile?.account_type === 'elite_producer';
}

export function isVerifiedLabel(profile: EliteAccessProfile): boolean {
  return profile?.account_type === 'label' && profile?.is_verified === true;
}

export function canAccessEliteHub(profile: EliteAccessProfile): boolean {
  return isEliteProducer(profile) || isVerifiedLabel(profile);
}
