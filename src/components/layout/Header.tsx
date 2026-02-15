import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Menu,
  X,
  Search,
  ShoppingCart,
  ShoppingBag,
  Heart,
  User,
  LogOut,
  Settings,
  LayoutDashboard,
  Music,
  Globe,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuth } from '../../lib/auth/hooks';
import { useTranslation, languageNames, type Language } from '../../lib/i18n';
import { useCartStore } from '../../lib/stores/cart';

export function Header() {
  const { t, language, setLanguage, languages } = useTranslation();
  const { user, profile, signOut } = useAuth();
  const { items } = useCartStore();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const cartItemCount = items.length;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
                <Music className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white hidden sm:block">
                LevelupMusic
              </span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              <Link
                to="/beats"
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {t('nav.beats')}
              </Link>
              <Link
                to="/exclusives"
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {t('nav.exclusives')}
              </Link>
              <Link
                to="/kits"
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {t('nav.kits')}
              </Link>
              <Link
                to="/battles"
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {t('nav.battles')}
              </Link>
              <Link
                to="/producers"
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {t('nav.producers')}
              </Link>
              <Link
                to="/pricing"
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {t('nav.pricing')}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center relative">
              <Search className="absolute left-3 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder={t('home.searchPlaceholder')}
                className="w-64 pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="p-2 text-zinc-400 hover:text-white transition-colors"
              >
                <Globe className="w-5 h-5" />
              </button>
              {isLangMenuOpen && (
                <>
                  <div
                    className="fixed inset-0"
                    onClick={() => setIsLangMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-32 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden">
                    {languages.map((lang) => (
                      <button
                        key={lang}
                        onClick={() => {
                          setLanguage(lang as Language);
                          setIsLangMenuOpen(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-800 transition-colors ${
                          language === lang ? 'text-rose-400' : 'text-zinc-300'
                        }`}
                      >
                        {languageNames[lang as Language]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {user && (
              <>
                <Link
                  to="/wishlist"
                  className="p-2 text-zinc-400 hover:text-white transition-colors"
                >
                  <Heart className="w-5 h-5" />
                </Link>
                <Link
                  to="/cart"
                  className="relative p-2 text-zinc-400 hover:text-white transition-colors"
                >
                  <ShoppingCart className="w-5 h-5" />
                  {cartItemCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 rounded-full text-xs text-white flex items-center justify-center">
                      {cartItemCount}
                    </span>
                  )}
                </Link>
              </>
            )}

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.username || ''}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                      <User className="w-4 h-4 text-zinc-400" />
                    </div>
                  )}
                </button>
                {isUserMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0"
                      onClick={() => setIsUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-zinc-800">
                        <p className="text-sm font-medium text-white">
                          {profile?.username || profile?.email}
                        </p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {profile?.email}
                        </p>
                      </div>
                      <div className="py-1">
                        <Link
                          to="/dashboard"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                          <LayoutDashboard className="w-4 h-4" />
                          {t('nav.dashboard')}
                        </Link>
                        <Link
                          to="/dashboard#purchases"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                          <ShoppingBag className="w-4 h-4" />
                          {t('nav.myPurchases')}
                        </Link>
                        {profile?.is_producer_active && (
                          <Link
                            to="/producer"
                            onClick={() => setIsUserMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                          >
                            <Music className="w-4 h-4" />
                            {t('producer.dashboard')}
                          </Link>
                        )}
                        <Link
                          to="/settings"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                          {t('nav.settings')}
                        </Link>
                      </div>
                      <div className="border-t border-zinc-800 py-1">
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            handleSignOut();
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          {t('nav.logout')}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    {t('nav.login')}
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">{t('nav.register')}</Button>
                </Link>
              </div>
            )}

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="lg:hidden p-2 text-zinc-400 hover:text-white"
            >
              {isMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="lg:hidden border-t border-zinc-800 bg-zinc-950">
          <nav className="px-4 py-4 space-y-1">
            <Link
              to="/beats"
              onClick={() => setIsMenuOpen(false)}
              className="block px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              {t('nav.beats')}
            </Link>
            <Link
              to="/exclusives"
              onClick={() => setIsMenuOpen(false)}
              className="block px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              {t('nav.exclusives')}
            </Link>
            <Link
              to="/kits"
              onClick={() => setIsMenuOpen(false)}
              className="block px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              {t('nav.kits')}
            </Link>
            <Link
              to="/battles"
              onClick={() => setIsMenuOpen(false)}
              className="block px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              {t('nav.battles')}
            </Link>
            <Link
              to="/producers"
              onClick={() => setIsMenuOpen(false)}
              className="block px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              {t('nav.producers')}
            </Link>
            <Link
              to="/pricing"
              onClick={() => setIsMenuOpen(false)}
              className="block px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              {t('nav.pricing')}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
