import { Link } from 'react-router-dom';
import { Music, Heart, Twitter, Instagram, Youtube } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';

export function Footer() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-zinc-950 border-t border-zinc-800 pb-24">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
                <Music className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">LevelupMusic</span>
            </Link>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              La marketplace musicale professionnelle pour les producteurs et artistes.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="#"
                className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <Twitter className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <Instagram className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <Youtube className="w-5 h-5" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Marketplace</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/beats"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('nav.beats')}
                </Link>
              </li>
              <li>
                <Link
                  to="/exclusives"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('nav.exclusives')}
                </Link>
              </li>
              <li>
                <Link
                  to="/kits"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('nav.kits')}
                </Link>
              </li>
              <li>
                <Link
                  to="/battles"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('nav.battles')}
                </Link>
              </li>
              <li>
                <Link
                  to="/producers"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('nav.producers')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Producteurs</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/pricing"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('nav.pricing')}
                </Link>
              </li>
              <li>
                <Link
                  to="/register"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('home.becomeProducer')}
                </Link>
              </li>
              <li>
                <a
                  href="#"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  Guide du producteur
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  Licences & contrats
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">{t('footer.support')}</h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="#"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.faq')}
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.contact')}
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.terms')}
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.privacy')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-zinc-500 text-sm">
            &copy; {currentYear} LevelupMusic. {t('common.copyright')}.
          </p>
          <p className="text-zinc-500 text-sm flex items-center gap-1">
            {t('footer.madeWith')} <Heart className="w-4 h-4 text-rose-500" fill="currentColor" /> {t('footer.inFrance')}
          </p>
        </div>
      </div>
    </footer>
  );
}
