import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Music } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { signUp } from '../../lib/auth/service';
import toast from 'react-hot-toast';
import { AuthApiError } from '@supabase/supabase-js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cooldown, setCooldown] = useState(0);

  // Simple client-side throttle to avoid hitting Supabase email rate limits repeatedly
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

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
      newErrors.username = '3-32 caracteres, lettres/chiffres/underscore uniquement';
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
    if (!validate() || cooldown > 0) return;

    setIsLoading(true);

    try {
      const result = await signUp({
        email: formData.email.trim(),
        password: formData.password,
        username: formData.username.trim(),
      });

      if (result.user && !result.user.confirmed_at) {
        navigate(`/email-confirmation?email=${encodeURIComponent(formData.email)}`);
      } else {
        toast.success(t('auth.registerSuccess'));
        navigate('/');
      }
    } catch (err: unknown) {
      const error = err as { message?: string; code?: string; status?: number };
      console.error('Erreur inscription:', error);
      if (error instanceof AuthApiError && (error.code === 'over_email_send_rate_limit' || error.status === 429)) {
        setCooldown(60);
        toast.error('Trop de demandes. Réessayez dans 60s.');
      } else if (error instanceof AuthApiError && error.code === 'user_already_exists') {
        setErrors({ email: t('auth.emailInUse') });
      } else if (error.message?.includes('duplicate key value') && error.message.includes('user_profiles_username_key')) {
        setErrors({ username: 'Ce nom d’utilisateur est déjà pris.' });
      } else if (error.message?.includes('already registered')) {
        setErrors({ email: t('auth.emailInUse') });
      } else {
        toast.error(error.message || t('errors.generic'));
      }
    } finally {
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
            <Input
              type="email"
              name="email"
              label={t('auth.email')}
              value={formData.email}
              onChange={handleChange}
              leftIcon={<Mail className="w-5 h-5" />}
              placeholder="email@exemple.com"
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
              placeholder="mon_pseudo"
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
              placeholder="••••••••"
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
              placeholder="••••••••"
              error={errors.confirmPassword}
              required
              autoComplete="new-password"
            />

            <p className="text-xs text-zinc-500">
              {t('auth.termsAgree')}
            </p>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading}
            >
              {t('auth.registerButton')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
