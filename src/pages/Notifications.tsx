import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';
import { useNotifications } from '../lib/notifications/hooks';
import { useTranslation } from '../lib/i18n';

export function NotificationsPage() {
  const { t } = useTranslation();
  const { notifications, isLoading, error, refresh } = useNotifications(30);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-rose-400/80">
              {t('user.notifications')}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-white">
              {t('user.notifications')}
            </h1>
          </div>

          <Link to="/dashboard">
            <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              {t('nav.dashboard')}
            </Button>
          </Link>
        </div>

        <NotificationsPanel
          notifications={notifications}
          isLoading={isLoading}
          error={error ? t('user.notificationsLoadError') : null}
          emptyTitle={t('user.notificationsEmptyTitle')}
          emptySubtitle={t('user.notificationsEmptySubtitle')}
          onRetry={refresh}
        />
      </div>
    </div>
  );
}
