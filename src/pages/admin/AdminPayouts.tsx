import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { AlertCircle, CheckCircle, Download, RotateCcw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

interface FallbackPayout {
  purchase_id: string;
  producer_id: string;
  username: string;
  email: string;
  payout_amount_eur: number;
  days_pending: number;
  urgency_level: string;
}

type UrgencyFilter = 'all' | 'critical' | 'warning' | 'ok';
type AgeFilter = 'all' | '0_6' | '7_13' | '14_plus';
type SortOption = 'days_desc' | 'days_asc' | 'amount_desc' | 'amount_asc' | 'producer_asc';

const urgencyFilterLabel: Record<UrgencyFilter, string> = {
  all: 'All urgency levels',
  critical: 'Critical',
  warning: 'Warning',
  ok: 'OK',
};

const ageFilterLabel: Record<AgeFilter, string> = {
  all: 'All delays',
  '0_6': '0 to 6 days',
  '7_13': '7 to 13 days',
  '14_plus': '14+ days',
};

const sortOptionLabel: Record<SortOption, string> = {
  days_desc: 'Oldest first',
  days_asc: 'Newest first',
  amount_desc: 'Highest amount',
  amount_asc: 'Lowest amount',
  producer_asc: 'Producer A-Z',
};

export function AdminPayouts() {
  const [payouts, setPayouts] = useState<FallbackPayout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('days_desc');

  const loadPayouts = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadPayouts();
  }, [loadPayouts]);

  const handleMarkPaid = async (purchaseId: string) => {
    try {
      setIsProcessing(purchaseId);

      const { error } = await supabase.rpc('mark_fallback_payout_processed', {
        p_purchase_id: purchaseId,
      });

      if (error) throw error;

      // Remove from list
      const paidPayout = payouts.find((p) => p.purchase_id === purchaseId);
      setPayouts((currentPayouts) => currentPayouts.filter((p) => p.purchase_id !== purchaseId));
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

  const getUrgencyCategory = (urgency: string): Exclude<UrgencyFilter, 'all'> => {
    if (urgency.includes('CRITIQUE')) return 'critical';
    if (urgency.includes('WARNING')) return 'warning';
    return 'ok';
  };

  const matchesAgeFilter = (daysPending: number, filter: AgeFilter) => {
    if (filter === '0_6') return daysPending <= 6;
    if (filter === '7_13') return daysPending >= 7 && daysPending <= 13;
    if (filter === '14_plus') return daysPending >= 14;
    return true;
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

  const filteredPayouts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const nextPayouts = payouts.filter((payout) => {
      const matchesSearch =
        normalizedSearch.length === 0
          || payout.username.toLowerCase().includes(normalizedSearch)
          || payout.email.toLowerCase().includes(normalizedSearch)
          || payout.purchase_id.toLowerCase().includes(normalizedSearch);
      const matchesUrgency =
        urgencyFilter === 'all' || getUrgencyCategory(payout.urgency_level) === urgencyFilter;

      return matchesSearch && matchesUrgency && matchesAgeFilter(payout.days_pending, ageFilter);
    });

    nextPayouts.sort((left, right) => {
      if (sortBy === 'days_asc') return left.days_pending - right.days_pending;
      if (sortBy === 'amount_desc') return right.payout_amount_eur - left.payout_amount_eur;
      if (sortBy === 'amount_asc') return left.payout_amount_eur - right.payout_amount_eur;
      if (sortBy === 'producer_asc') return left.username.localeCompare(right.username);
      return right.days_pending - left.days_pending;
    });

    return nextPayouts;
  }, [ageFilter, payouts, searchTerm, sortBy, urgencyFilter]);

  const filteredAmountTotal = useMemo(
    () => filteredPayouts.reduce((sum, payout) => sum + payout.payout_amount_eur, 0),
    [filteredPayouts]
  );

  const hasActiveFilters =
    searchTerm.trim().length > 0 || urgencyFilter !== 'all' || ageFilter !== 'all' || sortBy !== 'days_desc';

  const resetFilters = () => {
    setSearchTerm('');
    setUrgencyFilter('all');
    setAgeFilter('all');
    setSortBy('days_desc');
  };

  const handleExportExcel = async () => {
    if (filteredPayouts.length === 0) {
      toast.error('No visible payouts to export');
      return;
    }

    try {
      setIsExporting(true);

      const XLSX = await import('xlsx');
      const exportedAt = new Date();
      const exportRows = filteredPayouts.map((payout) => ({
        'Purchase ID': payout.purchase_id,
        'Producer ID': payout.producer_id,
        Producer: payout.username,
        Email: payout.email,
        'Amount (EUR)': payout.payout_amount_eur,
        'Days Pending': payout.days_pending,
        Urgency: payout.urgency_level,
      }));

      const summarySheet = XLSX.utils.aoa_to_sheet([
        ['Metric', 'Value'],
        ['Exported at', exportedAt.toLocaleString('fr-FR')],
        ['Visible payouts', filteredPayouts.length],
        ['Visible total (EUR)', filteredAmountTotal],
        ['Search', searchTerm.trim() || 'All'],
        ['Urgency filter', urgencyFilterLabel[urgencyFilter]],
        ['Age filter', ageFilterLabel[ageFilter]],
        ['Sort', sortOptionLabel[sortBy]],
      ]);
      summarySheet['!cols'] = [{ wch: 20 }, { wch: 28 }];

      const payoutSheet = XLSX.utils.json_to_sheet(exportRows);
      payoutSheet['!cols'] = [
        { wch: 38 },
        { wch: 38 },
        { wch: 22 },
        { wch: 34 },
        { wch: 14 },
        { wch: 14 },
        { wch: 16 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
      XLSX.utils.book_append_sheet(workbook, payoutSheet, 'Payouts');

      const fileStamp = exportedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      XLSX.writeFile(workbook, `fallback-payouts-${fileStamp}.xlsx`);

      toast.success(`Excel export ready (${filteredPayouts.length} payout${filteredPayouts.length === 1 ? '' : 's'})`);
    } catch (error) {
      console.error('Failed to export payouts to Excel:', error);
      toast.error('Failed to export Excel file');
    } finally {
      setIsExporting(false);
    }
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
            : `${filteredPayouts.length} / ${payouts.length} pending payout${payouts.length === 1 ? '' : 's'} visible`}
        </p>
      </div>

      {payouts.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 xl:flex-1">
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by producer, email or payout ID"
                  leftIcon={<Search className="h-4 w-4" />}
                />

                <div className="space-y-1.5">
                  <label htmlFor="payout-urgency-filter" className="block text-sm font-medium text-zinc-300">
                    Urgency
                  </label>
                  <select
                    id="payout-urgency-filter"
                    className="h-[46px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-100 transition-all duration-200 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
                    value={urgencyFilter}
                    onChange={(event) => setUrgencyFilter(event.target.value as UrgencyFilter)}
                  >
                    <option value="all">All urgency levels</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="ok">OK</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="payout-age-filter" className="block text-sm font-medium text-zinc-300">
                    Days pending
                  </label>
                  <select
                    id="payout-age-filter"
                    className="h-[46px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-100 transition-all duration-200 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
                    value={ageFilter}
                    onChange={(event) => setAgeFilter(event.target.value as AgeFilter)}
                  >
                    <option value="all">All delays</option>
                    <option value="0_6">0 to 6 days</option>
                    <option value="7_13">7 to 13 days</option>
                    <option value="14_plus">14+ days</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="payout-sort" className="block text-sm font-medium text-zinc-300">
                    Sort
                  </label>
                  <select
                    id="payout-sort"
                    className="h-[46px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm text-zinc-100 transition-all duration-200 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as SortOption)}
                  >
                    <option value="days_desc">Oldest first</option>
                    <option value="days_asc">Newest first</option>
                    <option value="amount_desc">Highest amount</option>
                    <option value="amount_asc">Lowest amount</option>
                    <option value="producer_asc">Producer A-Z</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div className="rounded-lg border border-zinc-800 bg-black/20 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">Visible total</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    €{filteredAmountTotal.toFixed(2)}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleExportExcel}
                  disabled={filteredPayouts.length === 0}
                  isLoading={isExporting}
                  leftIcon={<Download className="h-4 w-4" />}
                >
                  Export Excel
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  leftIcon={<RotateCcw className="h-4 w-4" />}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>

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
                  {filteredPayouts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center">
                        <div className="mx-auto max-w-md space-y-2">
                          <p className="text-sm font-medium text-white">No payout matches the current filters</p>
                          <p className="text-sm text-zinc-400">
                            Adjust the search or filters to display the pending payouts you need.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPayouts.map((payout) => (
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
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
