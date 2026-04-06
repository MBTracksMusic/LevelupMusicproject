import { useCallback, useEffect, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './client';
import type { Database } from './database.types';

type SettingsUpdate = Database['public']['Tables']['settings']['Update'];

export interface PricingVisibility {
  free: boolean;
  userPremium: boolean;
  producer: boolean;
  producerElite: boolean;
}

export type SiteAccessMode = 'private' | 'controlled' | 'public';

/**
 * Explicit interface for the settings row shape read by this hook.
 * Defined as a standalone interface (not a Pick<>) so new columns added
 * via migration are accessible before database.types.ts is regenerated.
 */
interface SettingsRowShape {
  id: string;
  launch_date: string | null;
  launch_video_url: string | null;
  maintenance_mode: boolean;
  site_access_mode: SiteAccessMode;
  launch_message_public: string | null;
  launch_message_waitlist_pending: string | null;
  launch_message_whitelist: string | null;
  show_homepage_stats: boolean;
  show_free_plan: boolean;
  show_user_premium_plan: boolean;
  show_user_premium_credits: boolean;
  show_producer_plan: boolean;
  show_producer_elite_plan: boolean;
  updated_at: string;
}

const DEFAULT_PRICING_VISIBILITY: PricingVisibility = {
  free: true,
  userPremium: true,
  producer: true,
  producerElite: true,
};

const SETTINGS_SELECT = [
  'id',
  'launch_date',
  'launch_video_url',
  'maintenance_mode',
  'site_access_mode',
  'launch_message_public',
  'launch_message_waitlist_pending',
  'launch_message_whitelist',
  'show_homepage_stats',
  'show_free_plan',
  'show_user_premium_plan',
  'show_user_premium_credits',
  'show_producer_plan',
  'show_producer_elite_plan',
  'updated_at',
].join(', ');

const SETTINGS_CHANNEL = 'public:settings:maintenance-mode';

const isSiteAccessMode = (value: unknown): value is SiteAccessMode =>
  value === 'private' || value === 'controlled' || value === 'public';

function isSettingsRow(value: unknown): value is SettingsRowShape {
  if (!value || typeof value !== 'object') return false;

  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string'
    && (typeof c.launch_date === 'string' || c.launch_date === null)
    && (typeof c.launch_video_url === 'string' || c.launch_video_url === null)
    && typeof c.maintenance_mode === 'boolean'
    && isSiteAccessMode(c.site_access_mode)
    && (typeof c.launch_message_public === 'string' || c.launch_message_public === null)
    && (typeof c.launch_message_waitlist_pending === 'string' || c.launch_message_waitlist_pending === null)
    && (typeof c.launch_message_whitelist === 'string' || c.launch_message_whitelist === null)
    && typeof c.show_homepage_stats === 'boolean'
    && typeof c.show_free_plan === 'boolean'
    && typeof c.show_user_premium_plan === 'boolean'
    && typeof c.show_user_premium_credits === 'boolean'
    && typeof c.show_producer_plan === 'boolean'
    && typeof c.show_producer_elite_plan === 'boolean'
    && typeof c.updated_at === 'string'
  );
}

