import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ReputationBadge } from '../../components/reputation/ReputationBadge';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import type { ReputationRankTier } from '../../lib/supabase/types';
import { formatDateTime } from '../../lib/utils/format';

interface AdminReputationRow {
  user_id: string;
  username: string | null;
  email: string | null;
  role: string;
  avatar_url: string | null;
  producer_tier: string | null;
  xp: number;
  level: number;
  rank_tier: ReputationRankTier;
  forum_xp: number;
  battle_xp: number;
  commerce_xp: number;
  reputation_score: number;
  updated_at: string;
}

export function AdminReputationPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AdminReputationRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminReputationRow | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('rpc_admin_get_reputation_overview' as any, {
      p_search: search.trim() || null,
      p_limit: 80,
    });

    if (error) {
      console.error('Error loading reputation overview:', error);
      toast.error(t('admin.reputation.loadError'));
      setRows([]);
      setIsLoading(false);
      return;
    }

    setRows((data as AdminReputationRow[] | null) ?? []);
    setIsLoading(false);
  }, [search, t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const submitAdjustment = async () => {
    if (!selectedUser) {
      toast.error(t('admin.reputation.selectUserError'));
      return;
    }

    const parsedDelta = Number.parseInt(delta, 10);
    if (!Number.isFinite(parsedDelta) || parsedDelta === 0) {
      toast.error(t('admin.reputation.invalidDelta'));
      return;
    }

    if (!reason.trim()) {
      toast.error(t('admin.reputation.reasonRequired'));
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.rpc('admin_adjust_reputation' as any, {
      p_user_id: selectedUser.user_id,
      p_delta_xp: parsedDelta,
      p_reason: reason.trim(),
      p_metadata: {
        ui: 'admin_reputation_page',
      },
    });

    if (error) {
      console.error('Error adjusting reputation:', error);
      toast.error(t('admin.reputation.adjustError'));
      setIsSubmitting(false);
      return;
    }

    toast.success(t('admin.reputation.adjustSuccess'));
    setDelta('');
    setReason('');
    await loadRows();
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('admin.reputation.title')}</h2>
            <p className="text-sm text-zinc-400">{t('admin.reputation.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={() => void loadRows()}>
            {t('common.refresh')}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <Input
          label={t('common.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('admin.reputation.searchPlaceholder')}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label={t('admin.reputation.targetUser')}
            value={selectedUser ? `${selectedUser.username || selectedUser.email || selectedUser.user_id}` : ''}
            readOnly
            placeholder={t('admin.reputation.targetUserPlaceholder')}
          />
          <Input
            label={t('admin.reputation.deltaLabel')}
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder={t('admin.reputation.deltaPlaceholder')}
          />
          <Input
            label={t('admin.reputation.reasonLabel')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('admin.reputation.reasonPlaceholder')}
          />
        </div>
        <div className="flex gap-3">
          <Button onClick={() => void submitAdjustment()} isLoading={isSubmitting}>
            {t('admin.reputation.apply')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedUser(null);
              setDelta('');
              setReason('');
            }}
          >
            {t('admin.reputation.reset')}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        {isLoading ? (
          <p className="text-zinc-400">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-zinc-500">{t('admin.reputation.empty')}</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.user_id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white">{row.username || row.email || row.user_id}</p>
                      <span className="text-xs text-zinc-500">{row.role}</span>
                    </div>
                    <p className="text-sm text-zinc-500">{row.email || t('admin.reputation.emailUnavailable')}</p>
                    <ReputationBadge rankTier={row.rank_tier} level={row.level} xp={row.xp} />
                    <p className="text-xs text-zinc-500">
                      {t('admin.reputation.breakdown', {
                        forum: row.forum_xp,
                        battles: row.battle_xp,
                        commerce: row.commerce_xp,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm text-zinc-400">
                      <div className="text-white font-semibold">{row.xp} {t('common.xpShort')}</div>
                      <div>{t('admin.reputation.updatedAt', { date: formatDateTime(row.updated_at) })}</div>
                    </div>
                    <Button variant="outline" onClick={() => setSelectedUser(row)}>
                      {t('admin.reputation.adjust')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
