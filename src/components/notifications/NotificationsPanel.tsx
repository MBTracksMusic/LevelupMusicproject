import { AlertCircle, Bell } from 'lucide-react';
import { formatDateTime } from '@/lib/utils/format';
import type { UserNotification } from '@/lib/notifications/hooks';
import { LogoLoader } from '../ui/LogoLoader';
import { Button } from '../ui/Button';

interface NotificationsPanelProps {
  notifications: UserNotification[];
  isLoading: boolean;
  error: string | null;
  emptyTitle: string;
  emptySubtitle: string;
  onRetry?: () => void;
}

export function NotificationsPanel({
  notifications,
  isLoading,
  error,
  emptyTitle,
  emptySubtitle,
  onRetry,
}: NotificationsPanelProps) {
  if (isLoading) {
    return (
      <div className="min-h-[32vh] flex items-center justify-center">
        <LogoLoader label="Loading notifications..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
        <div className="flex items-start gap-2 text-sm text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <div className="space-y-3">
            <p>{error}</p>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="min-h-[32vh] rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="h-14 w-14 rounded-full bg-zinc-800 flex items-center justify-center">
          <Bell className="h-6 w-6 text-zinc-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white">{emptyTitle}</h2>
          <p className="mt-1 text-sm text-zinc-500">{emptySubtitle}</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {notifications.map((notification) => (
        <li
          key={notification.id}
          className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">{notification.title}</p>
              <p className="mt-1 text-sm text-zinc-300">{notification.message}</p>
            </div>
            <p className="shrink-0 text-xs text-zinc-500">
              {formatDateTime(notification.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
