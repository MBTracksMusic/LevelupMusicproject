import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

interface MaintenanceScreenProps {
  launchDate: string | null;
  launchVideoUrl?: string | null;
}

interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

type WaitlistFeedback = {
  tone: 'success' | 'error';
  message: string;
} | null;

type WaitlistSubmitResponse = {
  message?: 'success' | 'already_registered';
  error?: string;
};

const ZERO_COUNTDOWN: CountdownState = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

function getCountdown(targetTime: number | null): CountdownState {
  if (targetTime === null) {
    return ZERO_COUNTDOWN;
  }

  const remainingMs = Math.max(targetTime - Date.now(), 0);
  const totalSeconds = Math.floor(remainingMs / 1000);

  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function formatCountdownUnit(value: number) {
  return value.toString().padStart(2, '0');
}

function getEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtube.com' && parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function MaintenanceScreen({ launchDate, launchVideoUrl }: MaintenanceScreenProps) {
  const targetTime = useMemo(() => {
    if (!launchDate) {
      return null;
    }

    const timestamp = new Date(launchDate).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }, [launchDate]);

  const [countdown, setCountdown] = useState<CountdownState>(() => getCountdown(targetTime));

  useEffect(() => {
    setCountdown(getCountdown(targetTime));

    if (targetTime === null) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setCountdown(getCountdown(targetTime));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [targetTime]);

  const formattedLaunchDate = useMemo(() => {
    if (targetTime === null) {
      return null;
    }

    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(targetTime));
  }, [targetTime]);

  const isCountdownMode = formattedLaunchDate !== null;
  const trimmedLaunchVideoUrl = launchVideoUrl?.trim() ?? '';
  const embedUrl = trimmedLaunchVideoUrl ? getEmbedUrl(trimmedLaunchVideoUrl) : null;
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistFeedback, setWaitlistFeedback] = useState<WaitlistFeedback>(null);
  const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);

  const handleWaitlistSubmit = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setWaitlistFeedback({
        tone: 'error',
        message: 'Erreur, reessaie plus tard',
      });
      return;
    }

    setIsSubmittingWaitlist(true);
    setWaitlistFeedback(null);

    try {
      const { data, error } = await supabase.functions.invoke<WaitlistSubmitResponse>('join-waitlist', {
        body: { email: normalizedEmail },
      });

      if (error) {
        setWaitlistFeedback({
          tone: 'error',
          message: 'Erreur, réessaie plus tard',
        });
        return;
      }

      if (data?.error === 'invalid_email') {
        setWaitlistFeedback({
          tone: 'error',
          message: 'Adresse email invalide',
        });
        return;
      }

      if (data?.message === 'already_registered') {
        setWaitlistFeedback({
          tone: 'success',
          message: 'Tu es déjà inscrit 👍',
        });
        return;
      }

      if (data?.message === 'success') {
        setWaitlistFeedback({
          tone: 'success',
          message: 'Merci ! Tu seras informé 🚀',
        });
        setWaitlistEmail('');
        return;
      }

      setWaitlistFeedback({
        tone: 'error',
        message: 'Erreur, réessaie plus tard',
      });
    } finally {
      setIsSubmittingWaitlist(false);
    }
  };

  const onWaitlistSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingWaitlist) return;
    await handleWaitlistSubmit(waitlistEmail);
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col items-center justify-center text-center">
        <div className="w-full rounded-3xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl shadow-black/30 backdrop-blur sm:p-12">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 to-orange-500/20 text-3xl">
            {isCountdownMode ? '🚀' : '🚧'}
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            {isCountdownMode ? '🚀 Beatelion arrive bientôt' : '🚧 Beatelion en maintenance'}
          </h1>

          <p className="mt-4 text-base text-zinc-300 sm:text-lg">
            {isCountdownMode ? formattedLaunchDate : 'Retour bientôt'}
          </p>

          <div className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 sm:p-5">
            <p className="text-sm text-zinc-300">
              📩 Sois informé dès l&apos;ouverture
            </p>

            <form onSubmit={onWaitlistSubmit} className="mt-4 space-y-3">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={waitlistEmail}
                onChange={(event) => setWaitlistEmail(event.target.value)}
                placeholder="ton@email.com"
                className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
                disabled={isSubmittingWaitlist}
                required
              />

              <button
                type="submit"
                className="h-12 w-full rounded-xl bg-yellow-400 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isSubmittingWaitlist}
              >
                {isSubmittingWaitlist ? 'Envoi...' : "M'avertir"}
              </button>

              <div className="min-h-[20px] text-sm">
                {waitlistFeedback ? (
                  <p className={waitlistFeedback.tone === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                    {waitlistFeedback.message}
                  </p>
                ) : null}
              </div>
            </form>
          </div>

          {isCountdownMode ? (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Jours', value: countdown.days },
                { label: 'Heures', value: countdown.hours },
                { label: 'Minutes', value: countdown.minutes },
                { label: 'Secondes', value: countdown.seconds },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-5"
                >
                  <p className="text-3xl font-semibold text-white sm:text-4xl">
                    {formatCountdownUnit(item.value)}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {embedUrl ? (
            <div className="mt-8 w-full max-w-2xl">
              <iframe
                src={embedUrl}
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="autoplay; encrypted-media"
                allowFullScreen
                className="w-full aspect-video rounded-lg"
                title="Beatelion Launch Video"
                frameBorder="0"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
