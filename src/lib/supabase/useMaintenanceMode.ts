import { useCallback, useEffect, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './client';
import type { Database } from './database.types';

type SettingsRow = Database['public']['Tables']['settings']['Row'];
type SettingsUpdate = Database['public']['Tables']['settings']['Update'];
type SettingsRowShape = Pick<
  SettingsRow,
  'id' | 'launch_date' | 'launch_video_url' | 'maintenance_mode' | 'show_homepage_stats' | 'show_pricing_plans' | 'updated_at'
>;

const SETTINGS_SELECT = 'id, launch_date, launch_video_url, maintenance_mode, show_homepage_stats, show_pricing_plans, updated_at';
const SETTINGS_CHANNEL = 'public:settings:maintenance-mode';

function isSettingsRow(value: unknown): value is SettingsRowShape {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string'
    && (typeof candidate.launch_date === 'string' || candidate.launch_date === null)
    && (typeof candidate.launch_video_url === 'string' || candidate.launch_video_url === null)
    && typeof candidate.maintenance_mode === 'boolean'
    && typeof candidate.show_homepage_stats === 'boolean'
    && typeof candidate.show_pricing_plans === 'boolean'
    && typeof candidate.updated_at === 'string'
  );
}

export function useMaintenanceMode() {
  const [maintenance, setMaintenance] = useState(false);
  const [showHomepageStats, setShowHomepageStats] = useState(false);
  const [showPricingPlans, setShowPricingPlans] = useState(true);
  const [launchDate, setLaunchDate] = useState<string | null>(null);
  const [launchVideoUrl, setLaunchVideoUrl] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applySettingsRow = useCallback((row: SettingsRowShape | null) => {
    if (!row) {
      setMaintenance(false);
      setShowHomepageStats(false);
      setShowPricingPlans(true);
      setLaunchDate(null);
      setLaunchVideoUrl(null);
      setSettingsId(null);
      setUpdatedAt(null);
      return;
    }

    setMaintenance(row.maintenance_mode);
    setShowHomepageStats(row.show_homepage_stats);
    setShowPricingPlans(row.show_pricing_plans);
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

    applySettingsRow(data ?? null);
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

    applySettingsRow(data);
    return data;
  }, [applySettingsRow, settingsId]);

  const updateMaintenanceMode = useCallback(async (nextValue: boolean) => {
    return updateSettings({ maintenance_mode: nextValue });
  }, [updateSettings]);

  const updateHomepageStatsVisibility = useCallback(async (nextValue: boolean) => {
    return updateSettings({ show_homepage_stats: nextValue });
  }, [updateSettings]);

  const updatePricingPlansVisibility = useCallback(async (nextValue: boolean) => {
    return updateSettings({ show_pricing_plans: nextValue });
  }, [updateSettings]);

  return {
    maintenance,
    showHomepageStats,
    showPricingPlans,
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
    updatePricingPlansVisibility,
  };
}
