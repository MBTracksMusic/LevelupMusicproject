import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from './store';
import { supabase } from '@/lib/supabase/client';
import type { UserProfile, UserRole } from '../supabase/types';
import { isProducer, isProducerSafe } from './producer';

const isConfirmedProfile = (profile: Pick<UserProfile, 'role' | 'is_confirmed'> | null | undefined) => {
  if (!profile) return false;
  return profile.is_confirmed === true || ['confirmed_user', 'producer', 'admin'].includes(profile.role);
};

export function useAuth() {
  const { user, session, profile, isLoading, isInitialized, isProfileLoading, signOut, fetchProfile } = useAuthStore();

  return {
    user,
    session,
    profile,
    isLoading,
    isInitialized,
    isProfileLoading,
    isAuthenticated: !!user,
    signOut,
    refreshProfile: fetchProfile,
  };
}

export function useUserRole(): UserRole | null {
  const { profile } = useAuthStore();
  return profile?.role ?? null;
}

export function useIsProducer(): boolean {
  const { profile } = useAuthStore();
  return isProducer(profile);
}

export function useIsConfirmedUser(): boolean {
  const { profile } = useAuthStore();
  return isConfirmedProfile(profile);
}

export function useIsAdmin(): boolean {
  const { profile } = useAuthStore();
  return profile?.role === 'admin';
}

export function useCanVote(): boolean {
  const { profile } = useAuthStore();
  return isConfirmedProfile(profile);
}

export function useIsEmailVerified(): boolean {
  const { user } = useAuthStore();
  const [isVerified, setIsVerified] = useState(Boolean(user?.email_confirmed_at));

  useEffect(() => {
    let isCancelled = false;

    async function checkEmailVerification() {
      if (!user) {
        if (!isCancelled) {
          setIsVerified(false);
        }
        return;
      }

      if (!isCancelled) {
        setIsVerified(Boolean(user.email_confirmed_at));
      }

      const { data, error } = await supabase.auth.getUser();
      if (isCancelled) return;

      if (error) {
        console.error('Error checking email verification status:', error);
        return;
      }

      setIsVerified(Boolean(data.user?.email_confirmed_at));
    }

    void checkEmailVerification();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, user?.email_confirmed_at]);

  return isVerified;
}

export function useCanSell(): boolean {
  const { profile } = useAuthStore();
  return isProducerSafe(profile);
}

export function useCanAccessExclusivePreview(): boolean {
  const { profile } = useAuthStore();
  return isConfirmedProfile(profile);
}

export function usePermissions() {
  const { profile, user } = useAuthStore();

  return useMemo(() => {
    const role = profile?.role ?? 'visitor';
    const isConfirmed = isConfirmedProfile(profile);

    // Source de vérité unique : calculée par la vue my_user_profile (DB).
    // Couvre Stripe actif ET founding trial actif.
    // Ne jamais recalculer cette logique côté JS.
    const canAccessProducerFeatures = profile?.can_access_producer_features === true;

    // Trial founding expiré sans Stripe : afficher le paywall dans les pages producteur.
    const foundingTrialExpired = profile?.founding_trial_expired === true;

    return {
      canViewPreview: true,
      canViewExclusivePreview: isConfirmed,
      canPurchaseNonExclusive: !!user,
      canPurchaseExclusive: isConfirmed,
      canPurchaseKit: true,
      canVote: isConfirmed,
      canComment: !!user,
      canSell: canAccessProducerFeatures,
      canCreateBattle: canAccessProducerFeatures,
      canModerate: role === 'admin',
      canManageUsers: role === 'admin',
      foundingTrialExpired,
    };
  }, [profile, user]);
}
