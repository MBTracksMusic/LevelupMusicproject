import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, MailQuestion, Swords, XCircle } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation, type TranslateFn } from '../lib/i18n';
import { supabase } from '../lib/supabase/client';
import type { BattleStatus } from '../lib/supabase/types';
import { formatDate } from '../lib/utils/format';

interface ProducerOption {
  id: string;
  username: string | null;
}

interface ProductOption {
  id: string;
  title: string;
}

interface ManagedBattle {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  rejection_reason: string | null;
  accepted_at: string | null;
  admin_validated_at: string | null;
  voting_ends_at: string | null;
  votes_producer1: number;
  votes_producer2: number;
  producer2?: { username: string | null };
  product1?: { title: string };
  product2?: { title: string };
}

interface IncomingBattle {
  id: string;
  title: string;
  slug: string;
  status: BattleStatus;
  response_deadline: string | null;
  producer1?: { username: string | null };
  product1?: { title: string };
  product2?: { title: string };
}

interface BattleQuotaStatus {
  tier: string;
  used_this_month: number;
  max_per_month: number | null;
  can_create: boolean;
  reset_at: string;
}

const badgeByStatus: Record<BattleStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'premium'> = {
  pending: 'warning',
  pending_acceptance: 'warning',
  awaiting_admin: 'info',
  approved: 'info',
  active: 'success',
  voting: 'success',
  completed: 'info',
  cancelled: 'danger',
  rejected: 'danger',
};

function toRpcErrorMessage(error: {
  code?: string;
  details?: string | null;
  message?: string;
}, t: TranslateFn) {
  const code = error.code || 'unknown_code';
  const message = error.message || 'Unknown error';
  const details = error.details ? ` (${error.details})` : '';
  const technical = `[${code}] ${message}${details}`;

  if (message.includes('rejection_reason_required')) return t('producerBattles.rejectionReasonRequired');
  if (message.includes('response_already_recorded')) return t('producerBattles.responseAlreadyRecorded');
  if (message.includes('battle_not_waiting_for_response')) return t('producerBattles.noLongerAwaitingResponse');
  if (message.includes('only_invited_producer_can_respond')) return t('producerBattles.onlyInvitedProducer');
  if (message.includes('battle_not_found')) return t('producerBattles.battleNotFound');
  if (message.includes('auth_required') || code === '42501') {
    return t('producerBattles.sessionExpired', { technical });
  }

  return t('producerBattles.actionUnavailable', { technical });
}

function toStatusLabel(status: BattleStatus, t: TranslateFn) {
  if (status === 'pending_acceptance') return t('battleDetail.statusPendingAcceptance');
  if (status === 'awaiting_admin') return t('battleDetail.statusAwaitingAdmin');
  if (status === 'rejected') return t('battleDetail.statusRejected');
  if (status === 'active') return t('battleDetail.statusActive');
  if (status === 'voting') return t('battles.legacyVoting');
  if (status === 'completed') return t('battleDetail.statusCompleted');
  if (status === 'cancelled') return t('battleDetail.statusCancelled');
  if (status === 'approved') return t('battleDetail.statusApproved');
  return t('battleDetail.statusPending');
}

