import { useOutletContext } from 'react-router-dom';
import { AdminBattlesPage } from '../AdminBattles';
import type { AdminLayoutOutletContext } from './AdminLayout';

export function AdminBattlesWrapper() {
  const { setBattlesAwaitingAdminCount } = useOutletContext<AdminLayoutOutletContext>();

  return <AdminBattlesPage onAwaitingAdminCountChange={setBattlesAwaitingAdminCount} />;
}
