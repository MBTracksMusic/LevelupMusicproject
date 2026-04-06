import { useEffect, useMemo, useState, useRef } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { supabase } from '@/lib/supabase/client';
import { useMaintenanceModeContext } from '@/lib/supabase/MaintenanceModeContext';
import toast from 'react-hot-toast';
import type { LaunchMessages } from '@/lib/supabase/useLaunchAccess';

interface LaunchScreenProps {
  messages: LaunchMessages;
}

interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

type WaitlistFeedback = { tone: 'success' | 'error'; message: string } | null;
type WaitlistResponse =
  | { message: 'success' | 'already_registered' }
  | { error: string };

const ZERO: CountdownState = { days: 0, hours: 0, minutes: 0, seconds: 0 };

function getCountdown(target: number | null): CountdownState {
  if (target === null) return ZERO;
  const remaining = Math.max(target - Date.now(), 0);
  const s = Math.floor(remaining / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function getEmbedUrl(url: string): string | null {
  try {
    const p = new URL(url);
    const host = p.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' && p.pathname === '/watch') {
      const id = p.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtu.be') {
      const id = p.pathname.replace(/^\/+/, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function LaunchScreen({ messages }: LaunchScreenProps) {
  const { launchDate, launchVideoUrl } = useMaintenanceModeContext();

  const targetTime = useMemo(() => {
    if (!launchDate) return null;
    const t = new Date(launchDate).getTime();
    return Number.isNaN(t) ? null : t;
  }, [launchDate]);

  const [countdown, setCountdown] = useState<CountdownState>(() =>
    getCountdown(targetTime),
  );

  useEffect(() => {
    setCountdown(getCountdown(targetTime));
    if (targetTime === null) return;
    const id = window.setInterval(() => setCountdown(getCountdown(targetTime)), 1000);
    return () => window.clearInterval(id);
  }, [targetTime]);

  const formattedDate = useMemo(() => {
    if (!targetTime) return null;
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(targetTime));
  }, [targetTime]);

  const embedUrl = useMemo(() => {
    const url = launchVideoUrl?.trim() ?? '';
    return url ? getEmbedUrl(url) : null;
  }, [launchVideoUrl]);

  // ── Waitlist form ──────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<WaitlistFeedback>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const captchaSiteKey =
    (import.meta.env.VITE_HCAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const isCaptchaConfigured = captchaSiteKey.length > 0;
  const captchaTokenRef = useRef<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const resetCaptcha = () => {
    captchaTokenRef.current = null;
    setCaptchaKey((k) => k + 1);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setFeedback({ tone: 'error', message: 'Adresse email requise' });
      return;
    }
    if (!isCaptchaConfigured || !captchaTokenRef.current) {
      setFeedback({ tone: 'error', message: 'Validez le captcha avant de continuer' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const { data, error } = await supabase.functions.invoke<WaitlistResponse>(
        'join-waitlist',
        {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
          body: {
            email: normalizedEmail,
            captchaToken: captchaTokenRef.current,
            source: 'launch_page',
          },
        },
      );

      if (error) {
        setFeedback({ tone: 'error', message: 'Erreur, réessaie plus tard' });
        resetCaptcha();
        return;
      }

      const res = data as WaitlistResponse | null;

      if (res && 'error' in res) {
        const map: Record<string, string> = {
          invalid_email: 'Adresse email invalide',
          rate_limit_exceeded: 'Trop de tentatives. Réessayez plus tard.',
          captcha_failed: 'Captcha invalide, réessayez.',
        };
        setFeedback({
          tone: 'error',
          message: map[res.error] ?? 'Erreur, réessaie plus tard',
        });
        resetCaptcha();
        return;
      }

      if (res && 'message' in res && res.message === 'already_registered') {
        setFeedback({ tone: 'success', message: 'Tu es déjà inscrit.' });
        resetCaptcha();
        return;
      }

      // success
      toast.success('Tu es sur la liste. On te contacte dès que c\'est ton tour.');
      setEmail('');
      resetCaptcha();
      setFeedback(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[480px] w-[480px] rounded-full bg-rose-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[320px] w-[320px] rounded-full bg-orange-500/8 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">

        {/* Logo / badge */}
        <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/30 to-orange-500/30 ring-1 ring-white/10">
          <span className="text-3xl">🎧</span>
        </div>

        {/* Main message */}
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {messages.headline}
        </h1>
        <p className="mt-4 max-w-md text-base text-zinc-400 sm:text-lg">
          {messages.subline}
        </p>

        {/* Launch date */}
        {formattedDate && (
          <p className="mt-3 text-sm font-medium text-rose-400">
            Lancement prévu : {formattedDate}
          </p>
        )}

        {/* Countdown */}
        {targetTime && (
          <div className="mt-8 grid grid-cols-4 gap-3 w-full max-w-sm">
            {[
              { label: 'Jours', value: countdown.days },
              { label: 'Heures', value: countdown.hours },
              { label: 'Min', value: countdown.minutes },
              { label: 'Sec', value: countdown.seconds },
            ].map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-900/80 px-2 py-4"
              >
                <span className="text-3xl font-bold tabular-nums text-white">
                  {pad(item.value)}
                </span>
                <span className="mt-1 text-[10px] uppercase tracking-widest text-zinc-500">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Waitlist form */}
        <div className="mt-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur">
          <p className="text-sm font-medium text-zinc-300">
            Sois informé dès l&apos;ouverture
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              disabled={isSubmitting}
              required
              className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            />

            {isCaptchaConfigured && (
              <div className="flex justify-center overflow-hidden rounded-lg">
                <HCaptcha
                  key={captchaKey}
                  sitekey={captchaSiteKey}
                  onVerify={(token) => { captchaTokenRef.current = token; }}
                  onExpire={() => { captchaTokenRef.current = null; }}
                  onError={() => {
                    captchaTokenRef.current = null;
                    toast.error('Captcha indisponible. Réessayez dans quelques instants.');
                  }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full rounded-xl bg-yellow-400 text-sm font-semibold text-zinc-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Envoi...' : 'Rejoindre la liste →'}
            </button>

            <div className="min-h-[20px] text-sm">
              {feedback && (
                <p
                  className={
                    feedback.tone === 'success' ? 'text-emerald-400' : 'text-red-400'
                  }
                >
                  {feedback.message}
                </p>
              )}
            </div>
          </form>
        </div>

        {/* YouTube embed */}
        {embedUrl && (
          <div className="mt-10 w-full max-w-2xl">
            <iframe
              src={embedUrl}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className="aspect-video w-full rounded-xl"
              title="Beatelion Launch Video"
              frameBorder="0"
            />
          </div>
        )}

        {/* Legal / footer */}
        <p className="mt-12 text-xs text-zinc-600">
          © {new Date().getFullYear()} Beatelion — Plateforme réservée aux producteurs.
        </p>
      </div>
    </div>
  );
}
