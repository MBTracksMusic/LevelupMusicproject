import { useCookieConsent } from '../../hooks/useCookieConsent';

export function CookieBanner() {
  const { consentStatus, acceptCookies, rejectCookies } = useCookieConsent();

  if (consentStatus !== 'unknown') {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur animate-[cookie-banner-in_220ms_ease-out] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Cookies</p>
            <p className="mt-1 text-sm leading-6 text-zinc-300">
              Nous utilisons des cookies pour améliorer votre expérience.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900 hover:text-white"
            >
              Personnaliser
            </button>
            <button
              type="button"
              onClick={rejectCookies}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900 hover:text-white"
            >
              Refuser
            </button>
            <button
              type="button"
              onClick={acceptCookies}
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2 text-sm font-medium text-white transition hover:from-rose-600 hover:to-orange-600"
            >
              Accepter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
