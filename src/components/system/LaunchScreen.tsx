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
  const { launchDate, launchVideoUrl, waitlistCountDisplay } = useMaintenanceModeContext();

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

  // Fallbacks ultra-robustes — .trim() élimine les chaînes vides venant de la DB
  const headline = messages?.headline?.trim() || 'Beatelion est en accès privé';
  const subline =
    messages?.subline?.trim() ||
    "Une sélection de producteurs est déjà à l'intérieur. Les prochains accès arrivent progressivement.";


  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden">

      {/* Ambient glow — plus dramatique */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-rose-600/12 blur-[140px]" />
        <div className="absolute top-1/2 -right-20 h-[280px] w-[280px] rounded-full bg-orange-500/8 blur-[100px]" />
        <div className="absolute bottom-0 left-1/3 h-[200px] w-[200px] rounded-full bg-rose-500/5 blur-[80px]" />
      </div>

      {/* Preview produit en fond — /preview.png à placer dans /public */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <img
          src="/preview.png"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover opacity-[0.07] blur-2xl scale-110"
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-16 text-center">

        {/* Badge "Accès privé" */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-rose-400">
            Accès privé
          </span>
        </div>

        {/* Logo */}
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/30 to-orange-500/30 ring-1 ring-white/10">
          <span className="text-3xl">🎧</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {headline}
        </h1>

        {/* Subline */}
        <p className="mt-5 max-w-sm text-base leading-relaxed text-zinc-400 sm:text-lg">
          {subline}
        </p>

        {/* Micro texte UX */}
        <p className="mt-2 text-sm text-zinc-500">
          Accès ouverts par vagues.
        </p>

        {/* Preuve sociale — affichée uniquement si l'admin a renseigné un nombre > 0 */}
        {waitlistCountDisplay > 0 && (
          <p className="mt-4 text-sm text-zinc-400 text-center">
            <span className="font-semibold text-yellow-400">
              +{waitlistCountDisplay}
            </span>
            {' '}producteurs ont déjà demandé leur accès
          </p>
        )}

        {/* Date de lancement — stylée en pill */}
        {formattedDate && (
          <p className="mt-5 rounded-full border border-rose-500/20 bg-rose-500/8 px-4 py-1.5 text-sm font-medium text-rose-400">
            Lancement prévu : {formattedDate}
          </p>
        )}

        {/* Countdown */}
        {targetTime && (
          <div className="mt-8 grid grid-cols-4 gap-3 w-full max-w-xs">
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

        {/* Formulaire waitlist — carte premium */}
        <div className="mt-10 w-full max-w-md rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur">

          {/* En-tête carte */}
          <p className="text-sm font-semibold text-zinc-100">
            Demande ton accès
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Les accès sont accordés progressivement.
          </p>

          {/* ── Logique intacte à partir d'ici ── */}
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
                <p className={feedback.tone === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                  {feedback.message}
                </p>
              )}
            </div>
          </form>
        </div>

        {/* Micro texte UX — rassurance post-formulaire */}
        <p className="mt-3 text-center text-xs text-zinc-500">
          Tu recevras un email dès que ton accès est disponible.
        </p>

        {/* YouTube embed */}
        {embedUrl && (
          <div className="mt-10 w-full max-w-2xl">
            <iframe
              src={embedUrl}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className="aspect-video w-full rounded-xl border-0"
              title="Beatelion Launch Video"
            />
          </div>
        )}

        {/* Accès VIP */}
        <div className="mt-10 flex flex-col items-center gap-2">
          <p className="text-xs text-zinc-600">Tu as déjà un accès ?</p>
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
            Accès VIP — Se connecter
          </a>
        </div>

        {/* Footer */}
        <p className="mt-8 text-xs text-zinc-700">
          © {new Date().getFullYear()} Beatelion — Plateforme réservée aux producteurs.
        </p>
      </div>
    </div>
  );
}
