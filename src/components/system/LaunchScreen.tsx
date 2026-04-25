import { useEffect, useMemo, useState, useRef } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Crown,
  LockKeyhole,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  UserCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useMaintenanceModeContext } from '@/lib/supabase/MaintenanceModeContext';
import toast from 'react-hot-toast';
import type { LaunchMessages } from '@/lib/supabase/useLaunchAccess';
import { parseLaunchPageContent } from '@/lib/launchPageContent';

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
      toast.success('Candidature reçue. Les meilleurs passent en premier - on te contacte dès que c\'est ton tour.');
      setEmail('');
      resetCaptcha();
      setFeedback(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fallbacks ultra-robustes: .trim() elimine les chaines vides venant de la DB.
  const content = parseLaunchPageContent(messages?.headline, messages?.subline);

  const accessHighlights = [
    {
      icon: Trophy,
      ...content.highlightCards[0],
    },
    {
      icon: Swords,
      ...content.highlightCards[1],
    },
    {
      icon: ShieldCheck,
      ...content.highlightCards[2],
    },
  ];

  const heroChips = [
    { icon: Trophy, label: content.heroChips[0], className: 'text-amber-300' },
    { icon: Swords, label: content.heroChips[1], className: 'text-rose-300' },
    { icon: ShieldCheck, label: content.heroChips[2], className: 'text-emerald-300' },
  ];

  const platformRows = [
    { icon: BarChart3, ...content.platformRows[0] },
    { icon: Swords, ...content.platformRows[1] },
    { icon: CheckCircle2, ...content.platformRows[2] },
  ];

  return (
    <div className="min-h-screen overflow-hidden bg-[#08080b] text-white">
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:76px_76px] opacity-30" />
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,rgba(8,8,11,0.35),rgba(8,8,11,0.92)_72%,#08080b)]" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="/beatelion-icon.svg" alt="Beatelion" className="h-12 w-12 rounded-2xl shadow-lg shadow-orange-500/10" />
            <div>
              <p className="text-xl font-black leading-none text-white">Beatelion</p>
              <p className="mt-1 text-sm text-zinc-500">{content.headerTagline}</p>
            </div>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(390px,0.95fr)] lg:py-16">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
              {content.heroBadge}
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[0.98] text-white sm:text-5xl lg:text-6xl">
              <span className="block text-zinc-100">{content.heroTitlePrimary}</span>
              <span className="mt-2 block bg-gradient-to-r from-amber-200 via-orange-300 to-rose-400 bg-clip-text text-transparent">
                {content.heroTitleAccent}
              </span>
            </h1>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {heroChips.map(({ icon: Icon, label, className }) => (
                <span key={label} className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-xs font-semibold text-zinc-300">
                  <Icon className={`h-3.5 w-3.5 ${className}`} />
                  {label}
                </span>
              ))}
            </div>

            <p className="mt-6 max-w-2xl whitespace-pre-line text-lg font-semibold leading-relaxed text-zinc-200 sm:text-xl">
              {content.heroMessage}
            </p>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
              {content.heroSubline}
            </p>

            <div className="mt-5 space-y-2 text-sm font-semibold text-zinc-200">
              {content.conversionBullets.map((item) => (
                <p key={item} className="leading-relaxed">{item}</p>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {accessHighlights.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-4">
                  <Icon className="h-5 w-5 text-amber-300" />
                  <p className="mt-3 text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{text}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {waitlistCountDisplay > 0 && (
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
                  <UserCheck className="h-4 w-4 text-emerald-300" />
                  <span className="font-semibold">+{waitlistCountDisplay}</span>
                  <span className="text-emerald-200/70">{content.waitlistCountLabel}</span>
                </div>
              )}
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-4 py-2 text-sm text-zinc-400">
                <Radio className="h-4 w-4 text-rose-300" />
                {content.wavesLabel}
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 shadow-2xl shadow-black/60">
              <div className="border-b border-zinc-800 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">{content.formEyebrow}</p>
                    <p className="mt-1 text-lg font-bold text-white">{content.formTitle}</p>
                    <p className="mt-1 text-sm text-zinc-500">{content.formSubtitle}</p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10">
                    <Crown className="h-5 w-5 text-amber-300" />
                  </div>
                </div>
              </div>

              {targetTime && (
                <div className="border-b border-zinc-800 p-5">
                  {formattedDate && (
                    <p className="mb-3 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                      <Clock3 className="h-3.5 w-3.5 text-amber-300" />
                      {content.countdownLabel} <span className="text-amber-200">{formattedDate}</span>
                    </p>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: content.countdownDaysLabel, value: countdown.days },
                      { label: content.countdownHoursLabel, value: countdown.hours },
                      { label: content.countdownMinutesLabel, value: countdown.minutes },
                      { label: content.countdownSecondsLabel, value: countdown.seconds },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-2 py-3 text-center">
                        <span key={pad(item.value)} className="block text-2xl font-black tabular-nums text-white">
                          {pad(item.value)}
                        </span>
                        <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4 p-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-300">{content.emailLabel}</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={content.emailPlaceholder}
                    disabled={isSubmitting}
                    required
                    className="h-12 w-full rounded-xl border border-zinc-700 bg-[#0b0b0f] px-4 text-sm text-white placeholder:text-zinc-600 transition-all focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/10 disabled:opacity-60"
                  />
                </label>

                {isCaptchaConfigured && (
                  <div className="flex justify-center overflow-hidden rounded-xl border border-zinc-800 bg-white p-2">
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
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 via-orange-400 to-rose-500 text-sm font-black text-zinc-950 shadow-[0_18px_45px_rgba(251,146,60,0.2)] transition hover:scale-[1.01] hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? content.formSubmittingLabel : content.formSubmitLabel}
                  {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                </button>

                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-zinc-500">
                  <span>{content.trustText}</span>
                  <span className="hidden text-zinc-700 sm:inline">•</span>
                  <span>{content.socialProofText}</span>
                </div>

                <div className="min-h-[20px] text-sm">
                  {feedback && (
                    <p className={feedback.tone === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                      {feedback.message}
                    </p>
                  )}
                </div>

                <p className="text-xs leading-relaxed text-zinc-600">
                  {content.formNote}
                </p>
              </form>

              <div className="border-t border-zinc-800 bg-zinc-900/35 p-5">
                <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{content.loginTitle}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {content.loginText}
                    </p>
                  </div>
                  <a
                    href="/login"
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-200 transition hover:border-amber-400/50 hover:text-white"
                  >
                    <LockKeyhole className="h-4 w-4 text-amber-300" />
                    {content.loginCta}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 pb-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500">{content.platformEyebrow}</p>
                <h2 className="mt-2 text-xl font-bold text-white">{content.platformTitle}</h2>
              </div>
              <Sparkles className="h-5 w-5 text-amber-300" />
            </div>

            <div className="mt-5 space-y-3">
              {platformRows.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-amber-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{label}</p>
                    <p className="text-xs text-zinc-500">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {embedUrl ? (
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/70">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-white">{content.videoTitle}</p>
                  <p className="text-xs text-zinc-500">{content.videoSubtitle}</p>
                </div>
                <Play className="h-5 w-5 text-rose-300" />
              </div>
              <iframe
                src={embedUrl}
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="autoplay; encrypted-media"
                allowFullScreen
                className="aspect-video w-full"
                title={content.videoIframeTitle}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500">{content.processEyebrow}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {content.processSteps.map((item) => (
                  <div key={item.step} className="rounded-xl border border-zinc-800 bg-zinc-900/55 p-4">
                    <p className="text-xs font-black text-amber-300">{item.step}</p>
                    <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <footer className="border-t border-zinc-900 py-6 text-xs text-zinc-700">
          © {new Date().getFullYear()} Beatelion. {content.footerText}
        </footer>
      </main>
    </div>
  );
}
