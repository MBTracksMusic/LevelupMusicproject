import { useEffect, useState } from 'react';
import { AuthApiError } from '@supabase/supabase-js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../../components/ui';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { getAuthRedirectUrl } from '../../lib/auth/redirects';

export default function EmailConfirmation() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [errorMessage, setErrorMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const email = searchParams.get('email');

  // Prevents users from spamming the resend endpoint and hitting Supabase rate limits.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    const handleEmailConfirmation = async () => {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      const searchParams = url.searchParams;

      // Supabase can return params either in the hash (#) or the query (?).
      const accessToken =
        hashParams.get('access_token') ||
        searchParams.get('access_token') ||
        searchParams.get('token');
      const refreshToken =
        hashParams.get('refresh_token') ||
        searchParams.get('refresh_token') ||
        '';
      const type = hashParams.get('type') || searchParams.get('type');
      const errorParam = hashParams.get('error') || searchParams.get('error');
      const errorDescription =
        hashParams.get('error_description') || searchParams.get('error_description');
      const codeParam = hashParams.get('code') || searchParams.get('code');

      // Explicit Supabase error returned in URL
      if (errorParam || errorDescription) {
        setStatus('error');
        setErrorMessage(
          decodeURIComponent(errorDescription || errorParam || t('errors.generic'))
        );
        return;
      }

      // If Supabase sent a PKCE-style code param (no access token yet)
      if (codeParam && !accessToken) {
        try {
          const { error } = await supabase.auth.exchangeCodeForSession(codeParam);
          if (error) throw error;
          setStatus('success');
          setTimeout(() => navigate('/'), 2000);
        } catch (error) {
          console.error('Error exchanging code for session:', error);
          const apiError = error as AuthApiError;
          setStatus('error');
          setErrorMessage(apiError?.message || t('auth.emailConfirmationInvalidLink'));
        }
        return;
      }

      // Landing without any token keeps the UI in pending state (user just registered).
      if (!accessToken) return;

      if (!type) {
        setStatus('error');
        setErrorMessage(t('auth.emailConfirmationMissingType'));
        return;
      }

      const allowedTypes = new Set(['signup', 'recovery', 'magiclink', 'invite', 'email_change']);
      if (!allowedTypes.has(type)) {
        setStatus('error');
        setErrorMessage(t('auth.emailConfirmationInvalidType'));
        return;
      }

      try {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) throw error;

        setStatus('success');
        setTimeout(() => navigate('/'), 2000);
      } catch (error) {
        console.error('Error confirming email:', error);
        const apiError = error as AuthApiError;
        setStatus('error');
        if (apiError?.status === 401) {
          setErrorMessage(t('auth.emailConfirmationExpired'));
        } else {
          setErrorMessage(apiError?.message || t('errors.generic'));
        }
      }
    };

    handleEmailConfirmation();
  }, [navigate]);

  const handleResendEmail = async () => {
    if (!email || cooldown > 0) return;

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: getAuthRedirectUrl('/email-confirmation'),
        },
      });

      if (error) throw error;
      setCooldown(60);
      alert(t('auth.emailConfirmationResent'));
    } catch (error) {
      console.error('Error resending email:', error);
      if (error instanceof AuthApiError && error.status === 429) {
        setCooldown(60);
        alert(t('auth.emailConfirmationRateLimited'));
        return;
      }
      alert(t('auth.emailConfirmationResendError'));
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">
        <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">
            {t('auth.emailConfirmationSuccessTitle')}
          </h1>
          <p className="text-gray-300 mb-6">
            {t('auth.emailConfirmationSuccessBody')}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">
        <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">
            {t('auth.emailConfirmationErrorTitle')}
          </h1>
          <p className="text-gray-300 mb-6">
            {errorMessage || t('auth.emailConfirmationErrorBody')}
          </p>
          <Button onClick={() => navigate('/login')} className="w-full">
            {t('auth.backToLogin')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">
      <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-8 text-center">
        <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Mail className="w-10 h-10 text-blue-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-4">
          {t('auth.emailConfirmationPendingTitle')}
        </h1>
        <p className="text-gray-300 mb-6">
          {t('auth.emailConfirmationPendingBody', { email: email ?? '' })}
        </p>
        <div className="space-y-3">
          <Button
            onClick={handleResendEmail}
            variant="outline"
            className="w-full"
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? t('auth.emailConfirmationRetryIn', { count: cooldown }) : t('auth.emailConfirmationResend')}
          </Button>
          <Button onClick={() => navigate('/login')} variant="outline" className="w-full">
            {t('auth.backToLogin')}
          </Button>
        </div>
        <p className="text-sm text-gray-400 mt-6">
          {t('auth.emailConfirmationSpamHint')}
        </p>
      </div>
    </div>
  );
}
