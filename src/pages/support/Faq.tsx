import { useTranslation } from '../../lib/i18n';

export function Faq() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{t('support.faq.title')}</h1>
          <p className="text-zinc-400">{t('support.faq.subtitle')}</p>
        </div>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-white">{t('support.faq.usersTitle')}</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{t('support.faq.buyQuestion')}</h3>
              <p className="text-zinc-400">{t('support.faq.buyAnswer')}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{t('support.faq.purchasesQuestion')}</h3>
              <p className="text-zinc-400">{t('support.faq.purchasesAnswer')}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{t('support.faq.battlesQuestion')}</h3>
              <p className="text-zinc-400">{t('support.faq.battlesAnswer')}</p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-white">{t('support.faq.producersTitle')}</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{t('support.faq.activateQuestion')}</h3>
              <p className="text-zinc-400">{t('support.faq.activateAnswer')}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{t('support.faq.publishQuestion')}</h3>
              <p className="text-zinc-400">{t('support.faq.publishAnswer')}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium text-white">{t('support.faq.salesQuestion')}</h3>
              <p className="text-zinc-400">{t('support.faq.salesAnswer')}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
