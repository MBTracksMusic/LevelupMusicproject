import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Music, ArrowLeft } from 'lucide-react';
import { Button, ToastContainer } from '../../components/ui';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { trackSignUp } from '../../lib/analytics';
import { AuthFunctionError, signUp } from '../../lib/auth/service';
import { useToast, useToastStore } from '../../lib/toast';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
type AccountType = 'user' | 'producer';

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [accountType, setAccountType] = useState<AccountType>('user');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cooldown, setCooldown] = useState(0);
  const submitLockRef = useRef(false);
  const lastSubmitAtRef = useRef(0);
  const captchaSiteKey = (import.meta.env.VITE_HCAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const isCaptchaConfigured = captchaSiteKey.length > 0;
  const captchaTokenRef = useRef<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaInstanceKey, setCaptchaInstanceKey] = useState(0);

  // Simple client-side throttle to avoid hitting Supabase email rate limits repeatedly
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
    toast.error(t('auth.captchaUnavailable'), 5000);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    const email = formData.email.trim();
    const username = formData.username.trim();

    if (!email) {
      newErrors.email = t('errors.requiredField');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t('errors.invalidEmail');
    }

    if (!username) {
      newErrors.username = t('errors.requiredField');
    } else if (!USERNAME_REGEX.test(username)) {
      newErrors.username = t('auth.usernameRules');
    }

    if (!formData.password) {
      newErrors.password = t('errors.requiredField');
    } else if (formData.password.length < 8) {
      newErrors.password = t('auth.weakPassword');
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = t('auth.passwordMismatch');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    if (cooldown > 0) return;
    if (!isCaptchaConfigured) {
      toast.error(t('auth.captchaUnavailable'), 5000);
      return;
    }

    const now = Date.now();
    if (now - lastSubmitAtRef.current < 2000) return;
    if (!validate()) return;
    if (!captchaTokenRef.current) {
      toast.error(t('auth.captchaRequired'), 5000);
      return;
    }

    lastSubmitAtRef.current = now;
    submitLockRef.current = true;
    setIsLoading(true);

    try {
      const result = await signUp({
        email: formData.email.trim(),
        password: formData.password,
        username: formData.username.trim(),
        captchaToken: captchaTokenRef.current,
      });
      trackSignUp('email');

      const producerRedirectPath = '/tarifs';
      if (result.user && !result.user.confirmed_at) {
        if (accountType === 'producer') {
          navigate(producerRedirectPath);
        } else {
          navigate(`/email-confirmation?email=${encodeURIComponent(formData.email)}`);
        }
      } else {
        toast.success(t('auth.registerSuccess'), 3000);
        navigate(accountType === 'producer' ? producerRedirectPath : '/');
      }
    } catch (err: unknown) {
      const error = err as { message?: string; code?: string; status?: number };
      const errorMessage = error.message?.toLowerCase() || '';
      const isRateLimited =
        (error instanceof AuthFunctionError &&
          (error.code === 'over_email_send_rate_limit' || error.status === 429)) ||
        error.status === 429 ||
        errorMessage.includes('too many requests') ||
        errorMessage.includes('trop de demandes');
      console.error('Erreur inscription:', error);
      if (isRateLimited) {
        setCooldown(60);
        toast.error(t('auth.registerRateLimited'), 5000);
      } else if (error instanceof AuthFunctionError && error.code === 'user_already_exists') {
        setErrors({ email: t('auth.emailInUse') });
      } else if (error.message?.includes('duplicate key value') && error.message.includes('user_profiles_username_key')) {
        setErrors({ username: t('auth.usernameTaken') });
      } else if (error.message?.includes('already registered')) {
        setErrors({ email: t('auth.emailInUse') });
      } else {
        toast.error(error.message || t('errors.generic'), 5000);
      }
    } finally {
      resetCaptcha();
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-zinc-950 relative">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="absolute top-6 left-4 sm:left-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('auth.backToHome')}
        </Link>
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
              <Music className="w-6 h-6 text-white" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">
            {t('auth.registerTitle')}
          </h1>
          <p className="text-zinc-400">
            {t('auth.hasAccount')}{' '}
            <Link to="/login" className="text-rose-400 hover:text-rose-300">
              {t('auth.loginButton')}
            </Link>
          </p>
        </div>

        <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-200">{t('auth.accountType')}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountType('user')}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    accountType === 'user'
                      ? 'border-rose-500 bg-rose-500/15 text-white'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'
                  }`}
                  aria-pressed={accountType === 'user'}
                >
                  {t('auth.accountTypeUser')}
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType('producer')}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    accountType === 'producer'
                      ? 'border-rose-500 bg-rose-500/15 text-white'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'
                  }`}
                  aria-pressed={accountType === 'producer'}
                >
                  {t('auth.accountTypeProducer')}
                </button>
              </div>
            </div>

            <Input
              type="email"
              name="email"
              label={t('auth.email')}
              value={formData.email}
              onChange={handleChange}
              leftIcon={<Mail className="w-5 h-5" />}
              placeholder={t('auth.emailPlaceholder')}
              error={errors.email}
              required
              autoComplete="email"
            />

            <Input
              type="text"
              name="username"
              label={t('auth.username')}
              value={formData.username}
              onChange={handleChange}
              leftIcon={<User className="w-5 h-5" />}
              placeholder={t('auth.usernamePlaceholder')}
              error={errors.username}
              required
              autoComplete="username"
            />

            <Input
              type="password"
              name="password"
              label={t('auth.password')}
              value={formData.password}
              onChange={handleChange}
              leftIcon={<Lock className="w-5 h-5" />}
              placeholder={t('auth.passwordPlaceholder')}
              error={errors.password}
              required
              autoComplete="new-password"
            />

            <Input
              type="password"
              name="confirmPassword"
              label={t('auth.confirmPassword')}
              value={formData.confirmPassword}
              onChange={handleChange}
              leftIcon={<Lock className="w-5 h-5" />}
              placeholder={t('auth.passwordPlaceholder')}
              error={errors.confirmPassword}
              required
              autoComplete="new-password"
            />

            <p className="text-xs text-zinc-500">
              {t('auth.termsAgree')}
            </p>

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
              disabled={isLoading || cooldown > 0 || !isCaptchaConfigured || !captchaToken}
            >
              {t('auth.registerButton')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
