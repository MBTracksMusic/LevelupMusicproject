import { Inbox, LayoutDashboard, Newspaper, Swords } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface AdminNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const adminNavItems: AdminNavItem[] = [
  {
    to: '/admin',
    label: 'Dashboard',
    icon: <LayoutDashboard className="w-4 h-4" />,
    end: true,
  },
  {
    to: '/admin/news',
    label: 'News videos',
    icon: <Newspaper className="w-4 h-4" />,
  },
  {
    to: '/admin/battles',
    label: 'Battles',
    icon: <Swords className="w-4 h-4" />,
  },
  {
    to: '/admin/messages',
    label: 'Messages',
    icon: <Inbox className="w-4 h-4" />,
  },
];

interface AdminSidebarProps {
  battlesAwaitingAdminCount?: number | null;
}

export function AdminSidebar({ battlesAwaitingAdminCount = null }: AdminSidebarProps) {
  return (
    <aside className="w-full lg:w-64 lg:shrink-0">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 lg:sticky lg:top-24">
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Admin
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
