import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';

interface ContactSubmitResponse {
  ok?: boolean;
  id?: string;
  error?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_MESSAGE_LENGTH = 20;

export function ContactPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const isAuthenticated = Boolean(user);
  const defaultName = profile?.username || '';
  const defaultEmail = user?.email || '';
  const captchaSiteKey = (import.meta.env.VITE_HCAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const isCaptchaConfigured = captchaSiteKey.length > 0;

  const [message, setMessage] = useState('');
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [honeypot, setHoneypot] = useState('');
  const [formStartedAt, setFormStartedAt] = useState<number>(() => Date.now());
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaInstanceKey, setCaptchaInstanceKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (!isCaptchaConfigured || !captchaToken) return false;
    if (honeypot.trim().length > 0) return false;
    if (!message.trim() || message.trim().length < MIN_MESSAGE_LENGTH) return false;
    if (!isAuthenticated) {
      if (!name.trim() || name.trim().length < 2) return false;
      if (!EMAIL_REGEX.test(email.trim())) return false;
    }
    return true;
  }, [captchaToken, email, honeypot, isAuthenticated, isCaptchaConfigured, message, name]);

  const resetForm = () => {
    setMessage('');
    if (!isAuthenticated) {
      setName('');
      setEmail('');
    }
  };

  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaInstanceKey((current) => current + 1);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || isSubmitting) return;
    if (!isCaptchaConfigured) {
      toast.error(t('support.contact.captchaUnavailable'));
      return;
    }
    if (!captchaToken) {
      toast.error(t('support.contact.captchaRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const resolvedEmail = isAuthenticated ? (defaultEmail || email.trim()) : email.trim();
      const resolvedName = isAuthenticated
        ? (defaultName || name.trim() || resolvedEmail.split('@')[0] || 'Member')
        : name.trim();

      const payload = {
        message: message.trim(),
        name: resolvedName,
        email: resolvedEmail,
        captchaToken,
        company: honeypot,
        form_started_at: formStartedAt,
      };

      const { data, error } = await supabase.functions.invoke<ContactSubmitResponse>('contact-submit', {
        body: payload,
      });

      if (error) {
        const details = (data as ContactSubmitResponse | null)?.error;
        toast.error(details || error.message || t('support.contact.submitError'));
        resetCaptcha();
        return;
      }

      if (data?.ok !== true) {
        toast.error(data?.error || t('support.contact.invalidResponse'));
        resetCaptcha();
        return;
      }

      toast.success(t('support.contact.submitSuccess'));
      resetForm();
      setHoneypot('');
      setFormStartedAt(Date.now());
      resetCaptcha();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCaptchaVerify = (token: string) => {
    setCaptchaToken(token);
  };

  const handleCaptchaExpire = () => {
    setCaptchaToken(null);
  };

  const handleCaptchaError = () => {
    setCaptchaToken(null);
    toast.error(t('support.contact.captchaUnavailable'));
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-3xl mx-auto px-4 space-y-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">{t('support.contact.title')}</h1>
          <p className="text-zinc-400">{t('support.contact.subtitle')}</p>
        </div>

        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isAuthenticated && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label={t('common.name')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('support.contact.namePlaceholder')}
                  required
                />
                <Input
                  label={t('common.email')}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('support.contact.emailPlaceholder')}
                  required
                />
              </div>
            )}

            {isAuthenticated && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-300">
                {t('support.contact.authenticatedNotice', { email: defaultEmail })}
              </div>
            )}

            <div className="sr-only" aria-hidden="true">
              <label htmlFor="contact-company">Company</label>
              <input
                id="contact-company"
                name="company"
                type="text"
                autoComplete="off"
                tabIndex={-1}
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="contact-message">
                {t('common.message')}
              </label>
              <textarea
                id="contact-message"
                className="w-full min-h-[150px] bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t('support.contact.messagePlaceholder')}
                required
              />
            </div>

            {!isCaptchaConfigured && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {t('support.contact.captchaUnavailable')}
              </div>
            )}

            {isCaptchaConfigured && (
              <div className="space-y-1">
                <HCaptcha
                  key={captchaInstanceKey}
                  sitekey={captchaSiteKey}
                  onVerify={handleCaptchaVerify}
                  onExpire={handleCaptchaExpire}
                  onError={handleCaptchaError}
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" isLoading={isSubmitting} disabled={!isValid}>
                {t('common.send')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
