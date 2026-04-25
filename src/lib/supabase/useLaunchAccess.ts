import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/hooks';
import { supabase } from './client';
import { useMaintenanceModeContext } from './MaintenanceModeContext';
import type { SiteAccessMode } from './useMaintenanceMode';
import { DEFAULT_LAUNCH_PAGE_CONTENT } from '../launchPageContent';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Resolved access level for the current visitor:
 * - full            → show the full app
 * - waitlist_pending → show the "you're on the list" screen
 * - public          → show the launch/teaser page
 * - loading         → still resolving (show spinner)
 */
export type AccessLevel = 'loading' | 'full' | 'waitlist_pending' | 'public';

export interface LaunchMessages {
  /** Main headline shown on the launch/pending screen */
  headline: string;
  /** Supporting line shown below the headline */
  subline: string;
}

interface RpcRow {
  access_level: 'full' | 'waitlist_pending' | 'public';
  waitlist_status: 'pending' | 'accepted' | 'none';
  is_whitelisted: boolean;
  phase: SiteAccessMode;
}

// ─── Fallback copy (used when admin hasn't set a message yet) ─────────────────

const FALLBACK_MESSAGES: Record<'public' | 'waitlist_pending', LaunchMessages> = {
  public: {
    headline: DEFAULT_LAUNCH_PAGE_CONTENT.heroMessage,
    subline: DEFAULT_LAUNCH_PAGE_CONTENT.heroSubline,
  },
  waitlist_pending: {
    headline: 'Candidature reçue.',
    subline:
      'Les meilleurs passent en premier. On te contacte dès que c\'est ton tour.',
  },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Resolves the current visitor's access level by combining:
 * 1. settings.site_access_mode  (from Realtime context — zero extra fetch)
 * 2. get_my_launch_access() RPC (only when needed: not admin, not public phase)
 *
 * The RPC is skipped for admins and when site_access_mode === 'public',
 * keeping the happy-path latency near zero.
 */
export function useLaunchAccess() {
  const { user, profile, isInitialized, isProfileLoading } = useAuth();
  const {
    siteAccessMode,
    launchMessagePublic,
    launchMessageWaitlistPending,
    isLoading: isSettingsLoading,
  } = useMaintenanceModeContext();

  const isAdmin = profile?.role === 'admin';

  const [accessLevel, setAccessLevel] = useState<AccessLevel>('loading');
  const [phase, setPhase] = useState<SiteAccessMode>('private');
  const [isRpcLoading, setIsRpcLoading] = useState(false);

  const resolveAccess = useCallback(async () => {
    // Wait for both settings and auth (including profile fetch) to be ready
    if (isSettingsLoading || !isInitialized || isProfileLoading) {
      setAccessLevel('loading');
      return;
    }

    // Admins always have full access — skip RPC
    if (isAdmin) {
      setAccessLevel('full');
      setPhase(siteAccessMode);
      return;
    }

    // Public phase — everyone in, skip RPC
    if (siteAccessMode === 'public') {
      setAccessLevel('full');
      setPhase('public');
      return;
    }

    // Anonymous user — show launch page, skip RPC
    if (!user) {
      setAccessLevel('public');
      setPhase(siteAccessMode);
      return;
    }

    // Authenticated user in private/controlled mode → call RPC
    setIsRpcLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_my_launch_access');
      if (error) throw error;

      const result = data as unknown as RpcRow;
      setAccessLevel(result.access_level);
      setPhase(result.phase);
    } catch (err) {
      console.error('[useLaunchAccess] RPC error — defaulting to public screen', err);
      // Fail-safe: show launch page rather than blocking the user entirely
      setAccessLevel('public');
      setPhase(siteAccessMode);
    } finally {
      setIsRpcLoading(false);
    }
  }, [isSettingsLoading, isInitialized, isProfileLoading, isAdmin, siteAccessMode, user]);

  useEffect(() => {
    void resolveAccess();
  }, [resolveAccess]);

  // Build messages: prefer admin-configured text, fall back to hardcoded copy
  const messages: LaunchMessages =
    accessLevel === 'waitlist_pending'
      ? {
          headline:
            launchMessageWaitlistPending ||
            FALLBACK_MESSAGES.waitlist_pending.headline,
          subline: FALLBACK_MESSAGES.waitlist_pending.subline,
        }
      : {
          headline:
            launchMessagePublic || FALLBACK_MESSAGES.public.headline,
          subline: FALLBACK_MESSAGES.public.subline,
        };

  return {
    accessLevel,
    phase,
    messages,
    isLoading: accessLevel === 'loading' || isRpcLoading,
  };
}
