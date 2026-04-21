import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth/hooks';
import { canAccessEliteHub } from '../../lib/auth/elite';
import { LogoLoader } from '../ui/LogoLoader';

interface EliteAccessRouteProps {
  children: ReactNode;
}

export function EliteAccessRoute({ children }: EliteAccessRouteProps) {
  const { profile, isInitialized, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!isInitialized || !profile) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label="Loading elite access..." />
      </div>
    );
  }

  if (!canAccessEliteHub(profile)) {
    return <Navigate to="/label-access" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