export function useMaintenanceMode() {
  const [maintenance, setMaintenance] = useState(false);
  const [siteAccessMode, setSiteAccessMode] = useState<SiteAccessMode>('private');
  const [launchMessagePublic, setLaunchMessagePublic] = useState<string | null>(null);
  const [launchMessageWaitlistPending, setLaunchMessageWaitlistPending] = useState<string | null>(null);
  const [launchMessageWhitelist, setLaunchMessageWhitelist] = useState<string | null>(null);
  const [showHomepageStats, setShowHomepageStats] = useState(false);
  const [showUserPremiumCredits, setShowUserPremiumCredits] = useState(true);
  const [pricingVisibility, setPricingVisibility] = useState<PricingVisibility>(DEFAULT_PRICING_VISIBILITY);
  const [launchDate, setLaunchDate] = useState<string | null>(null);
  const [launchVideoUrl, setLaunchVideoUrl] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applySettingsRow = useCallback((row: SettingsRowShape | null) => {
    if (!row) {
      setMaintenance(false);
      setSiteAccessMode('private');
      setLaunchMessagePublic(null);
      setLaunchMessageWaitlistPending(null);
      setLaunchMessageWhitelist(null);
      setShowHomepageStats(false);
      setShowUserPremiumCredits(true);
      setPricingVisibility(DEFAULT_PRICING_VISIBILITY);
      setLaunchDate(null);
      setLaunchVideoUrl(null);
      setSettingsId(null);
      setUpdatedAt(null);
      return;
    }

    setMaintenance(row.maintenance_mode);
    setSiteAccessMode(row.site_access_mode ?? 'private');
    setLaunchMessagePublic(row.launch_message_public ?? null);
    setLaunchMessageWaitlistPending(row.launch_message_waitlist_pending ?? null);
    setLaunchMessageWhitelist(row.launch_message_whitelist ?? null);
    setShowHomepageStats(row.show_homepage_stats);
    setShowUserPremiumCredits(row.show_user_premium_credits);
    setPricingVisibility({
      free: row.show_free_plan,
      userPremium: row.show_user_premium_plan,
      producer: row.show_producer_plan,
      producerElite: row.show_producer_elite_plan,
    });
    setLaunchDate(row.launch_date);
    setLaunchVideoUrl(row.launch_video_url ?? null);
    setSettingsId(row.id);
    setUpdatedAt(row.updated_at);
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('settings')
      .select(SETTINGS_SELECT)
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
      setIsLoading(false);
      return null;
    }

    // Cast needed until database.types.ts is regenerated after migration
    applySettingsRow((data as unknown as SettingsRowShape) ?? null);
    setIsLoading(false);
    return data ?? null;
  }, [applySettingsRow]);

  useEffect(() => {
    void refresh();

    const channelName = `${SETTINGS_CHANNEL}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settings' },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          if (payload.eventType === 'DELETE') {
            applySettingsRow(null);
            return;
          }

          if (isSettingsRow(payload.new)) {
            applySettingsRow(payload.new);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applySettingsRow, refresh]);

  const updateSettings = useCallback(async (updates: SettingsUpdate) => {
    if (!settingsId) {
      throw new Error('Maintenance settings row is missing');
    }

    const { data, error: updateError } = await supabase
      .from('settings')
      .update(updates)
      .eq('id', settingsId)
      .select(SETTINGS_SELECT)
      .single();

    if (updateError) {
      throw updateError;
    }

    // Cast needed until database.types.ts is regenerated after migration
    applySettingsRow(data as unknown as SettingsRowShape);
    return data;
  }, [applySettingsRow, settingsId]);

  const updateMaintenanceMode = useCallback(async (nextValue: boolean) => {
    return updateSettings({ maintenance_mode: nextValue });
  }, [updateSettings]);

  const updateHomepageStatsVisibility = useCallback(async (nextValue: boolean) => {
    return updateSettings({ show_homepage_stats: nextValue });
  }, [updateSettings]);

  const updateUserPremiumCreditsVisibility = useCallback(async (nextValue: boolean) => {
    return updateSettings({ show_user_premium_credits: nextValue });
  }, [updateSettings]);

  const updatePricingPlansVisibility = useCallback(async (nextValue: PricingVisibility) => {
    return updateSettings({
      show_free_plan: nextValue.free,
      show_user_premium_plan: nextValue.userPremium,
      show_producer_plan: nextValue.producer,
      show_producer_elite_plan: nextValue.producerElite,
    });
  }, [updateSettings]);

  const showFreePlan = pricingVisibility.free;
  const showUserPremiumPlan = pricingVisibility.userPremium;
  const showProducerPlan = pricingVisibility.producer;
  const showProducerElitePlan = pricingVisibility.producerElite;

  return {
    maintenance,
    siteAccessMode,
    launchMessagePublic,
    launchMessageWaitlistPending,
    launchMessageWhitelist,
    showHomepageStats,
    showUserPremiumCredits,
    pricingVisibility,
    showFreePlan,
    showUserPremiumPlan,
    showProducerPlan,
    showProducerElitePlan,
    launchDate,
    launchVideoUrl,
    settingsId,
    updatedAt,
    isLoading,
    error,
    refresh,
    updateSettings,
    updateMaintenanceMode,
    updateHomepageStatsVisibility,
    updateUserPremiumCreditsVisibility,
    updatePricingPlansVisibility,
  };
}
