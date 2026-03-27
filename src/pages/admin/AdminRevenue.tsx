import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import { formatDateTime, formatPrice } from '../../lib/utils/format';

interface RevenueRow {
  id: string;
  created_at: string;
  gross_eur: number;
  producer_share_eur: number;
  platform_share_eur: number;
  purchase_source: 'stripe_checkout' | 'credits';
  title: string;
  buyer_email: string;
  producer_email: string;
}

const adminDb = supabase as any;

export function AdminRevenuePage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadRevenue = async () => {
      try {
        setIsLoading(true);

        const { data, error } = await adminDb
          .from('admin_revenue_breakdown')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (!isCancelled) {
          setRows((data as RevenueRow[] | null) ?? []);
        }
      } catch (error) {
        console.error('Failed to load admin revenue breakdown', error);
        toast.error(t('admin.revenue.loadError'));
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadRevenue();

    return () => {
      isCancelled = true;
    };
  }, [t]);

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      gross: acc.gross + (row.gross_eur ?? 0),
      producer: acc.producer + (row.producer_share_eur ?? 0),
      platform: acc.platform + (row.platform_share_eur ?? 0),
    }),
    { gross: 0, producer: 0, platform: 0 },
  ), [rows]);

  const formatEuros = (value: number) => formatPrice(Math.round(value * 100));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{t('admin.revenue.title')}</h1>
        <p className="mt-2 text-zinc-400">{t('admin.revenue.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.totalGross')}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{formatEuros(totals.gross)}</p>
        </Card>
        <Card className="border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.totalProducer')}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{formatEuros(totals.producer)}</p>
        </Card>
        <Card className="border-zinc-800 p-5">
          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.totalPlatform')}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{formatEuros(totals.platform)}</p>
        </Card>
      </div>

      <Card className="overflow-hidden border-zinc-800">
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="text-sm text-zinc-400">
            {isLoading
              ? t('common.loading')
              : rows.length === 1
                ? t('admin.revenue.transactionCountSingular', { count: rows.length })
                : t('admin.revenue.transactionCountPlural', { count: rows.length })}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.date')}</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.product')}</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.buyer')}</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.producer')}</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.gross')}</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.producerShare')}</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.platformShare')}</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('admin.revenue.type')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-zinc-500">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-zinc-500">
                    {t('admin.revenue.empty')}
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-800/80 hover:bg-zinc-900/30">
                  <td className="px-5 py-4 text-sm text-zinc-300">{formatDateTime(row.created_at)}</td>
                  <td className="px-5 py-4 text-sm font-medium text-white">{row.title}</td>
                  <td className="px-5 py-4 text-sm text-zinc-300">{row.buyer_email}</td>
                  <td className="px-5 py-4 text-sm text-zinc-300">{row.producer_email}</td>
                  <td className="px-5 py-4 text-right text-sm text-white">{formatEuros(row.gross_eur)}</td>
                  <td className="px-5 py-4 text-right text-sm text-zinc-300">{formatEuros(row.producer_share_eur)}</td>
                  <td className="px-5 py-4 text-right text-sm font-semibold text-emerald-300">{formatEuros(row.platform_share_eur)}</td>
                  <td className="px-5 py-4 text-sm">
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
                        row.purchase_source === 'credits'
                          ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
                      ].join(' ')}
                    >
                      {row.purchase_source === 'credits'
                        ? t('admin.revenue.typeCredits')
                        : t('admin.revenue.typeCash')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
