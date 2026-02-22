import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/Home';
import { BeatsPage } from './pages/Beats';
import { BattlesPage } from './pages/Battles';
import { BattleDetailPage } from './pages/BattleDetail';
import { PricingPage } from './pages/Pricing';
import { LoginPage } from './pages/auth/Login';
import { RegisterPage } from './pages/auth/Register';
import EmailConfirmation from './pages/auth/EmailConfirmation';
import { ForgotPasswordPage } from './pages/auth/ForgotPassword';
import { ResetPasswordPage } from './pages/auth/ResetPassword';
import { DashboardPage } from './pages/Dashboard';
import { SettingsPage } from './pages/Settings';
import { ProducerDashboardPage } from './pages/ProducerDashboard';
import { ProducerBattlesPage } from './pages/ProducerBattles';
import { UploadBeatPage } from './pages/UploadBeat';
import { CartPage } from './pages/Cart';
import { WishlistPage } from './pages/Wishlist';
import { ProductDetailsPage } from './pages/ProductDetails';
import { ProducersPage } from './pages/Producers';
import { ProducerPublicProfilePage } from './pages/ProducerPublicProfilePage';
import { AdminBattlesPage } from './pages/AdminBattles';
import { ProducerGuide } from './pages/support/ProducerGuide';
import { Faq } from './pages/support/Faq';
import { Terms } from './pages/legal/Terms';
import { Privacy } from './pages/legal/Privacy';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { initializeAuth } from './lib/auth/store';
import { useCartStore } from './lib/stores/cart';
import { useAuth } from './lib/auth/hooks';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

function AppContent() {
  const { user, isInitialized } = useAuth();
  const fetchCart = useCartStore((state) => state.fetchCart);

  useEffect(() => {
    if (isInitialized && user) {
      fetchCart();
    }
  }, [user, isInitialized, fetchCart]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/email-confirmation" element={<EmailConfirmation />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/beats" element={<BeatsPage mode="beats" />} />
              <Route path="/beats/:slug" element={<ProductDetailsPage />} />
              <Route path="/exclusives" element={<BeatsPage mode="exclusives" />} />
              <Route path="/exclusives/:slug" element={<ProductDetailsPage />} />
              <Route path="/kits" element={<BeatsPage mode="kits" />} />
              <Route path="/kits/:slug" element={<ProductDetailsPage />} />
              <Route path="/battles" element={<BattlesPage />} />
              <Route path="/battles/:slug" element={<BattleDetailPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/guide-producteur" element={<ProducerGuide />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route
                path="/cart"
                element={
                  <ProtectedRoute>
                    <CartPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/wishlist"
                element={
                  <ProtectedRoute>
                    <WishlistPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/producers" element={<ProducersPage />} />
              <Route path="/producers/:username" element={<ProducerPublicProfilePage />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/producer"
                element={
                  <ProtectedRoute requireProducer>
                    <ProducerDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/producer/upload"
                element={
                  <ProtectedRoute requireProducer>
                    <UploadBeatPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/producer/battles"
                element={
                  <ProtectedRoute requireProducer>
                    <ProducerBattlesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/battles"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminBattlesPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-white mb-4">404</h1>
      <p className="text-zinc-400 text-lg">Page non trouvee</p>
    </div>
  );
}

function App() {
  useEffect(() => {
    const unsubscribe = initializeAuth();
    return unsubscribe;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid #27272a',
            },
            success: {
              iconTheme: {
                primary: '#f43f5e',
                secondary: '#fff',
              },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
