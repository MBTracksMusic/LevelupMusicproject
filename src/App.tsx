import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { initializeAuth } from './lib/auth/store';
import { useCartStore } from './lib/stores/cart';
import { useAuth } from './lib/auth/hooks';
import { useTranslation } from './lib/i18n';
import { LogoLoader } from './components/ui/LogoLoader';
import { AnalyticsTracker } from './components/system/AnalyticsTracker';
import { CookieBanner } from './components/system/CookieBanner';
import { LaunchScreen } from './components/system/LaunchScreen';
import { WaitlistPendingScreen } from './components/system/WaitlistPendingScreen';
import { MaintenanceModeProvider } from './lib/supabase/MaintenanceModeContext';
import { useMaintenanceMode } from './lib/supabase/useMaintenanceMode';
import { useLaunchAccess } from './lib/supabase/useLaunchAccess';
import { initAnalytics, setAnalyticsUserId } from './lib/analytics';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { GlobalAudioPlayer } from './components/player/GlobalAudioPlayer';

/** Auth routes that must always be reachable, regardless of launch phase */
const LAUNCH_BYPASS_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/email-confirmation',
]);

function lazyNamed(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType<any> };
  });
}

const HomePage = lazyNamed(() => import('./pages/Home'), 'HomePage');
const BeatsPage = lazyNamed(() => import('./pages/Beats'), 'BeatsPage');
const BattlesPage = lazyNamed(() => import('./pages/Battles'), 'BattlesPage');
const BattleDetailPage = lazyNamed(() => import('./pages/BattleDetail'), 'BattleDetailPage');
const BattleCampaignPage = lazyNamed(() => import('./pages/BattleCampaign'), 'BattleCampaignPage');
const PricingPage = lazyNamed(() => import('./pages/Pricing'), 'PricingPage');
const LoginPage = lazyNamed(() => import('./pages/auth/Login'), 'LoginPage');
const RegisterPage = lazyNamed(() => import('./pages/auth/Register'), 'RegisterPage');
const EmailConfirmation = lazy(() => import('./pages/auth/EmailConfirmation'));
const ForgotPasswordPage = lazyNamed(() => import('./pages/auth/ForgotPassword'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyNamed(() => import('./pages/auth/ResetPassword'), 'ResetPasswordPage');
const DashboardPage = lazyNamed(() => import('./pages/Dashboard'), 'DashboardPage');
const SettingsPage = lazyNamed(() => import('./pages/Settings'), 'SettingsPage');
const ProducerDashboardPage = lazyNamed(() => import('./pages/ProducerDashboard'), 'ProducerDashboardPage');
const ProducerBattlesPage = lazyNamed(() => import('./pages/ProducerBattles'), 'ProducerBattlesPage');
const UploadBeatPage = lazyNamed(() => import('./pages/UploadBeat'), 'UploadBeatPage');
const ProducerStripeConnect = lazyNamed(() => import('./pages/ProducerStripeConnect'), 'ProducerStripeConnectPage');
const ProducerEarnings = lazyNamed(() => import('./pages/ProducerEarnings'), 'ProducerEarnings');
const CartPage = lazyNamed(() => import('./pages/Cart'), 'CartPage');
const WishlistPage = lazyNamed(() => import('./pages/Wishlist'), 'WishlistPage');
const ProductDetailsPage = lazyNamed(() => import('./pages/ProductDetails'), 'ProductDetailsPage');
const ProducersPage = lazyNamed(() => import('./pages/Producers'), 'ProducersPage');
const ProducerPublicProfilePage = lazyNamed(
  () => import('./pages/ProducerPublicProfilePage'),
  'ProducerPublicProfilePage',
);
const LeaderboardPage = lazyNamed(() => import('./pages/Leaderboard'), 'LeaderboardPage');
const LeaderboardWeeklyPage = lazyNamed(() => import('./pages/LeaderboardWeekly'), 'LeaderboardWeeklyPage');
const NotificationsPage = lazyNamed(() => import('./pages/Notifications'), 'NotificationsPage');
const AdminLayout = lazyNamed(() => import('./pages/admin/AdminLayout'), 'AdminLayout');
const AdminDashboardPage = lazyNamed(() => import('./pages/admin/AdminDashboard'), 'AdminDashboardPage');
const AdminNewsPage = lazyNamed(() => import('./pages/admin/AdminNews'), 'AdminNewsPage');
const AdminBattlesWrapper = lazyNamed(() => import('./pages/admin/AdminBattlesWrapper'), 'AdminBattlesWrapper');
const AdminPilotagePage = lazyNamed(() => import('./pages/admin/AdminPilotage'), 'AdminPilotagePage');
const AdminSettingsPage = lazyNamed(() => import('./pages/admin/AdminSettingsPage'), 'AdminSettingsPage');
const AdminLaunchPage = lazyNamed(() => import('./pages/admin/AdminLaunchPage'), 'AdminLaunchPage');
const AdminForumPage = lazyNamed(() => import('./pages/admin/AdminForum'), 'AdminForumPage');
const AdminForumCategoriesPage = lazyNamed(
  () => import('./pages/admin/AdminForumCategories'),
  'AdminForumCategoriesPage',
);
const AdminBeatAnalyticsPage = lazyNamed(
  () => import('./pages/admin/AdminBeatAnalytics'),
  'AdminBeatAnalyticsPage',
);
const ProducerGuide = lazyNamed(() => import('./pages/support/ProducerGuide'), 'ProducerGuide');
const Faq = lazyNamed(() => import('./pages/support/Faq'), 'Faq');
const ContactPage = lazyNamed(() => import('./pages/support/Contact'), 'ContactPage');
const Terms = lazyNamed(() => import('./pages/legal/Terms'), 'Terms');
const Privacy = lazyNamed(() => import('./pages/legal/Privacy'), 'Privacy');
const Licenses = lazyNamed(() => import('./pages/legal/Licenses'), 'Licenses');
const ForumPage = lazyNamed(() => import('./pages/forum/ForumPage'), 'ForumPage');
const ForumCategoryPage = lazyNamed(() => import('./pages/ForumCategory'), 'ForumCategoryPage');
const TopicPage = lazyNamed(() => import('./pages/forum/TopicPage'), 'TopicPage');
const CreateTopicPage = lazyNamed(() => import('./pages/forum/CreateTopic'), 'CreateTopicPage');
const MyMessagesPage = lazyNamed(() => import('./pages/dashboard/MyMessages'), 'MyMessagesPage');
const AdminMessagesPage = lazyNamed(() => import('./pages/admin/AdminMessages'), 'AdminMessagesPage');
const AdminMessageDetailPage = lazyNamed(
  () => import('./pages/admin/AdminMessageDetail'),
  'AdminMessageDetailPage',
);
const AdminReputationPage = lazyNamed(() => import('./pages/admin/AdminReputation'), 'AdminReputationPage');
const AdminPayouts = lazyNamed(() => import('./pages/admin/AdminPayouts'), 'AdminPayouts');
const AdminRevenuePage = lazyNamed(() => import('./pages/admin/AdminRevenue'), 'AdminRevenuePage');

function RouteFallback() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <LogoLoader label="Loading page..." iconClassName="h-14 w-14" />
    </div>
  );
}

