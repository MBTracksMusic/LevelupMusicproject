import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Music } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { updatePassword } from '../../lib/auth/service';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase/client';

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

  // Establish session from recovery link (access_token in URL hash)
  useEffect(() => {
    const init = async () => {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const type = hashParams.get('type');

      if (!accessToken || type !== 'recovery') {
        setStatus('error');
        setStatusMessage(t('auth.resetPasswordInvalidLink'));
        toast.error(t('auth.resetPasswordInvalidLinkShort'));
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken ?? '',
      });

      if (error) {
        setStatus('error');
        setStatusMessage(error.message || t('auth.resetPasswordLinkValidationFailed'));
        toast.error(t('auth.resetPasswordLinkValidationFailed'));
        return;
      }

      setStatus('ready');
      setStatusMessage('');
    };

    init();
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
      navigate('/login');
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
