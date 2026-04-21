import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useAuth } from '../lib/auth/hooks';
import { createLabelRequest, fetchOwnLabelRequests } from '../lib/supabase/elite';
import type { LabelRequest } from '../lib/supabase/types';
import { isEliteProducer, isVerifiedLabel } from '../lib/auth/elite';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LabelAccessPage() {
  const { user, profile } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [message, setMessage] = useState('');
  const [requests, setRequests] = useState<LabelRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasPendingRequest = useMemo(
    () => requests.some((request) => request.status === 'pending'),
    [requests],
  );

  useEffect(() => {
    let isCancelled = false;

    const loadRequests = async () => {
      if (!user?.id) {
        setRequests([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const nextRequests = await fetchOwnLabelRequests(user.id);
        if (!isCancelled) {
          setRequests(nextRequests);
        }
      } catch (error) {
        console.error('label requests load error', error);
        if (!isCancelled) {
          toast.error('Unable to load your label access requests.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadRequests();

    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user?.email]);

  const isFormValid =
    Boolean(user?.id) &&
    companyName.trim().length >= 2 &&
    EMAIL_REGEX.test(email.trim()) &&
    message.trim().length >= 10;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.id || !isFormValid || isSubmitting) {
      return;
    }

    if (hasPendingRequest) {
      toast.error('You already have a pending label request.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createLabelRequest({
        user_id: user.id,
        company_name: companyName,
        email,
        message,
      });

      setRequests((current) => [created, ...current]);
      setCompanyName('');
      setMessage('');
      toast.success('Label access request sent.');
    } catch (error) {
      console.error('label request submit error', error);
      toast.error('Unable to submit the label request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Private access</p>
          <h1 className="text-3xl font-bold text-white">Label Access</h1>
          <p className="text-zinc-400">
            Request verified label access without changing the public marketplace.
          </p>
        </div>

        {isVerifiedLabel(profile) && (
          <Card className="p-5 border border-emerald-500/30 bg-emerald-500/10">
            <p className="text-emerald-200 font-medium">Your label account is verified.</p>
            <div className="mt-3">
              <Link to="/elite-hub">
                <Button variant="secondary">Open Elite Hub</Button>
              </Link>
            </div>
          </Card>
        )}

        {isEliteProducer(profile) && !isVerifiedLabel(profile) && (
          <Card className="p-5 border border-amber-500/30 bg-amber-500/10 text-amber-100">
            Your account already has elite producer access. Label verification stays optional.
          </Card>
        )}

        <Card className="p-0">
          <CardHeader className="p-6 pb-3">
            <CardTitle>Request verification</CardTitle>
            <CardDescription>
              Your request is stored privately and can be reviewed from the admin dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Company name"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Your label or company"
                disabled={isSubmitting || hasPendingRequest}
                required
              />
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="contact@label.com"
                disabled={isSubmitting || hasPendingRequest}
                required
              />
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5" htmlFor="label-request-message">
                  Message
                </label>
                <textarea
                  id="label-request-message"
                  className="w-full min-h-[150px] bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Tell us about your label, artists, and why you need private access."
                  disabled={isSubmitting || hasPendingRequest}
                  required
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-500">
                  Existing auth stays unchanged. This form only creates a private review request.
                </p>
                <Button type="submit" isLoading={isSubmitting} disabled={!isFormValid || hasPendingRequest}>
                  Submit request
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="p-6 pb-3">
            <CardTitle>Your requests</CardTitle>
            <CardDescription>
              Track the status of your private label access requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={index} className="h-20 rounded-lg bg-zinc-900 border border-zinc-800 animate-pulse" />
                ))}
              </div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-zinc-400">No label access request yet.</p>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-white font-medium">{request.company_name}</p>
                        <p className="text-sm text-zinc-400">{request.email}</p>
                      </div>
                      <span
                        className={[
                          'rounded-full px-3 py-1 text-xs font-medium border',
                          request.status === 'approved'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : request.status === 'rejected'
                            ? 'border-red-500/30 bg-red-500/10 text-red-300'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                        ].join(' ')}
                      >
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-zinc-300 whitespace-pre-wrap">{request.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default LabelAccessPage;
