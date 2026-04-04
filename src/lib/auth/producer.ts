import type { UserProfile } from '../supabase/types';

export type ProducerAccessProfile = Pick<UserProfile, 'role' | 'is_producer_active' | 'can_access_producer_features'> & {
  stripe_account_charges_enabled?: boolean | null;
};

export function isProducer(profile: Pick<ProducerAccessProfile, 'role'> | null | undefined): boolean {
  return profile?.role === 'producer';
}

export function isProducerSafe(profile: ProducerAccessProfile | null | undefined): boolean {
  return profile?.can_access_producer_features === true || profile?.is_producer_active === true;
}

export function isStripeReady(
  profile: Pick<ProducerAccessProfile, 'stripe_account_charges_enabled'> | null | undefined
): boolean {
  return profile?.stripe_account_charges_enabled === true;
}
