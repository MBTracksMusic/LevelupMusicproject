import { useEffect } from 'react';
import { useTranslation } from '../../lib/i18n';

export function Licenses() {
  const { t, language } = useTranslation();

  useEffect(() => {
    const pageTitle = t('legal.licenses.metaTitle');
    const pageDescription = t('legal.licenses.metaDescription');
    const previousTitle = document.title;
    document.title = pageTitle;

    const existingMeta = document.querySelector('meta[name="description"]');
    const previousDescription = existingMeta?.getAttribute('content') ?? null;
    let meta = existingMeta as HTMLMetaElement | null;
    let metaCreated = false;

    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
      metaCreated = true;
    }

    meta.setAttribute('content', pageDescription);

    return () => {
      document.title = previousTitle;

      if (!meta) return;

      if (metaCreated) {
        meta.remove();
        return;
      }

      if (previousDescription === null) {
        meta.removeAttribute('content');
      } else {
        meta.setAttribute('content', previousDescription);
      }
    };
  }, [language, t]);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{t('legal.licenses.title')}</h1>
          <p className="text-zinc-400">{t('legal.licenses.intro')}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.licenses.scopeTitle')}</h2>
          <p className="text-zinc-400">{t('legal.licenses.scopeBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.licenses.allowedTitle')}</h2>
          <p className="text-zinc-400">{t('legal.licenses.allowedBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.licenses.forbiddenTitle')}</h2>
          <p className="text-zinc-400">{t('legal.licenses.forbiddenBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.licenses.creditTitle')}</h2>
          <p className="text-zinc-400">{t('legal.licenses.creditBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.licenses.contractTitle')}</h2>
          <p className="text-zinc-400">{t('legal.licenses.contractBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.licenses.limitsTitle')}</h2>
          <p className="text-zinc-400">{t('legal.licenses.limitsBody')}</p>
        </section>
      </div>
    </div>
  );
}