function AppContent() {
  const { user, isInitialized } = useAuth();
  const fetchCart = useCartStore((state) => state.fetchCart);
  const location = useLocation();

  useEffect(() => {
    if (isInitialized && user) {
      fetchCart();
    }
  }, [user, isInitialized, fetchCart]);

  useEffect(() => {
    if (user?.id) {
      setAnalyticsUserId(user.id);
    }
  }, [user?.id]);

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
    <Suspense fallback={<RouteFallback />}>
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
            path="producer/stripe-connect"
            element={
              <ProtectedRoute requireProducer>
                <ProducerStripeConnect />
              </ProtectedRoute>
            }
          />
          <Route
            path="producer/earnings"
            element={
              <ProtectedRoute requireProducer>
                <ProducerEarnings />
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
            <Route path="revenue" element={<AdminRevenuePage />} />
            <Route path="payouts" element={<AdminPayouts />} />
            <Route path="launch" element={<AdminLaunchPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
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

function AppShell() {
  const location = useLocation();
  const { accessLevel, messages, isLoading } = useLaunchAccess();

  // Auth paths are always reachable regardless of launch phase
  if (LAUNCH_BYPASS_PATHS.has(location.pathname)) {
    return <AppContent />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LogoLoader label="Initializing Beatelion..." iconClassName="h-14 w-14" />
      </div>
    );
  }

  if (accessLevel === 'full') {
    return <AppContent />;
  }

  if (accessLevel === 'waitlist_pending') {
    return <WaitlistPendingScreen messages={messages} />;
  }

  // 'public' → launch/teaser page
  return <LaunchScreen messages={messages} />;
}

function App() {
  useEffect(() => {
    const unsubscribe = initializeAuth();
    return unsubscribe;
  }, []);

  useEffect(() => {
    void initAnalytics();
  }, []);

  const maintenanceMode = useMaintenanceMode();

  return (
    <AudioPlayerProvider>
      <MaintenanceModeProvider value={maintenanceMode}>
        <BrowserRouter>
          <AnalyticsTracker />
          <AppShell />
          <GlobalAudioPlayer />
          <CookieBanner />
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
    </AudioPlayerProvider>
  );
}

export default App;
