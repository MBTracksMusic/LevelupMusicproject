import type { UserProfile } from '../supabase/types';

type EliteAccessProfile = Pick<UserProfile, 'account_type' | 'is_verified' | 'role'> | null | undefined;

export function isEliteProducer(profile: EliteAccessProfile): boolean {
  return profile?.account_type === 'elite_producer';
}

export function isVerifiedLabel(profile: EliteAccessProfile): boolean {
  return profile?.account_type === 'label' && profile?.is_verified === true;
}

export function canAccessEliteHub(profile: EliteAccessProfile): boolean {
  return isEliteProducer(profile) || isVerifiedLabel(profile);
}

export function canRequestLabelAccess(profile: EliteAccessProfile): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return false;
  return !canAccessEliteHub(profile);
}
