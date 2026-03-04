import { useTranslation } from '../../lib/i18n';

export function ProducerGuide() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{t('support.producerGuide.title')}</h1>
          <p className="text-zinc-400">{t('support.producerGuide.subtitle')}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('support.producerGuide.accountTitle')}</h2>
          <p className="text-zinc-400">{t('support.producerGuide.accountBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('support.producerGuide.submitTitle')}</h2>
          <p className="text-zinc-400">{t('support.producerGuide.submitBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('support.producerGuide.validationTitle')}</h2>
          <p className="text-zinc-400">{t('support.producerGuide.validationBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('support.producerGuide.paymentsTitle')}</h2>
          <p className="text-zinc-400">{t('support.producerGuide.paymentsBody')}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-white">{t('support.producerGuide.rulesTitle')}</h2>
          <p className="text-zinc-400">{t('support.producerGuide.rulesBody')}</p>
        </section>
      </div>
    </div>
  );
}
