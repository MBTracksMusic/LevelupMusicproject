import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
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

export interface EloLeaderboardEntry {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  producer_tier: string | null;
  elo_rating: number;
  battle_wins: number;
  battle_losses: number;
  battle_draws: number;
  total_battles: number;
  win_rate: number;
  rank_position: number;
}

export interface WeeklyLeaderboardEntry {
  user_id: string;
  username: string | null;
  weekly_wins: number;
  weekly_losses: number;
  weekly_winrate: number;
  rank_position: number;
}

export interface SeasonLeaderboardEntry {
  season_id: string;
  season_name: string;
  start_date: string;
  end_date: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  producer_tier: string | null;
  elo_rating: number;
  battle_wins: number;
  battle_losses: number;
  battle_draws: number;
  total_battles: number;
  win_rate: number;
  rank_position: number;
}

export interface ActiveSeasonDetails {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
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
  const { user } = useAuth();
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setEntries([]);
      setError(null);
      setIsLoading(false);
      return;
    }

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
  }, [period, source, t, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, isLoading, error, refresh };
}

export function useEloLeaderboard(limit = 100) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<EloLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('leaderboard_producers' as any)
      .select(`
        user_id,
        username,
        avatar_url,
        producer_tier,
        elo_rating,
        battle_wins,
        battle_losses,
        battle_draws,
        total_battles,
        win_rate,
        rank_position
      `)
      .order('rank_position', { ascending: true })
      .limit(limit);

    if (fetchError) {
      console.error('Error loading ELO leaderboard:', fetchError);
      setEntries([]);
      setError(t('leaderboard.empty'));
      setIsLoading(false);
      return;
    }

    setEntries((data as unknown as EloLeaderboardEntry[] | null) ?? []);
    setIsLoading(false);
  }, [limit, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, isLoading, error, refresh };
}

export function useWeeklyLeaderboard(limit = 50) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<WeeklyLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase.rpc('get_weekly_leaderboard' as any, {
      p_limit: limit,
    });

    if (fetchError) {
      console.error('Error loading weekly leaderboard:', fetchError);
      setEntries([]);
      setError(t('leaderboard.empty'));
      setIsLoading(false);
      return;
    }

    setEntries((data as WeeklyLeaderboardEntry[] | null) ?? []);
    setIsLoading(false);
  }, [limit, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, isLoading, error, refresh };
}

export function useSeasonLeaderboard(limit = 100) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SeasonLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('season_leaderboard' as any)
      .select(`
        season_id,
        season_name,
        start_date,
        end_date,
        user_id,
        username,
        avatar_url,
        producer_tier,
        elo_rating,
        battle_wins,
        battle_losses,
        battle_draws,
        total_battles,
        win_rate,
        rank_position
      `)
      .order('rank_position', { ascending: true })
      .limit(limit);

    if (fetchError) {
      console.error('Error loading season leaderboard:', fetchError);
      setEntries([]);
      setError(t('leaderboard.empty'));
      setIsLoading(false);
      return;
    }

    setEntries((data as unknown as SeasonLeaderboardEntry[] | null) ?? []);
    setIsLoading(false);
  }, [limit, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, isLoading, error, refresh };
}

export function useActiveSeason() {
  const [season, setSeason] = useState<ActiveSeasonDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    const { data, error } = await supabase.rpc('get_active_season_details' as any);
    if (error) {
      console.error('Error loading active season:', error);
      setSeason(null);
      setIsLoading(false);
      return;
    }

    const row = (Array.isArray(data) ? data[0] : data) as ActiveSeasonDetails | null;
    setSeason(row);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { season, isLoading, refresh };
}
