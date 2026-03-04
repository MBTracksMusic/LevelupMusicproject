import type { ReactNode } from 'react';
import { AlertTriangle, BellRing, Clock3 } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useTranslation } from '../../lib/i18n';

interface AdminPriorityCardsProps {
  awaitingAdminCount: number;
  expiringCount: number;
  notificationCount: number;
}

interface PriorityCard {
  key: string;
  label: string;
  value: number;
  icon: ReactNode;
  tone: 'danger' | 'warning' | 'info' | 'default';
}

export function AdminPriorityCards({
  awaitingAdminCount,
  expiringCount,
  notificationCount,
}: AdminPriorityCardsProps) {
  const { t } = useTranslation();
  const cards: PriorityCard[] = [
    {
      key: 'awaiting-admin',
      label: t('admin.battles.awaitingAdminLabel'),
      value: awaitingAdminCount,
      icon: <AlertTriangle className="w-4 h-4" />,
      tone: awaitingAdminCount > 0 ? 'warning' : 'default',
    },
    {
      key: 'expiring',
      label: t('admin.battles.expiringSoon'),
      value: expiringCount,
      icon: <Clock3 className="w-4 h-4" />,
      tone: expiringCount > 0 ? 'danger' : 'default',
    },
    {
      key: 'notifications',
      label: t('admin.battles.unreadNotificationsLabel'),
      value: notificationCount,
      icon: <BellRing className="w-4 h-4" />,
      tone: notificationCount > 0 ? 'info' : 'default',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {cards.map((card) => (
        <Card key={card.key} className="p-4 bg-zinc-900/80 border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">{card.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{card.value}</p>
            </div>
            <Badge variant={card.tone}>{card.icon}</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}
