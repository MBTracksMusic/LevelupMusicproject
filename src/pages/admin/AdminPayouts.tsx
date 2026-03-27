import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth/hooks';
import { supabase } from '@/lib/supabase/client';
import { AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface FallbackPayout {
  purchase_id: string;
  producer_id: string;
  username: string;
  email: string;
  payout_amount_eur: number;
  days_pending: number;
  urgency_level: string;
}

const adminDb = supabase as any;

export function AdminPayouts() {
  const { profile } = useAuth();
  const [payouts, setPayouts] = useState<FallbackPayout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadPayouts();
  }, []);

  const loadPayouts = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('fallback_payout_alerts')
        .select('*')
        .order('days_pending', { ascending: false });

      if (error) throw error;
      setPayouts(data || []);
    } catch (err) {
      console.error('Failed to load payouts:', err);
      toast.error('Failed to load payouts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkPaid = async (purchaseId: string) => {
    try {
      setIsProcessing(purchaseId);

      const { error } = await adminDb.rpc('mark_fallback_payout_processed', {
        p_purchase_id: purchaseId,
      });

      if (error) throw error;

      // Remove from list
      const paidPayout = payouts.find((p) => p.purchase_id === purchaseId);
      setPayouts(payouts.filter((p) => p.purchase_id !== purchaseId));
      toast.success(`Payout marked as paid for ${paidPayout?.username}`);
    } catch (err) {
      console.error('Failed to mark payout as paid:', err);
      const rawMessage = err instanceof Error ? err.message : 'Failed to mark payout as paid';
      const message = rawMessage.includes('already_processed') ? 'Already processed' : rawMessage;
      toast.error(message);
    } finally {
      setIsProcessing(null);
    }
  };

  const getUrgencyStyles = (urgency: string) => {
    if (urgency.includes('CRITIQUE')) {
      return 'bg-red-500/10 border-red-500/20 text-red-300';
    }
    if (urgency.includes('WARNING')) {
      return 'bg-orange-500/10 border-orange-500/20 text-orange-300';
    }
    return 'bg-zinc-500/10 border-zinc-500/20 text-zinc-300';
  };

  const getUrgencyIcon = (urgency: string) => {
    if (urgency.includes('CRITIQUE')) {
      return <AlertCircle className="w-4 h-4" />;
    }
    if (urgency.includes('WARNING')) {
      return <AlertCircle className="w-4 h-4" />;
    }
    return <CheckCircle className="w-4 h-4" />;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Fallback Payouts</h1>
          <p className="text-zinc-400 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Fallback Payouts</h1>
        <p className="text-zinc-400 mt-2">
          {payouts.length === 0
            ? 'No pending payouts'
            : `${payouts.length} pending payout${payouts.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {payouts.length > 0 && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-zinc-900/50 border-b border-zinc-800">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-zinc-300">Producer</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-zinc-300">Email</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-zinc-300">Amount</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-zinc-300">Days Pending</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-zinc-300">Urgency</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-zinc-300">Action</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.purchase_id} className="border-b border-zinc-800 hover:bg-zinc-900/30 transition">
                    <td className="px-6 py-4 text-sm text-zinc-300">{payout.username}</td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{payout.email}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-white">
                      €{payout.payout_amount_eur.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">{payout.days_pending} days</td>
                    <td className="px-6 py-4">
                      <div
                        className={`inline-flex items-center gap-2 px-3 py-1 text-xs font-medium rounded border ${getUrgencyStyles(
                          payout.urgency_level
                        )}`}
                      >
                        {getUrgencyIcon(payout.urgency_level)}
                        {payout.urgency_level}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleMarkPaid(payout.purchase_id)}
                        disabled={isProcessing === payout.purchase_id}
                        className="px-4 py-2 text-sm font-medium rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        {isProcessing === payout.purchase_id ? 'Processing...' : 'Mark as paid'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payouts.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="text-zinc-400">All fallback payouts have been processed</p>
        </div>
      )}
    </div>
  );
}
