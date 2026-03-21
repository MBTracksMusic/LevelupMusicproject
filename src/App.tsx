import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/Home';
import { BeatsPage } from './pages/Beats';
import { BattlesPage } from './pages/Battles';
import { BattleDetailPage } from './pages/BattleDetail';
import { BattleCampaignPage } from './pages/BattleCampaign';
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
import { LeaderboardPage } from './pages/Leaderboard';
import { LeaderboardWeeklyPage } from './pages/LeaderboardWeekly';
import { NotificationsPage } from './pages/Notifications';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboardPage } from './pages/admin/AdminDashboard';
import { AdminNewsPage } from './pages/admin/AdminNews';
import { AdminBattlesWrapper } from './pages/admin/AdminBattlesWrapper';
import { AdminPilotagePage } from './pages/admin/AdminPilotage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { AdminForumPage } from './pages/admin/AdminForum';
import { AdminForumCategoriesPage } from './pages/admin/AdminForumCategories';
import { AdminBeatAnalyticsPage } from './pages/admin/AdminBeatAnalytics';
import { ProducerGuide } from './pages/support/ProducerGuide';
import { Faq } from './pages/support/Faq';
import { ContactPage } from './pages/support/Contact';
import { Terms } from './pages/legal/Terms';
import { Privacy } from './pages/legal/Privacy';
import { Licenses } from './pages/legal/Licenses';
import { ForumPage } from './pages/forum/ForumPage';
import { ForumCategoryPage } from './pages/ForumCategory';
import { TopicPage } from './pages/forum/TopicPage';
import { CreateTopicPage } from './pages/forum/CreateTopic';
import { MyMessagesPage } from './pages/dashboard/MyMessages';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { initializeAuth } from './lib/auth/store';
import { useCartStore } from './lib/stores/cart';
import { useAuth } from './lib/auth/hooks';
import { useTranslation } from './lib/i18n';
import { AdminMessagesPage } from './pages/admin/AdminMessages';
import { AdminMessageDetailPage } from './pages/admin/AdminMessageDetail';
import { AdminReputationPage } from './pages/admin/AdminReputation';
import { LogoLoader } from './components/ui/LogoLoader';
import { MaintenanceScreen } from './components/system/MaintenanceScreen';
import { MaintenanceModeProvider } from './lib/supabase/MaintenanceModeContext';
import { useMaintenanceMode } from './lib/supabase/useMaintenanceMode';

const MAINTENANCE_BYPASS_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/email-confirmation',
]);

function AppContent() {
  const { user, isInitialized } = useAuth();
  const fetchCart = useCartStore((state) => state.fetchCart);
  const location = useLocation();

  useEffect(() => {
    if (isInitialized && user) {
      fetchCart();
    }
  }, [user, isInitialized, fetchCart]);

  const shouldBypassAuthBootstrapLoader =
    location.pathname === '/reset-password' || location.pathname === '/email-confirmation';

  if (!isInitialized && !shouldBypassAuthBootstrapLoader) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label="Initializing Beatelion..." iconClassName="h-14 w-14" />
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
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="beats" element={<BeatsPage mode="beats" />} />
        <Route path="beats/:slug" element={<ProductDetailsPage />} />
        {/* TODO(levelup): sections exclusives/kits temporairement desactivees (focus Beats + Battles). */}
        <Route path="exclusives" element={<Navigate to="/beats" replace />} />
        <Route path="exclusives/:slug" element={<Navigate to="/beats" replace />} />
        <Route path="kits" element={<Navigate to="/beats" replace />} />
        <Route path="kits/:slug" element={<Navigate to="/beats" replace />} />
        <Route path="battles" element={<BattlesPage />} />
        <Route path="battles/:slug" element={<BattleDetailPage />} />
        <Route path="battle-campaign/:slug" element={<BattleCampaignPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="leaderboard-weekly" element={<LeaderboardWeeklyPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="tarifs" element={<PricingPage />} />
        <Route path="guide-producteur" element={<ProducerGuide />} />
        <Route path="faq" element={<Faq />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="/forum" element={<ForumPage />} />
        <Route
          path="/forum/new"
          element={
            <ProtectedRoute>
              <CreateTopicPage />
            </ProtectedRoute>
          }
        />
        <Route path="/forum/:categorySlug" element={<ForumCategoryPage />} />
        <Route path="/forum/:categorySlug/:topicSlug" element={<TopicPage />} />
        <Route path="/licenses" element={<Licenses />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route
          path="cart"
          element={
            <ProtectedRoute>
              <CartPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="wishlist"
          element={
            <ProtectedRoute>
              <WishlistPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <ProtectedRoute>
              <NotificationsPage />
            </ProtectedRoute>
          }
        />
        <Route path="producers" element={<ProducersPage />} />
        <Route path="producers/:username" element={<ProducerPublicProfilePage />} />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="dashboard/messages"
          element={
            <ProtectedRoute>
              <MyMessagesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="producer"
          element={
            <ProtectedRoute requireProducer>
              <ProducerDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="producer/upload"
          element={
            <ProtectedRoute requireProducer>
              <UploadBeatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="producer/battles"
          element={
            <ProtectedRoute requireProducer>
              <ProducerBattlesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="pilotage" element={<AdminPilotagePage />} />
          <Route path="news" element={<AdminNewsPage />} />
          <Route path="battles" element={<AdminBattlesWrapper />} />
          <Route path="messages" element={<AdminMessagesPage />} />
          <Route path="messages/:id" element={<AdminMessageDetailPage />} />
          <Route path="forum" element={<AdminForumPage />} />
          <Route path="forum/categories" element={<AdminForumCategoriesPage />} />
          <Route path="beat-analytics" element={<AdminBeatAnalyticsPage />} />
          <Route path="reputation" element={<AdminReputationPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-white mb-4">404</h1>
      <p className="text-zinc-400 text-lg">{t('errors.notFound')}</p>
    </div>
  );
}

function AppShell({
  maintenance,
  launchDate,
  launchVideoUrl,
  isMaintenanceLoading,
}: {
  maintenance: boolean;
  launchDate: string | null;
  launchVideoUrl: string | null;
  isMaintenanceLoading: boolean;
}) {
  const { profile, isInitialized } = useAuth();
  const location = useLocation();
  const isAdmin = profile?.role === 'admin';
  const canBypassMaintenance = MAINTENANCE_BYPASS_PATHS.has(location.pathname);

  if (isMaintenanceLoading || (maintenance && !isAdmin && !canBypassMaintenance && !isInitialized)) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label="Initializing Beatelion..." iconClassName="h-14 w-14" />
      </div>
    );
  }

  if (maintenance && !isAdmin && !canBypassMaintenance) {
    return (
      <MaintenanceScreen launchDate={launchDate} launchVideoUrl={launchVideoUrl} />
    );
  }

  return <AppContent />;
}

function App() {
  useEffect(() => {
    const unsubscribe = initializeAuth();
    return unsubscribe;
  }, []);

  const maintenanceMode = useMaintenanceMode();
  const {
    maintenance,
    launchDate,
    launchVideoUrl,
    isLoading: isMaintenanceLoading,
  } = maintenanceMode;

  return (
    <MaintenanceModeProvider value={maintenanceMode}>
      <BrowserRouter>
        <AppShell
          maintenance={maintenance}
          launchDate={launchDate}
          launchVideoUrl={launchVideoUrl}
          isMaintenanceLoading={isMaintenanceLoading}
        />
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
    </MaintenanceModeProvider>
  );
}

export default App;
