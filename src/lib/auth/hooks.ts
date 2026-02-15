import { useMemo } from 'react';
import { useAuthStore } from './store';
import type { UserRole } from '../supabase/types';

export function useAuth() {
  const { user, session, profile, isLoading, isInitialized, signOut, fetchProfile } = useAuthStore();

  return {
    user,
    session,
    profile,
    isLoading,
    isInitialized,
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
  return profile?.is_producer_active ?? false;
}

export function useIsConfirmedUser(): boolean {
  const { profile } = useAuthStore();
  if (!profile) return false;
  return ['confirmed_user', 'producer', 'admin'].includes(profile.role);
}

export function useIsAdmin(): boolean {
  const { profile } = useAuthStore();
  return profile?.role === 'admin';
}

export function useCanVote(): boolean {
  const { profile } = useAuthStore();
  if (!profile) return false;
  return ['confirmed_user', 'producer', 'admin'].includes(profile.role);
}

export function useCanSell(): boolean {
  const { profile } = useAuthStore();
  return profile?.is_producer_active ?? false;
}

export function useCanAccessExclusivePreview(): boolean {
  const { profile } = useAuthStore();
  if (!profile) return false;
  return ['confirmed_user', 'producer', 'admin'].includes(profile.role);
}

export function usePermissions() {
  const { profile, user } = useAuthStore();

  return useMemo(() => {
    const role = profile?.role ?? 'visitor';
    const isProducerActive = profile?.is_producer_active ?? false;

    return {
      canViewPreview: true,
      canViewExclusivePreview: ['confirmed_user', 'producer', 'admin'].includes(role),
      canPurchaseNonExclusive: !!user,
      canPurchaseExclusive: ['confirmed_user', 'producer', 'admin'].includes(role),
      canPurchaseKit: true,
      canVote: ['confirmed_user', 'producer', 'admin'].includes(role),
      canComment: !!user,
      canSell: isProducerActive,
      canCreateBattle: isProducerActive,
      canModerate: role === 'admin',
      canManageUsers: role === 'admin',
    };
  }, [profile, user]);
}