function slugifyBattleTitle(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toBattleInsertErrorMessage(error: {
  code?: string;
  details?: string | null;
  message?: string;
}, quotaStatus: BattleQuotaStatus | null, t: TranslateFn) {
  const code = error.code || 'unknown_code';
  const message = error.message || 'Unknown error';
  const details = error.details ? ` (${error.details})` : '';
  const technical = `[${code}] ${message}${details}`;

  const isRlsError =
    code === '42501'
    || message.includes('new row violates row-level security')
    || message.includes('permission denied');

  if (isRlsError && quotaStatus && quotaStatus.can_create === false) {
    return t('producerBattles.insertQuotaBlocked', { technical });
  }

  if (isRlsError) {
    return t('producerBattles.insertSecurityBlocked', { technical });
  }

  return t('producerBattles.insertUnavailable', { technical });
}

export function ProducerBattlesPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [producers, setProducers] = useState<ProducerOption[]>([]);
  const [myProducts, setMyProducts] = useState<ProductOption[]>([]);
  const [producer2Products, setProducer2Products] = useState<ProductOption[]>([]);
  const [battles, setBattles] = useState<ManagedBattle[]>([]);
  const [incomingBattles, setIncomingBattles] = useState<IncomingBattle[]>([]);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [quotaStatus, setQuotaStatus] = useState<BattleQuotaStatus | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    producer2Id: '',
    product1Id: '',
    product2Id: '',
  });

  const producerOptions = useMemo(
    () => [
      { value: '', label: t('producerBattles.chooseProducer') },
      ...producers.map((p) => ({ value: p.id, label: p.username || p.id })),
    ],
    [producers, t]
  );

  const product1Options = useMemo(
    () => [
      { value: '', label: t('producerBattles.chooseProduct') },
      ...myProducts.map((p) => ({ value: p.id, label: p.title })),
    ],
    [myProducts, t]
  );

  const product2Options = useMemo(
    () => [
      { value: '', label: t('producerBattles.chooseProduct') },
      ...producer2Products.map((p) => ({ value: p.id, label: p.title })),
    ],
    [producer2Products, t]
  );

  const loadQuotaStatus = useCallback(async () => {
    if (!profile?.id) return null;

    setIsQuotaLoading(true);

    const { data, error: quotaFetchError } = await supabase.rpc('get_battles_quota_status');

    if (quotaFetchError) {
      console.error('Error loading battles quota status:', {
        code: quotaFetchError.code,
        message: quotaFetchError.message,
        details: quotaFetchError.details,
      });
      setQuotaStatus(null);
      setQuotaError(
        t('producerBattles.loadQuotaError', {
          code: quotaFetchError.code || 'unknown_code',
          message: quotaFetchError.message,
        })
      );
      setIsQuotaLoading(false);
      return null;
    }

    const quotaRow = (Array.isArray(data) ? data[0] : data) as BattleQuotaStatus | null;
    setQuotaStatus(quotaRow);
    setQuotaError(null);
    setIsQuotaLoading(false);
    return quotaRow;
  }, [profile?.id, t]);

  const loadBattles = useCallback(async () => {
    if (!profile?.id) return;

    const [createdRes, incomingRes] = await Promise.all([
      supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          status,
          rejection_reason,
          accepted_at,
          admin_validated_at,
          voting_ends_at,
          votes_producer1,
          votes_producer2,
          producer2:user_profiles!battles_producer2_id_fkey(username),
          product1:products!battles_product1_id_fkey(title),
          product2:products!battles_product2_id_fkey(title)
        `)
        .eq('producer1_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('battles')
        .select(`
          id,
          title,
          slug,
          status,
          response_deadline,
          producer1:user_profiles!battles_producer1_id_fkey(username),
          product1:products!battles_product1_id_fkey(title),
          product2:products!battles_product2_id_fkey(title)
        `)
        .eq('producer2_id', profile.id)
        .eq('status', 'pending_acceptance')
        .order('created_at', { ascending: false }),
    ]);

    if (createdRes.error) {
      console.error('Error fetching producer battles:', createdRes.error);
      setError(t('producerBattles.loadCreatedError'));
      setBattles([]);
    } else {
      setBattles((createdRes.data as ManagedBattle[] | null) ?? []);
    }

    if (incomingRes.error) {
      console.error('Error fetching incoming battle responses:', incomingRes.error);
      setIncomingBattles([]);
      if (!createdRes.error) {
        setError(t('producerBattles.loadIncomingError'));
      }
    } else {
      setIncomingBattles((incomingRes.data as IncomingBattle[] | null) ?? []);
    }
  }, [profile?.id, t]);

  useEffect(() => {
    let isCancelled = false;

    async function loadInitial() {
      if (!profile?.id) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const [producersRes, productsRes] = await Promise.all([
        supabase
          .from('public_producer_profiles')
          .select('user_id, username')
          .neq('user_id', profile.id)
          .order('username', { ascending: true }),
        supabase
          .from('products')
          .select('id, title')
          .eq('producer_id', profile.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      ]);

      if (!isCancelled) {
        if (producersRes.error) {
          console.error('Error loading producers for battle creation:', producersRes.error);
        }
        if (productsRes.error) {
          console.error('Error loading producer products:', productsRes.error);
        }

        const producerRows = ((producersRes.data as Array<{ user_id: string; username: string | null }> | null) ?? [])
          .map((row) => ({ id: row.user_id, username: row.username }));
        setProducers(producerRows);
        setMyProducts((productsRes.data as ProductOption[] | null) ?? []);

        await Promise.all([loadBattles(), loadQuotaStatus()]);
        setIsLoading(false);
      }
    }

    void loadInitial();

    return () => {
      isCancelled = true;
    };
  }, [loadBattles, loadQuotaStatus, profile?.id]);

  useEffect(() => {
    let isCancelled = false;

    async function loadProducer2Products() {
      if (!form.producer2Id) {
        setProducer2Products([]);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('products')
        .select('id, title')
        .eq('producer_id', form.producer2Id)
        .eq('is_published', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (!isCancelled) {
        if (fetchError) {
          console.error('Error loading producer2 products:', fetchError);
          setProducer2Products([]);
        } else {
          setProducer2Products((data as ProductOption[] | null) ?? []);
        }
      }
    }

    void loadProducer2Products();

    return () => {
      isCancelled = true;
    };
  }, [form.producer2Id]);

  const createBattle = async () => {
    if (!profile?.id) return;

    if (!form.title.trim()) {
      setError(t('producerBattles.titleRequired'));
      return;
    }

    if (!form.producer2Id) {
      setError(t('producerBattles.invitedProducerRequired'));
      return;
    }

    setError(null);
    setIsSaving(true);

    const latestQuota = await loadQuotaStatus();
    if (latestQuota && !latestQuota.can_create) {
      setError(t('producerBattles.quotaReachedError'));
      setIsSaving(false);
      return;
    }

    const { error: insertError } = await supabase
      .from('battles')
      .insert({
        title: form.title.trim(),
        slug: `${slugifyBattleTitle(form.title.trim()) || 'battle'}-${crypto.randomUUID().slice(0, 8)}`,
        description: form.description.trim() || null,
        producer1_id: profile.id,
        producer2_id: form.producer2Id,
        product1_id: form.product1Id || null,
        product2_id: form.product2Id || null,
        status: 'pending_acceptance',
        winner_id: undefined,
        votes_producer1: 0,
        votes_producer2: 0,
      });

    if (insertError) {
      console.error('Error creating battle:', {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
      });
      const refreshedQuota = await loadQuotaStatus();
      setError(toBattleInsertErrorMessage(insertError, refreshedQuota, t));
      setIsSaving(false);
      return;
    }

    setForm({
      title: '',
      description: '',
      producer2Id: '',
      product1Id: '',
      product2Id: '',
    });
    setProducer2Products([]);
    setIsSaving(false);
    await Promise.all([loadBattles(), loadQuotaStatus()]);
  };

  const respondToBattle = async (battleId: string, accept: boolean) => {
    setError(null);
    setRespondingId(battleId);

    const reason = (rejectReasons[battleId] || '').trim();
    if (!accept && !reason) {
      setRespondingId(null);
      setError(t('producerBattles.rejectionReasonRequired'));
      return;
    }

    const { error: rpcError } = await supabase.rpc('respond_to_battle', {
      p_battle_id: battleId,
      p_accept: accept,
      p_reason: accept ? undefined : reason,
    });

    if (rpcError) {
      console.error('Error responding to battle:', {
        battleId,
        accept,
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
      });
      setRespondingId(null);
      setError(toRpcErrorMessage(rpcError, t));
      return;
    }

    setRejectReasons((prev) => ({ ...prev, [battleId]: '' }));
    setRespondingId(null);
    await loadBattles();
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{t('producerBattles.title')}</h1>
            <p className="text-zinc-400 mt-1">{t('producerBattles.subtitle')}</p>
          </div>
          <Link to="/battles">
            <Button variant="outline">{t('producerBattles.publicList')}</Button>
          </Link>
        </div>

        {error && (
          <Card className="bg-red-900/20 border border-red-800 text-red-300 inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </Card>
        )}

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white inline-flex items-center gap-2">
            <Swords className="w-4 h-4" />
            {t('producerBattles.createSectionTitle')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('producerBattles.titleLabel')}
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder={t('producerBattles.titlePlaceholder')}
            />

            <Input
              label={t('common.description')}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder={t('producerBattles.descriptionPlaceholder')}
            />

            <Select
              label={t('producerBattles.producer2Label')}
              value={form.producer2Id}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  producer2Id: event.target.value,
                  product2Id: '',
                }))
              }
              options={producerOptions}
            />

            <Select
              label={t('producerBattles.product1Label')}
              value={form.product1Id}
              onChange={(event) => setForm((prev) => ({ ...prev, product1Id: event.target.value }))}
              options={product1Options}
            />

            <Select
              label={t('producerBattles.product2Label')}
              value={form.product2Id}
              onChange={(event) => setForm((prev) => ({ ...prev, product2Id: event.target.value }))}
              options={product2Options}
              disabled={!form.producer2Id}
            />
          </div>

          <div className="flex flex-col gap-3 border border-zinc-800 rounded-lg p-3 bg-zinc-900/40">
            <p className="text-sm text-zinc-300">
              {quotaStatus
                ? t('producerBattles.quotaSummary', {
                  used: quotaStatus.used_this_month,
                  max: quotaStatus.max_per_month ?? t('common.unlimited'),
                })
                : isQuotaLoading
                ? t('producerBattles.loadingQuota')
                : t('producerBattles.quotaUnavailable')}
            </p>
            {quotaStatus && !quotaStatus.can_create && (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-sm text-amber-300">
                  {t('producerBattles.quotaReachedNotice', {
                    date: formatDate(quotaStatus.reset_at),
                  })}
                </p>
                {quotaStatus.tier !== 'elite' && (
                  <Link to="/pricing">
                    <Button variant="outline">{t('producerBattles.viewPlans')}</Button>
                  </Link>
                )}
              </div>
            )}
            {quotaError && <p className="text-sm text-red-400">{quotaError}</p>}
            <div className="flex justify-end">
              <Button
                onClick={createBattle}
                isLoading={isSaving}
                disabled={quotaStatus !== null && !quotaStatus.can_create}
              >
                {t('common.create')}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white inline-flex items-center gap-2">
            <MailQuestion className="w-4 h-4" />
            {t('producerBattles.incomingTitle')}
          </h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : incomingBattles.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('producerBattles.noIncoming')}</p>
          ) : (
            <ul className="space-y-3">
              {incomingBattles.map((battle) => (
                <li key={battle.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/50 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-white font-semibold">{battle.title}</p>
                      <p className="text-zinc-400 text-sm">
                        {t('producerBattles.invitedBy', {
                          name: battle.producer1?.username || t('producerBattles.producerFallback'),
                        })}
                      </p>
                      <p className="text-zinc-500 text-xs mt-1">
                        {battle.product1?.title || t('producerBattles.product1Undefined')} {t('battles.vs')} {battle.product2?.title || t('producerBattles.product2Undefined')}
                      </p>
                    </div>

                    <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status, t)}</Badge>
                  </div>

                  <div className="space-y-2">
                    <Input
                      label={t('producerBattles.rejectionReasonLabel')}
                      value={rejectReasons[battle.id] || ''}
                      onChange={(event) =>
                        setRejectReasons((prev) => ({
                          ...prev,
                          [battle.id]: event.target.value,
                        }))
                      }
                      placeholder={t('producerBattles.rejectionReasonPlaceholder')}
                    />
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={respondingId === battle.id}
                        leftIcon={<CheckCircle2 className="w-4 h-4" />}
                        onClick={() => respondToBattle(battle.id, true)}
                      >
                        {t('producerBattles.accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={respondingId === battle.id}
                        leftIcon={<XCircle className="w-4 h-4" />}
                        onClick={() => respondToBattle(battle.id, false)}
                      >
                        {t('producerBattles.reject')}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">{t('producerBattles.createdTitle')}</h2>

          {isLoading ? (
            <p className="text-zinc-400 text-sm">{t('common.loading')}</p>
          ) : battles.length === 0 ? (
            <p className="text-zinc-500 text-sm">{t('battles.empty')}</p>
          ) : (
            <ul className="space-y-3">
              {battles.map((battle) => (
                <li key={battle.id} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/50 space-y-2">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-white font-semibold">{battle.title}</p>
                      <p className="text-zinc-400 text-sm">
                        {battle.product1?.title || t('producerBattles.product1Missing')} {t('battles.vs')} {battle.product2?.title || t('producerBattles.product2Missing')}
                      </p>
                      <p className="text-zinc-500 text-xs mt-1">
                        {t('producerBattles.votes', {
                          producer1: battle.votes_producer1,
                          producer2: battle.votes_producer2,
                        })}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                      <Badge variant={badgeByStatus[battle.status]}>{toStatusLabel(battle.status, t)}</Badge>
                      <Link to={`/battles/${battle.slug}`}>
                        <Button size="sm" variant="ghost">{t('common.open')}</Button>
                      </Link>
                    </div>
                  </div>

                  {battle.status === 'rejected' && battle.rejection_reason && (
                    <p className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded px-3 py-2">
                      {t('producerBattles.rejectionReasonPrefix', { reason: battle.rejection_reason })}
                    </p>
                  )}

                  {battle.status === 'awaiting_admin' && (
                    <p className="text-sm text-sky-300 bg-sky-900/20 border border-sky-800 rounded px-3 py-2">
                      {t('producerBattles.awaitingAdminNotice')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
