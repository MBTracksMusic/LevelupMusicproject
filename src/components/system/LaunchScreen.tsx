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
      toast.success('Candidature reçue. Les meilleurs passent en premier — on te contacte dès que c\'est ton tour.');
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

  // Découpage automatique du titre en lignes visuelles
  // — respecte les \n si l'admin en met, sinon coupe aux fins de phrases
  const headlineLines = useMemo(() => {
    const raw = headline;
    const lines = raw.includes('\n')
      ? raw.split('\n')
      : raw.split(/(?<=[.!?])\s+/);
    return lines.map((s) => s.trim()).filter(Boolean);
  }, [headline]);


  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden">

      {/* Ambient glow — palette unifiée amber */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[700px] w-[700px] rounded-full bg-amber-500/8 blur-[160px]" />
        <div className="absolute top-1/3 -right-20 h-[300px] w-[300px] rounded-full bg-yellow-400/4 blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 h-[250px] w-[250px] rounded-full bg-amber-400/3 blur-[100px]" />
      </div>

      {/* Preview produit en fond — /preview.png à placer dans /public */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <img
          src="/preview.png"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover opacity-[0.06] blur-2xl scale-110"
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-24 text-center">

        {/* Badge "Accès privé" — amber unifié + pulse */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
            Accès privé
          </span>
        </div>

        {/* Logo — amber gradient + halo */}
        <div className="mb-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/25 to-yellow-500/20 ring-1 ring-amber-500/20 shadow-[0_0_32px_rgba(245,158,11,0.18)]">
          <span className="text-3xl">🎧</span>
        </div>

        {/* Headline — découpage automatique, taille adaptée à la longueur de chaque ligne */}
        <h1 className="flex w-full flex-col items-center gap-3">
          {headlineLines.map((line, i) => (
            <span
              key={i}
              className={[
                'block text-balance text-center font-black tracking-tight leading-tight',
                line.length <= 15
                  ? 'text-4xl text-white sm:text-5xl'
                  : line.length <= 30
                    ? 'text-3xl text-white sm:text-4xl'
                    : 'text-2xl text-zinc-300 sm:text-3xl',
              ].join(' ')}
            >
              {line}
            </span>
          ))}
        </h1>

        {/* Subline */}
        <p className="mt-8 max-w-sm text-base leading-relaxed text-zinc-400 sm:text-lg text-pretty">
          {subline}
        </p>

        {/* Micro texte UX */}
        <p className="mt-3 text-sm text-zinc-600">· Accès ouverts par vagues ·</p>

        {/* Divider visuel hero → conversion */}
        <div className="mt-12 flex w-full items-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-zinc-700" />
          <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-zinc-700" />
        </div>

        {/* Date de lancement — texte inline, accent amber */}
        {formattedDate && (
          <p className="mt-6 text-xs uppercase tracking-widest text-zinc-500">
            Lancement prévu le{' '}
            <span className="font-semibold text-amber-400/80">{formattedDate}</span>
          </p>
        )}

        {/* Countdown — plus large, digits plus impactants */}
        {targetTime && (
          <div className="mt-5 grid grid-cols-4 gap-3 w-full max-w-sm">
            {[
              { label: 'Jours', value: countdown.days },
              { label: 'Heures', value: countdown.hours },
              { label: 'Min', value: countdown.minutes },
              { label: 'Sec', value: countdown.seconds },
            ].map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center rounded-2xl border border-zinc-800 border-t-amber-500/20 bg-zinc-900/80 px-2 py-5 transition-colors hover:border-amber-500/20"
              >
                {/* key sur le span = remount à chaque changement → animation flip-in */}
                <span
                  key={pad(item.value)}
                  className="animate-flip-in text-4xl font-black tabular-nums text-white sm:text-5xl"
                >
                  {pad(item.value)}
                </span>
                <span className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Preuve sociale — juste au-dessus du form pour impact maximal */}
        {waitlistCountDisplay > 0 && (
          <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <p className="text-sm text-zinc-400">
              <span className="font-semibold text-white">+{waitlistCountDisplay}</span>
              {' '}producteurs déjà inscrits
            </p>
          </div>
        )}

        {/* Formulaire waitlist — carte premium */}
        <div className="mt-14 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/60 backdrop-blur ring-1 ring-white/[0.03]">

          {/* En-tête carte */}
          <p className="text-base font-bold text-white">
            Demande ton accès
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Les accès sont accordés progressivement.
          </p>

          {/* ── Logique intacte à partir d'ici ── */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              disabled={isSubmitting}
              required
              className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 text-sm text-white placeholder:text-zinc-600 transition-all focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/10 disabled:opacity-60"
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
              className="h-12 w-full rounded-xl bg-amber-400 text-sm font-bold text-zinc-950 shadow-[0_4px_20px_rgba(251,191,36,0.25)] transition-all hover:bg-amber-300 hover:shadow-[0_4px_30px_rgba(251,191,36,0.35)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Envoi en cours...' : 'Rejoindre la liste →'}
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
        <p className="mt-3 text-center text-xs text-zinc-600">
          Tu recevras un email dès que ton accès est disponible.
        </p>

        {/* YouTube embed — avec label d'intro */}
        {embedUrl && (
          <div className="mt-12 w-full max-w-2xl">
            <p className="mb-3 text-xs uppercase tracking-widest text-zinc-600">Aperçu</p>
            <iframe
              src={embedUrl}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media"
              allowFullScreen
              className="aspect-video w-full rounded-2xl border border-zinc-800"
              title="Beatelion Launch Video"
            />
          </div>
        )}

        {/* Accès VIP */}
        <div className="mt-10 flex flex-col items-center gap-2">
          <p className="text-xs text-zinc-600">Tu as déjà un accès ?</p>
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Accès VIP — Se connecter
          </a>
        </div>

        {/* Footer */}
        <p className="mt-8 text-xs text-zinc-800">
          © {new Date().getFullYear()} Beatelion — Plateforme réservée aux producteurs.
        </p>
      </div>
    </div>
  );
}
