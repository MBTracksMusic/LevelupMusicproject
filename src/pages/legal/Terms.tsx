import { useTranslation } from '../../lib/i18n';

export function Terms() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{t('legal.terms.title')}</h1>
          <p className="text-zinc-400">{t('legal.terms.intro')}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.platformTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.platformBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.userRoleTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.userRoleBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.producerRoleTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.producerRoleBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.paymentsTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.paymentsBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.suspensionTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.suspensionBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.liabilityTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.liabilityBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.lawTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.lawBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('legal.terms.changesTitle')}</h2>
          <p className="text-zinc-400">{t('legal.terms.changesBody')}</p>
        </section>
      </div>
    </div>
  );
}
