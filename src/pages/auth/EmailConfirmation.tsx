import { useEffect, useState } from 'react';
import { AuthApiError } from '@supabase/supabase-js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../../components/ui';
import { supabase } from '../../lib/supabase/client';

export default function EmailConfirmation() {
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
          decodeURIComponent(errorDescription || errorParam || 'Une erreur est survenue')
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
          setErrorMessage(apiError?.message || 'Lien invalide ou expiré.');
        }
        return;
      }

      // Landing without any token keeps the UI in pending state (user just registered).
      if (!accessToken) return;

      if (!type) {
        setStatus('error');
        setErrorMessage('Type de lien manquant ou invalide. Veuillez réessayer depuis votre email.');
        return;
      }

      const allowedTypes = new Set(['signup', 'recovery', 'magiclink', 'invite', 'email_change']);
      if (!allowedTypes.has(type)) {
        setStatus('error');
        setErrorMessage('Type de lien invalide. Veuillez vous reconnecter.');
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
          setErrorMessage('Lien expiré ou déjà utilisé. Renvoyez un email de confirmation.');
        } else {
          setErrorMessage(apiError?.message || 'Une erreur est survenue');
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
      });

      if (error) throw error;
      setCooldown(60);
      alert('Email de confirmation renvoyé. Vous pourrez renvoyer un autre email dans 60s.');
    } catch (error) {
      console.error('Error resending email:', error);
      if (error instanceof AuthApiError && error.status === 429) {
        setCooldown(60);
        alert('Limite atteinte. Réessayez dans 60 secondes.');
        return;
      }
      alert('Erreur lors de l\'envoi de l\'email');
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
            Email confirmé !
          </h1>
          <p className="text-gray-300 mb-6">
            Votre email a été confirmé avec succès. Vous allez être redirigé...
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
            Erreur de confirmation
          </h1>
          <p className="text-gray-300 mb-6">
            {errorMessage || 'Une erreur est survenue lors de la confirmation de votre email.'}
          </p>
          <Button onClick={() => navigate('/login')} className="w-full">
            Retour à la connexion
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
          Vérifiez votre email
        </h1>
        <p className="text-gray-300 mb-6">
          Un email de confirmation a été envoyé à <strong className="text-white">{email}</strong>.
          Cliquez sur le lien dans l'email pour activer votre compte.
        </p>
        <div className="space-y-3">
          <Button
            onClick={handleResendEmail}
            variant="outline"
            className="w-full"
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `Renvoyer dans ${cooldown}s` : "Renvoyer l'email"}
          </Button>
          <Button onClick={() => navigate('/login')} variant="outline" className="w-full">
            Retour à la connexion
          </Button>
        </div>
        <p className="text-sm text-gray-400 mt-6">
          Vous n'avez pas reçu l'email ? Vérifiez votre dossier spam.
        </p>
      </div>
    </div>
  );
}
