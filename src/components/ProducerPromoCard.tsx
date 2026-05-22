import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { ArrowRight, Check, Crown, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import toast from 'react-hot-toast';
import type { PricingProducerPromo } from '../lib/supabase/useMaintenanceMode';

const CAPTCHA_SITE_KEY =
  (import.meta.env.VITE_HCAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';

const DEFAULT_BENEFITS = [
  "Demande d'accès producteur",
  'Profil étudié manuellement',
  'Phase privée limitée',
  'Sélection progressive',
];

const DEFAULT_FOOTNOTE = 'Demande gratuite · Validation manuelle';

interface ProducerPromoCardProps {
  promo: PricingProducerPromo;
  isActiveProducer: boolean;
  userEmail?: string;
  variant?: 'vertical' | 'horizontal';
}

type SubmitState = 'idle' | 'loading' | 'done';

export function ProducerPromoCard({
  promo,
  isActiveProducer,
  userEmail = '',
  variant = 'vertical',
}: ProducerPromoCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState(userEmail);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [captchaKey, setCaptchaKey] = useState(0);
  const captchaTokenRef = useRef<string | null>(null);

  if (isActiveProducer) return null;

  const isCaptchaConfigured = CAPTCHA_SITE_KEY.length > 0;

  const handleOpen = () => {
    setEmail(userEmail);
    setSubmitState('idle');
    setCaptchaKey((k) => k + 1);
    captchaTokenRef.current = null;
    setIsModalOpen(true);
  };

  const handleClose = () => {
    if (submitState === 'loading') return;
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitState !== 'idle') return;

    if (isCaptchaConfigured && !captchaTokenRef.current) {
      toast.error('Validez le captcha avant de continuer');
      return;
    }

    setSubmitState('loading');
    try {
      const { data, error } = await supabase.functions.invoke<{ message?: string; error?: string }>('join-waitlist', {
        body: {
          email: email.trim().toLowerCase(),
          captchaToken: captchaTokenRef.current,
          source: 'pricing_producer_promo',
          campaign_type: promo.campaign_type || null,
        },
      });

      if (error) throw error;

      const msg = (data as { message?: string; error?: string } | null);

      if (msg?.error === 'invalid_email') {
        toast.error('Adresse email invalide.');
        setSubmitState('idle');
        return;
      }
      if (msg?.error === 'captcha_failed') {
        toast.error('Captcha invalide, réessayez.');
        setCaptchaKey((k) => k + 1);
        captchaTokenRef.current = null;
        setSubmitState('idle');
        return;
      }
      if (msg?.error === 'rate_limit_exceeded') {
        toast.error('Trop de tentatives, réessayez plus tard.');
        setSubmitState('idle');
        return;
      }
      if (msg?.error === 'launch_public') {
        toast.error('Le lancement est ouvert : crée directement ton compte producteur.');
        setSubmitState('idle');
        return;
      }
      if (msg?.error === 'invalid_campaign_type') {
        toast.error('Cette campagne n’est plus disponible.');
        setSubmitState('idle');
        return;
      }
      if (msg?.error === 'campaign_slots_exhausted') {
        toast.error('Les 20 places fondateur sont déjà prises. Merci pour ton intérêt — reste à l’affût des prochaines vagues.');
        setSubmitState('idle');
        return;
      }

      setSubmitState('done');
    } catch (err) {
      console.error('[ProducerPromoCard] join-waitlist error', err);
      toast.error('Une erreur est survenue, réessayez.');
      setSubmitState('idle');
    }
  };

  const benefits = promo.benefits?.length ? promo.benefits : DEFAULT_BENEFITS;
  const footnote = promo.footnote ?? DEFAULT_FOOTNOTE;

  const verticalBadge = (
    <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 text-xs font-semibold text-white shadow-md">
      Phase privée · Sélection
    </span>
  );

  const verticalInfoColumn = (
    <div>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
        <Crown className="h-6 w-6 text-amber-400" />
      </div>
      <h3 className="mb-1 text-2xl font-bold text-white">{promo.title}</h3>
      <p className="font-semibold text-zinc-200">Accès privé · Sélection manuelle</p>
      <p className="mt-1 flex items-center gap-2 text-sm text-zinc-400">
        <Sparkles className="h-4 w-4 flex-shrink-0 text-amber-400" />
        20 places disponibles
      </p>
      <div className="mt-4">
        <span className="text-3xl font-bold text-white">Gratuit</span>
        <span className="text-zinc-400"> · Candidature</span>
      </div>
    </div>
  );

  const verticalMessageBlock = (
    <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4">
      <p className="whitespace-pre-line text-sm leading-relaxed text-amber-100/90">{promo.message}</p>
    </div>
  );

  const verticalBenefitsBlock = (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Check className="h-5 w-5 text-amber-400" />
        <p className="text-xl font-bold text-white">Inclus</p>
      </div>
      <ul className="space-y-2">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex items-start gap-3">
            <Check className="mt-1 h-4 w-4 flex-shrink-0 text-amber-400" />
            <span className="text-sm text-zinc-200/95">{benefit}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  const verticalCta = (
    <Button
      className="w-full"
      variant="primary"
      size="lg"
      onClick={handleOpen}
    >
      {promo.button_label}
    </Button>
  );

  return (
    <>
      {variant === 'horizontal' ? (
        <Card className="border border-amber-500/70 bg-zinc-900 p-6 shadow-[0_0_30px_rgba(245,158,11,0.10)] transition-all duration-300 hover:shadow-[0_0_40px_rgba(245,158,11,0.18)] sm:p-10">
          {/* Header centré : eyebrow + titre + sous-titre */}
          <div className="mb-8 text-center">
            <div className="mb-4 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                <Sparkles className="h-3 w-3" />
                Phase privée · Sélection
              </span>
            </div>
            <h3 className="mx-auto max-w-3xl text-2xl font-bold leading-tight text-white sm:text-3xl">
              {promo.title}
            </h3>
            <p className="mt-2 text-sm text-zinc-400">Accès privé · Sélection manuelle</p>
          </div>

          {/* 3 colonnes avec labels de section */}
          <div className="grid gap-8 border-t border-zinc-800 pt-8 md:grid-cols-3">
            {/* Col 1 — Offre */}
            <div>
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400/80">
                Offre
              </p>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
                <Crown className="h-6 w-6 text-amber-400" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-white">20</span>
                <span className="text-sm text-zinc-400">places disponibles</span>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold text-white">Gratuit</span>
                <span className="text-sm text-zinc-400"> · Candidature</span>
              </div>
            </div>

            {/* Col 2 — Programme (message admin, FR/EN) */}
            <div>
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400/80">
                Le programme
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                {promo.message}
              </p>
            </div>

            {/* Col 3 — Inclus */}
            <div>
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400/80">
                Inclus
              </p>
              <ul className="space-y-2.5">
                {benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                    <span className="text-sm leading-snug text-zinc-200/95">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* CTA */}
          <div className="mx-auto mt-10 max-w-md border-t border-zinc-800 pt-8">
            <Button
              className="group w-full"
              variant="primary"
              size="lg"
              onClick={handleOpen}
              rightIcon={<ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />}
            >
              {promo.button_label}
            </Button>
            <p className="mt-3 text-center text-xs text-zinc-500">{footnote}</p>
          </div>
        </Card>
      ) : (
        <Card className="flex h-full flex-col justify-between border border-amber-500/70 bg-zinc-900 p-6 shadow-[0_0_30px_rgba(245,158,11,0.10)] transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_0_40px_rgba(245,158,11,0.18)]">
          <div>
            <div className="mb-4 flex justify-center">{verticalBadge}</div>
            <div className="mb-6">{verticalInfoColumn}</div>
            <div className="mb-6">{verticalMessageBlock}</div>
            <div className="mb-6">{verticalBenefitsBlock}</div>
            <p className="mb-2 text-center text-xs text-zinc-500">{footnote}</p>
          </div>
          <div className="pt-6">{verticalCta}</div>
        </Card>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={handleClose}
        title={promo.title}
        description={promo.message}
        size="sm"
      >
        {submitState === 'done' ? (
          <div className="py-4 text-center">
            <p className="font-semibold text-emerald-400">Demande envoyée !</p>
            <p className="mt-2 text-sm text-zinc-400">On te recontacte dès que possible.</p>
            <Button className="mt-6 w-full" variant="secondary" onClick={handleClose}>
              Fermer
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              autoComplete="email"
              required
              disabled={submitState === 'loading'}
            />
            {isCaptchaConfigured && (
              <div className="flex justify-center">
                <HCaptcha
                  key={captchaKey}
                  sitekey={CAPTCHA_SITE_KEY}
                  onVerify={(token) => { captchaTokenRef.current = token; }}
                  onExpire={() => { captchaTokenRef.current = null; }}
                  onError={() => { captchaTokenRef.current = null; }}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={submitState === 'loading'}
              >
                Annuler
              </Button>
              <Button type="submit" isLoading={submitState === 'loading'}>
                {promo.button_label}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
