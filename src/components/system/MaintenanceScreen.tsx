import { useEffect, useMemo, useState } from 'react';

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

function getEmbedUrl(url: string): string {
  try {
    if (url.includes('youtube.com/watch')) {
      const id = new URL(url).searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }

    if (url.includes('youtu.be/')) {
      const id = url.split('youtu.be/')[1];
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }

    return url;
  } catch {
    return url;
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
  const hasVideo = !!trimmedLaunchVideoUrl;

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

          {hasVideo ? (
            <div className="mt-8 w-full max-w-2xl">
              <iframe
                className="w-full aspect-video rounded-lg"
                src={getEmbedUrl(trimmedLaunchVideoUrl)}
                title="Beatelion Launch Video"
                frameBorder="0"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
