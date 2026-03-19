import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Music } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { updatePassword } from '../../lib/auth/service';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase/client';

// Read URL params at module load time, before the Supabase SDK (detectSessionInUrl: true)
// processes and potentially clears the URL hash.
// Supports both implicit flow (#access_token) and PKCE flow (?code).
const _initHashParams = new URLSearchParams(window.location.hash.substring(1));
const _initQueryParams = new URLSearchParams(window.location.search);
const _initHasRecoveryToken =
  (_initHashParams.has('access_token') && _initHashParams.get('type') === 'recovery') ||
  _initQueryParams.has('code');

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');
  const [statusMessage, setStatusMessage] = useState('');

  // With detectSessionInUrl: true, the Supabase SDK automatically processes the
  // #access_token from the URL hash and fires a PASSWORD_RECOVERY event.
  // Do NOT call setSession() manually — the SDK has already done it.
  useEffect(() => {
    if (!_initHasRecoveryToken) {
      setStatus('error');
      setStatusMessage(t('auth.resetPasswordInvalidLink'));
      toast.error(t('auth.resetPasswordInvalidLinkShort'));
      return;
    }

    let settled = false;

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (ok) {
        window.history.replaceState(null, '', window.location.pathname);
        setStatus('ready');
        setStatusMessage('');
      } else {
        setStatus('error');
        setStatusMessage(t('auth.resetPasswordLinkValidationFailed'));
        toast.error(t('auth.resetPasswordLinkValidationFailed'));
      }
    };

    // Timeout guard: if session validation never resolves, unblock the UI.
    const timeoutId = setTimeout(() => settle(false), 10_000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        settle(true);
      }
    });

    // Fallback: SDK may have processed the token before this listener registered.
    // getSession() reflects the recovery session the SDK already established.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      settle(!error && !!session);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

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
    if (status !== 'ready') return;
    if (!validate()) return;

    setIsLoading(true);

    try {
      await updatePassword(formData.password);
      toast.success(t('auth.resetPasswordUpdateSuccess'));
      // Invalidate all sessions globally — password is already updated, so signOut
      // failure is non-critical; swallow the error and proceed to redirect.
      await supabase.auth.signOut({ scope: 'global' }).catch(() => {});
      // Defer navigation by one microtask so the auth store's onAuthStateChange
      // handler (SIGNED_OUT event) can flush before the /login route renders.
      setTimeout(() => navigate('/login'), 0);
    } catch (error) {
      console.error('Reset password error:', error);
      toast.error(t('auth.resetPasswordUpdateError'));
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
            {t('auth.resetPasswordTitle')}
          </h1>
          <p className="text-zinc-400">
            {t('auth.resetPasswordSubtitle')}
          </p>
        </div>

        <div className="bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
          <form onSubmit={handleSubmit} className="space-y-5">
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

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading || status === 'pending'}
              disabled={status !== 'ready'}
            >
              {t('auth.resetPasswordButton')}
            </Button>
            {status === 'error' && (
              <p className="text-sm text-red-400 text-center">{statusMessage}</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
