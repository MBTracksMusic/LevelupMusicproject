import { useEffect, useState } from 'react';
import { AuthApiError } from '@supabase/supabase-js';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Music } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { updatePassword } from '../../lib/auth/service';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase/client';

const AUTH_URL_PARAMS = [
  'access_token',
  'refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
  'type',
  'code',
  'token',
  'token_hash',
  'error',
  'error_code',
  'error_description',
] as const;

type RecoveryLinkContext = {
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  code: string | null;
  tokenHash: string | null;
  error: string | null;
  errorDescription: string | null;
  hasRecoveryHint: boolean;
};

function readInitialRecoveryContext(): RecoveryLinkContext {
  // Read params at module load time, before the Supabase SDK (detectSessionInUrl: true)
  // processes and potentially clears the URL hash.
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const readParam = (...keys: string[]) =>
    keys.map((key) => hashParams.get(key) || queryParams.get(key)).find(Boolean) ?? null;

  const type = readParam('type');
  const accessToken = readParam('access_token', 'token');
  const refreshToken = readParam('refresh_token');
  const code = readParam('code');
  const tokenHash = readParam('token_hash');

  return {
    accessToken,
    refreshToken,
    type,
    code,
    tokenHash,
    error: readParam('error', 'error_code'),
    errorDescription: readParam('error_description'),
    hasRecoveryHint:
      (type === 'recovery' && !!accessToken) ||
      !!code ||
      (type === 'recovery' && !!tokenHash),
  };
}

function clearRecoveryParamsFromUrl() {
  const url = new URL(window.location.href);

  for (const param of AUTH_URL_PARAMS) {
    url.searchParams.delete(param);
  }

  url.hash = '';

  const nextUrl = `${url.pathname}${url.search}`;
  window.history.replaceState(null, '', nextUrl || url.pathname);
}

const initialRecoveryContext = readInitialRecoveryContext();

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

  useEffect(() => {
    const setErrorState = (message: string, toastMessage = message) => {
      setStatus('error');
      setStatusMessage(message);
      toast.error(toastMessage);
    };

    if (initialRecoveryContext.error || initialRecoveryContext.errorDescription) {
      const explicitMessage =
        initialRecoveryContext.errorDescription
          ? decodeURIComponent(initialRecoveryContext.errorDescription)
          : t('auth.resetPasswordInvalidLink');
      setErrorState(explicitMessage, t('auth.resetPasswordInvalidLinkShort'));
      return;
    }

    if (!initialRecoveryContext.hasRecoveryHint) {
      setErrorState(
        t('auth.resetPasswordInvalidLink'),
        t('auth.resetPasswordInvalidLinkShort'),
      );
      return;
    }

    let isMounted = true;
    let settled = false;

    const settleReady = () => {
      if (!isMounted || settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearRecoveryParamsFromUrl();
      setStatus('ready');
      setStatusMessage('');
    };

    const settleValidationError = (message: string) => {
      if (!isMounted || settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setStatus('error');
      setStatusMessage(message);
      toast.error(message);
    };

    const timeoutId = setTimeout(() => {
      settleValidationError(t('auth.resetPasswordLinkValidationFailed'));
    }, 15_000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        return;
      }

      if (
        event === 'PASSWORD_RECOVERY' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        settleReady();
      }
    });

    const getExistingSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      return session;
    };

    const bootstrapRecoverySession = async () => {
      try {
        const existingSession = await getExistingSession();
        if (existingSession) {
          settleReady();
          return;
        }

        if (initialRecoveryContext.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(initialRecoveryContext.code);
          if (error) throw error;
        } else if (initialRecoveryContext.tokenHash && initialRecoveryContext.type === 'recovery') {
          const { error } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: initialRecoveryContext.tokenHash,
          });
          if (error) throw error;
        } else if (initialRecoveryContext.accessToken && initialRecoveryContext.refreshToken) {
          const fallbackSession = await getExistingSession();
          if (fallbackSession) {
            settleReady();
            return;
          }

          const { error } = await supabase.auth.setSession({
            access_token: initialRecoveryContext.accessToken,
            refresh_token: initialRecoveryContext.refreshToken,
          });
          if (error) throw error;
        }

        const session = await getExistingSession();

        if (session) {
          settleReady();
        }
      } catch (error) {
        console.error('Reset password link validation error:', error);
        const apiError = error as AuthApiError;
        const invalidLinkMessage =
          apiError?.status === 400 || apiError?.status === 401 || apiError?.status === 403
            ? t('auth.resetPasswordInvalidLink')
            : t('auth.resetPasswordLinkValidationFailed');
        settleValidationError(invalidLinkMessage);
      }
    };

    void bootstrapRecoverySession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [t]);

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
