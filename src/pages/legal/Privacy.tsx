import { useTranslation } from '../../lib/i18n';

export function Privacy() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{t('legal.privacy.title')}</h1>
          <p className="text-zinc-400">{t('legal.privacy.intro')}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.collectedDataTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.collectedDataBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.useTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.useBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.storageTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.storageBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.paymentsTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.paymentsBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.securityTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.securityBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.rightsTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.rightsBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.privacy.contactTitle')}</h2>
          <p className="text-zinc-400">{t('legal.privacy.contactBody')}</p>
        </section>
      </div>
    </div>
  );
}
