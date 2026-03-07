import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';

interface ContactSubmitResponse {
  ok?: boolean;
  id?: string;
  error?: string;
}

export function ContactPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const isAuthenticated = Boolean(user);
  const defaultName = profile?.username || '';
  const defaultEmail = user?.email || '';

  const [message, setMessage] = useState('');
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (!message.trim() || message.trim().length < 10) return false;
    if (!isAuthenticated) {
      if (!name.trim()) return false;
      if (!email.trim()) return false;
    }
    return true;
  }, [email, isAuthenticated, message, name]);

  const resetForm = () => {
    setMessage('');
    if (!isAuthenticated) {
      setName('');
      setEmail('');
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const resolvedEmail = isAuthenticated ? (defaultEmail || email.trim()) : email.trim();
    const resolvedName = isAuthenticated
      ? (defaultName || name.trim() || resolvedEmail.split('@')[0] || 'Member')
      : name.trim();

    const payload = {
      message: message.trim(),
      name: resolvedName,
      email: resolvedEmail,
    };

    const { data, error } = await supabase.functions.invoke<ContactSubmitResponse>('contact-submit', {
      body: payload,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    if (error) {
      const details = (data as ContactSubmitResponse | null)?.error;
      toast.error(details || error.message || t('support.contact.submitError'));
      setIsSubmitting(false);
      return;
    }

    if (data?.ok !== true) {
      toast.error(data?.error || t('support.contact.invalidResponse'));
      setIsSubmitting(false);
      return;
    }

    toast.success(t('support.contact.submitSuccess'));
    resetForm();
    setIsSubmitting(false);
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
