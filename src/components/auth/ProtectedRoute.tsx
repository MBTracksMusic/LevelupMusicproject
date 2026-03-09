import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth/hooks';
import { LogoLoader } from '../ui/LogoLoader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProducer?: boolean;
  requireAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireProducer = false,
  requireAdmin = false
}: ProtectedRouteProps) {
  const { user, profile, isInitialized, isLoading } = useAuth();
  const location = useLocation();
  const isProducerAllowed = profile?.is_producer_active === true || profile?.role === 'admin';

  if (isLoading) {
    return null;
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label="Loading secure area..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && profile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  if (requireProducer && !isProducerAllowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
