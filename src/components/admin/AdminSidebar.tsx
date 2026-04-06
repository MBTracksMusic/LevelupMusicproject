import { BarChart3, Euro, FolderTree, Inbox, LayoutDashboard, LineChart, MessageSquareText, Newspaper, Rocket, Settings, Sparkles, Swords } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from '../../lib/i18n';

interface AdminNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

interface AdminSidebarProps {
  battlesAwaitingAdminCount?: number | null;
}

export function AdminSidebar({ battlesAwaitingAdminCount = null }: AdminSidebarProps) {
  const { t } = useTranslation();
  const adminNavItems: AdminNavItem[] = [
    {
      to: '/admin',
      label: t('admin.sidebar.dashboard'),
      icon: <LayoutDashboard className="w-4 h-4" />,
      end: true,
    },
    {
      to: '/admin/pilotage',
      label: t('admin.sidebar.pilotage'),
      icon: <LineChart className="w-4 h-4" />,
    },
    {
      to: '/admin/news',
      label: t('admin.sidebar.news'),
      icon: <Newspaper className="w-4 h-4" />,
    },
    {
      to: '/admin/battles',
      label: t('admin.sidebar.battles'),
      icon: <Swords className="w-4 h-4" />,
    },
    {
      to: '/admin/messages',
      label: t('admin.sidebar.messages'),
      icon: <Inbox className="w-4 h-4" />,
    },
    {
      to: '/admin/forum',
      label: t('admin.sidebar.forumModeration'),
      icon: <MessageSquareText className="w-4 h-4" />,
    },
    {
      to: '/admin/forum/categories',
      label: t('admin.sidebar.forumCategories'),
      icon: <FolderTree className="w-4 h-4" />,
    },
    {
      to: '/admin/reputation',
      label: t('admin.sidebar.reputation'),
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      to: '/admin/revenue',
      label: t('admin.sidebar.revenue'),
      icon: <Euro className="w-4 h-4" />,
    },
    {
      to: '/admin/beat-analytics',
      label: t('admin.sidebar.beatAnalytics'),
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      to: '/admin/launch',
      label: 'Lancement',
      icon: <Rocket className="w-4 h-4" />,
    },
    {
      to: '/admin/settings',
      label: t('admin.sidebar.settings'),
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  return (
    <aside className="w-full lg:w-64 lg:shrink-0">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 lg:sticky lg:top-24">
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {t('admin.sidebar.title')}
        </p>
        <nav className="mt-2 flex lg:flex-col gap-2 overflow-x-auto">
          {adminNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-800 border border-transparent',
                ].join(' ')
              }
            >
              {item.icon}
              <span>{item.label}</span>
              {item.to === '/admin/battles' && battlesAwaitingAdminCount !== null && (
                <span
                  className={
                    battlesAwaitingAdminCount > 0
                      ? 'rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/40'
                      : 'rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-400 border border-zinc-700'
                  }
                >
                  {battlesAwaitingAdminCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
