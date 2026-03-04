import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase/client';
import { useAuth } from '../auth/hooks';
import { useTranslation } from '../i18n';
import type { ReputationRankTier, UserReputation } from '../supabase/types';

export interface LeaderboardEntry {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  producer_tier: string | null;
  xp: number;
  level: number;
  rank_tier: ReputationRankTier;
  forum_xp: number;
  battle_xp: number;
  commerce_xp: number;
  reputation_score: number;
  period_xp: number;
}

export function useMyReputation() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setReputation(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('user_reputation' as any)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error loading user reputation:', fetchError);
      setReputation(null);
      setError(t('user.reputationLoadError'));
      setIsLoading(false);
      return;
    }

    setReputation((data as UserReputation | null) ?? null);
    setIsLoading(false);
  }, [t, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { reputation, isLoading, error, refresh };
}

export function useLeaderboard(period: 'week' | 'month', source: 'overall' | 'forum' | 'battle') {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('rpc_get_leaderboard' as any, {
      p_period: period,
      p_source: source,
      p_limit: 25,
    });

    if (rpcError) {
      console.error('Error loading leaderboard:', rpcError);
      setEntries([]);
      setError(t('leaderboard.empty'));
      setIsLoading(false);
      return;
    }

    setEntries((data as LeaderboardEntry[] | null) ?? []);
    setIsLoading(false);
  }, [period, source, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, isLoading, error, refresh };
}
