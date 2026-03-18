import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/hooks';

export type UserNotification = {
  id: string;
  user_id: string;
  purchase_id: string | null;
  type: string;
  title: string;
  message: string;
  created_at: string;
};

const DEFAULT_LIMIT = 25;

export function useNotifications(limit = DEFAULT_LIMIT) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('notifications')
      .select('id, user_id, purchase_id, type, title, message, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (queryError) {
      console.error('Error loading notifications:', queryError);
      setNotifications([]);
      setError(queryError.message);
      setIsLoading(false);
      return;
    }

    setNotifications((data as UserNotification[] | null) ?? []);
    setIsLoading(false);
  }, [limit, user?.id]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  return {
    notifications,
    isLoading,
    error,
    refresh: fetchNotifications,
  };
}
