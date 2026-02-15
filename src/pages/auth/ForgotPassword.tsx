import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldown > 0) return;
    setIsLoading(true);

    try {
      await resetPassword(email.trim());
      setEmailSent(true);
      toast.success('Email de réinitialisation envoyé');
    } catch (error) {
      const apiError = error as AuthApiError;
      if (apiError?.code === 'over_email_send_rate_limit' || apiError?.status === 429) {
        setCooldown(60);
        toast.error('Trop de demandes. Réessayez dans 60s.');
      } else {
        toast.error('Erreur lors de l\'envoi de l\'email');
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
            {t('auth.forgotPassword')}
          </h1>
          <p className="text-zinc-400">
            Entrez votre email pour réinitialiser votre mot de passe
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
                  Email envoyé !
                </h3>
                <p className="text-zinc-400 text-sm mb-6">
                  Vérifiez votre boîte mail et cliquez sur le lien pour réinitialiser votre mot de passe.
                </p>
              </div>
              <Link to="/login">
                <Button className="w-full">
                  Retour à la connexion
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
                placeholder="email@exemple.com"
                required
                autoComplete="email"
              />

              <Button
                type="submit"
                className="w-full"
                size="lg"
                isLoading={isLoading}
                disabled={cooldown > 0}
              >
                {cooldown > 0 ? `Réessayer dans ${cooldown}s` : "Envoyer l'email"}
              </Button>

              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sm text-zinc-400 hover:text-rose-400 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour à la connexion
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
