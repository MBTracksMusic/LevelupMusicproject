import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Twitter, Instagram, Youtube } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import beatelionIcon from '../../assets/beatelion-icon.svg';

const SOCIAL_SETTINGS_KEY = 'social_links';

interface SocialLinks {
  twitter: string;
  instagram: string;
  youtube: string;
}

const EMPTY_SOCIAL_LINKS: SocialLinks = {
  twitter: '',
  instagram: '',
  youtube: '',
};

const HTTP_URL_REGEX = /^https?:\/\//i;

const sanitizeUrl = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return HTTP_URL_REGEX.test(trimmed) ? trimmed : '';
};

export function Footer() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(EMPTY_SOCIAL_LINKS);

  useEffect(() => {
    let isMounted = true;

    const loadSocialLinks = async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SOCIAL_SETTINGS_KEY)
        .maybeSingle();

      if (error) {
        console.error('footer social links load error', error);
        return;
      }

      if (!isMounted) return;

      const payload = data?.value;
      const parsed = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

      setSocialLinks({
        twitter: sanitizeUrl(parsed.twitter),
        instagram: sanitizeUrl(parsed.instagram),
        youtube: sanitizeUrl(parsed.youtube),
      });
    };

    void loadSocialLinks();

    return () => {
      isMounted = false;
    };
  }, []);

  const socialItems = [
    { key: 'twitter', href: socialLinks.twitter, Icon: Twitter },
    { key: 'instagram', href: socialLinks.instagram, Icon: Instagram },
    { key: 'youtube', href: socialLinks.youtube, Icon: Youtube },
  ] as const;

  return (
    <footer className="bg-zinc-950 border-t border-zinc-800 pb-24">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <Link to="/" className="flex items-center gap-2 mb-4 transition duration-200 hover:scale-105">
              <img
                src={beatelionIcon}
                alt="Beatelion - Beat marketplace"
                className="h-8 w-auto max-h-8"
              />
              <span className="text-xl font-bold text-white">{t('footer.brandName')}</span>
            </Link>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              {t('footer.brandDescription')}
            </p>
            <div className="flex items-center gap-3">
              {socialItems.map(({ key, href, Icon }) => (
                href ? (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                  >
                    <Icon className="w-5 h-5" />
                  </a>
                ) : (
                  <span
                    key={key}
                    className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-600 cursor-not-allowed"
                    aria-hidden="true"
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                )
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">{t('footer.marketplaceTitle')}</h4>
            <ul className="space-y-2">
              {/* TODO(levelup): sections exclusives/kits temporairement desactivees. */}
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
            <h4 className="text-white font-semibold mb-4">{t('nav.producers')}</h4>
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
                <Link
                  to="/guide-producteur"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.producerGuide')}
                </Link>
              </li>
              <li>
                <Link
                  to="/licenses"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.licensesContracts')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">{t('footer.support')}</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/faq"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.faq')}
                </Link>
              </li>
              <li>
                <Link
                  to="/contact"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.contact')}
                </Link>
              </li>
              <li>
                <Link
                  to="/terms"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.terms')}
                </Link>
              </li>
              <li>
                <Link
                  to="/privacy"
                  className="text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  {t('footer.privacy')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-zinc-500 text-sm">
            {t('common.copyrightSymbol')} {currentYear} {t('footer.brandName')}. {t('common.copyright')}.
          </p>
          <p className="text-zinc-500 text-sm flex items-center gap-1">
            {t('footer.madeWith')} <Heart className="w-4 h-4 text-rose-500" fill="currentColor" /> {t('footer.inFrance')}
          </p>
        </div>
      </div>
    </footer>
  );
}
