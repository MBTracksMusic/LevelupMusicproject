import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AdminSidebar } from '../../components/admin/AdminSidebar';
import { useTranslation } from '../../lib/i18n';

export interface AdminLayoutOutletContext {
  battlesAwaitingAdminCount: number | null;
  setBattlesAwaitingAdminCount: (count: number) => void;
}

export function AdminLayout() {
  const [battlesAwaitingAdminCount, setBattlesAwaitingAdminCount] = useState<number | null>(null);
  const { t } = useTranslation();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-zinc-950 px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.16em] text-rose-400">{t('admin.layout.badge')}</p>
          <h1 className="mt-2 text-3xl font-bold text-white">{t('admin.layout.title')}</h1>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <AdminSidebar battlesAwaitingAdminCount={battlesAwaitingAdminCount} />
          <div className="flex-1 min-w-0">
            <Outlet context={{ battlesAwaitingAdminCount, setBattlesAwaitingAdminCount }} />
          </div>
        </div>
      </div>
    </div>
  );
}
