import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth/hooks';

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

  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && profile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  if (requireProducer && !profile?.is_producer_active) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
