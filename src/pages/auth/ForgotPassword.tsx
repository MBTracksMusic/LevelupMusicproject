import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Music, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { resetPassword } from '../../lib/auth/service';
import toast from 'react-hot-toast';
import { AuthApiError } from '@supabase/supabase-js';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const captchaSiteKey = (import.meta.env.VITE_HCAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const isCaptchaConfigured = captchaSiteKey.length > 0;
  const captchaTokenRef = useRef<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaInstanceKey, setCaptchaInstanceKey] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const resetCaptcha = () => {
    captchaTokenRef.current = null;
    setCaptchaToken(null);
    setCaptchaInstanceKey((current) => current + 1);
  };

  const handleCaptchaVerify = (token: string) => {
    captchaTokenRef.current = token;
    setCaptchaToken(token);
  };

  const handleCaptchaExpire = () => {
    captchaTokenRef.current = null;
    setCaptchaToken(null);
  };

  const handleCaptchaError = () => {
    captchaTokenRef.current = null;
    setCaptchaToken(null);
    toast.error(t('auth.captchaUnavailable'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldown > 0) return;
    if (!isCaptchaConfigured) {
      toast.error(t('auth.captchaUnavailable'));
      return;
    }
    if (!captchaTokenRef.current) {
      toast.error(t('auth.captchaRequired'));
      return;
    }
    setIsLoading(true);

    try {
      await resetPassword(email.trim(), captchaTokenRef.current);
      setEmailSent(true);
      toast.success(t('auth.forgotPasswordEmailSentSuccess'));
    } catch (error) {
      const apiError = error as AuthApiError;
      if (apiError?.code === 'over_email_send_rate_limit' || apiError?.status === 429) {
        setCooldown(60);
        toast.error(t('auth.forgotPasswordRateLimited'));
      } else {
        toast.error(t('auth.forgotPasswordSendError'));
      }
    } finally {
      resetCaptcha();
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
              <Music className="w-6 h-6 text-white" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">
            {t('auth.forgotPassword')}
          </h1>
          <p className="text-zinc-400">
            {t('auth.forgotPasswordSubtitle')}
          </p>
        </div>

        <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
          {emailSent ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto">
                <Mail className="w-8 h-8 text-rose-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {t('auth.forgotPasswordEmailSentTitle')}
                </h3>
                <p className="text-zinc-400 text-sm mb-6">
                  {t('auth.forgotPasswordEmailSentDescription')}
                </p>
              </div>
              <Link to="/login">
                <Button className="w-full">
                  {t('auth.backToLogin')}
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                type="email"
                label={t('auth.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-5 h-5" />}
                placeholder={t('auth.emailPlaceholder')}
                required
                autoComplete="email"
              />

              {!isCaptchaConfigured && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                  {t('auth.captchaUnavailable')}
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

              <Button
                type="submit"
                className="w-full"
                size="lg"
                isLoading={isLoading}
                disabled={cooldown > 0 || !isCaptchaConfigured || !captchaToken}
              >
                {cooldown > 0
                  ? t('auth.forgotPasswordRetryIn', { count: cooldown })
                  : t('auth.forgotPasswordSendButton')}
              </Button>

              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sm text-zinc-400 hover:text-rose-400 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('auth.backToLogin')}
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
