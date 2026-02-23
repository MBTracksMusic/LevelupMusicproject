import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useAuth } from '../../lib/auth/hooks';
import { supabase } from '../../lib/supabase/client';

type ContactCategory = 'support' | 'battle' | 'payment' | 'partnership' | 'other';

interface ContactSubmitResponse {
  ok?: boolean;
  id?: string;
  error?: string;
}

const categoryOptions: { value: ContactCategory; label: string }[] = [
  { value: 'support', label: 'Support général' },
  { value: 'battle', label: 'Battles' },
  { value: 'payment', label: 'Paiement' },
  { value: 'partnership', label: 'Partenariat' },
  { value: 'other', label: 'Autre' },
];

export function ContactPage() {
  const { user, profile } = useAuth();
  const isAuthenticated = Boolean(user);
  const defaultName = profile?.username || '';
  const defaultEmail = user?.email || '';

  const [category, setCategory] = useState<ContactCategory>('support');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (!subject.trim() || subject.trim().length < 3) return false;
    if (!message.trim() || message.trim().length < 10) return false;
    if (!isAuthenticated) {
      if (!name.trim()) return false;
      if (!email.trim()) return false;
    }
    return true;
  }, [email, isAuthenticated, message, name, subject]);

  const resetForm = () => {
    setCategory('support');
    setSubject('');
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

    const payload = {
      category,
      subject: subject.trim(),
      message: message.trim(),
      name: isAuthenticated ? defaultName || name.trim() : name.trim(),
      email: isAuthenticated ? defaultEmail || email.trim() : email.trim(),
      origin_page: '/contact',
    };

    const { data, error } = await supabase.functions.invoke<ContactSubmitResponse>('contact-submit', {
      body: payload,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    if (error) {
      const details = (data as ContactSubmitResponse | null)?.error;
      toast.error(details || error.message || 'Envoi impossible pour le moment.');
      setIsSubmitting(false);
      return;
    }

    if (data?.ok !== true) {
      toast.error(data?.error || 'Réponse serveur invalide.');
      setIsSubmitting(false);
      return;
    }

    toast.success('Message envoyé. Notre équipe vous répondra rapidement.');
    resetForm();
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-3xl mx-auto px-4 space-y-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">Contact</h1>
          <p className="text-zinc-400">
            Une question sur la plateforme, un paiement ou une battle ? Envoyez-nous un message.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isAuthenticated && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Nom"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Votre nom"
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="email@exemple.com"
                  required
                />
              </div>
            )}

            {isAuthenticated && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-300">
                Message envoyé en tant que <span className="text-white">{defaultEmail}</span>.
              </div>
            )}

            <Select
              label="Catégorie"
              value={category}
              onChange={(event) => setCategory(event.target.value as ContactCategory)}
              options={categoryOptions}
            />

            <Input
              label="Sujet"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Sujet de votre message"
              required
            />

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="contact-message">
                Message
              </label>
              <textarea
                id="contact-message"
                className="w-full min-h-[150px] bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Décrivez votre demande..."
                required
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" isLoading={isSubmitting} disabled={!isValid}>
                Envoyer
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
