import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import type { Database } from '../../lib/supabase/types';
import { formatDateTime } from '../../lib/utils/format';

type ContactStatus = 'new' | 'in_progress' | 'closed';
type ContactPriority = 'low' | 'normal' | 'high';
type ContactCategory = 'support' | 'battle' | 'payment' | 'partnership' | 'other';
type StatusFilter = 'all' | ContactStatus;
type CategoryFilter = 'all' | ContactCategory;

interface AdminMessageRow {
  id: string;
  created_at: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  subject: string;
  category: ContactCategory;
  message: string;
  status: ContactStatus;
  priority: ContactPriority;
  origin_page: string | null;
}

const contactMessagesSource = 'contact_messages' as unknown as keyof Database['public']['Tables'];

const categoryLabel: Record<ContactCategory, string> = {
  support: 'Support',
  battle: 'Battle',
  payment: 'Paiement',
  partnership: 'Partenariat',
  other: 'Autre',
};

const statusLabel: Record<ContactStatus, string> = {
  new: 'Nouveau',
  in_progress: 'En cours',
  closed: 'Clos',
};

const priorityLabel: Record<ContactPriority, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
};

const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asRequiredString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  return value.length > 0 ? value : null;
};

const parseAdminMessage = (row: unknown): AdminMessageRow | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const id = asRequiredString(source.id);
  const createdAt = asRequiredString(source.created_at);
  const subject = asRequiredString(source.subject);
  const message = asRequiredString(source.message);
  const category = asRequiredString(source.category) as ContactCategory | null;
  const status = asRequiredString(source.status) as ContactStatus | null;
  const priority = asRequiredString(source.priority) as ContactPriority | null;

  if (!id || !createdAt || !subject || !message || !category || !status || !priority) {
    return null;
  }
  if (!(category in categoryLabel) || !(status in statusLabel) || !(priority in priorityLabel)) {
    return null;
  }

  return {
    id,
    created_at: createdAt,
    user_id: asNullableString(source.user_id),
    name: asNullableString(source.name),
    email: asNullableString(source.email),
    subject,
    category,
    message,
    status,
    priority,
    origin_page: asNullableString(source.origin_page),
  };
};

export function AdminMessagesPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AdminMessageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [actionKey, setActionKey] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    let query = supabase
      .from(contactMessagesSource)
      .select('id, created_at, user_id, name, email, subject, category, message, status, priority, origin_page')
      .order('created_at', { ascending: false })
      .limit(50);

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (categoryFilter !== 'all') {
      query = query.eq('category', categoryFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error loading admin contact messages:', error);
      toast.error(t('admin.messages.loadError'));
      setRows([]);
      setIsLoading(false);
      return;
    }

    const parsed = ((data as unknown[]) ?? [])
      .map((row) => parseAdminMessage(row))
      .filter((row): row is AdminMessageRow => row !== null);

    setRows(parsed);
    setIsLoading(false);
  }, [categoryFilter, statusFilter, t]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const filteredCount = useMemo(() => rows.length, [rows]);

  const updateRow = async (
    row: AdminMessageRow,
    patch: Partial<Pick<AdminMessageRow, 'status' | 'priority'>>,
  ) => {
    const key = `${row.id}:${patch.status ?? row.status}:${patch.priority ?? row.priority}`;
    setActionKey(key);

    const { data, error } = await supabase
      .from(contactMessagesSource)
      .update(patch)
      .eq('id', row.id)
      .select('id, created_at, user_id, name, email, subject, category, message, status, priority, origin_page')
      .single();

    if (error) {
      console.error('Error updating contact message:', error);
      toast.error(t('admin.messages.updateError'));
      setActionKey(null);
      return;
    }

    const parsed = parseAdminMessage(data);
    if (!parsed) {
      toast.error(t('admin.messages.invalidResponse'));
      setActionKey(null);
      return;
    }

    setRows((prev) => prev.map((item) => (item.id === parsed.id ? parsed : item)));
    toast.success(t('admin.messages.updateSuccess'));
    setActionKey(null);
  };

  const deleteRow = async (row: AdminMessageRow) => {
    if (actionKey !== null) return;

    const confirmed = window.confirm(
      t('admin.messages.deleteConfirm', { subject: row.subject }),
    );
    if (!confirmed) return;

    const key = `delete:${row.id}`;
    setActionKey(key);

    const { error } = await supabase
      .from(contactMessagesSource)
      .delete()
      .eq('id', row.id);

    if (error) {
      console.error('Error deleting contact message:', error);
      toast.error(t('admin.messages.deleteError'));
      setActionKey(null);
      return;
    }

    setRows((prev) => prev.filter((item) => item.id !== row.id));
    toast.success(t('admin.messages.deleteSuccess'));
    setActionKey(null);
  };

  const getCategoryLabel = (category: ContactCategory) => {
    if (category === 'support') return t('myMessages.categorySupport');
    if (category === 'battle') return t('myMessages.categoryBattle');
    if (category === 'payment') return t('myMessages.categoryPayment');
    if (category === 'partnership') return t('myMessages.categoryPartnership');
    return t('myMessages.categoryOther');
  };
  const getStatusLabel = (status: ContactStatus) => {
    if (status === 'new') return t('myMessages.statusNew');
    if (status === 'in_progress') return t('myMessages.statusInProgress');
    return t('myMessages.statusClosed');
  };
  const getPriorityLabel = (priority: ContactPriority) => {
    if (priority === 'low') return t('myMessages.priorityLow');
    if (priority === 'normal') return t('myMessages.priorityNormal');
    return t('myMessages.priorityHigh');
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">{t('admin.messages.title')}</h2>
            <p className="text-zinc-400 text-sm mt-1">
              {t('admin.messages.subtitle')}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="all">{t('admin.messages.allStatuses')}</option>
              <option value="new">{t('myMessages.statusNew')}</option>
              <option value="in_progress">{t('myMessages.statusInProgress')}</option>
              <option value="closed">{t('myMessages.statusClosed')}</option>
            </select>

            <select
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
            >
              <option value="all">{t('admin.messages.allCategories')}</option>
              <option value="support">{t('myMessages.categorySupport')}</option>
              <option value="battle">{t('myMessages.categoryBattle')}</option>
              <option value="payment">{t('myMessages.categoryPayment')}</option>
              <option value="partnership">{t('myMessages.categoryPartnership')}</option>
              <option value="other">{t('myMessages.categoryOther')}</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-zinc-400">{t('common.loading')}</div>
        ) : filteredCount === 0 ? (
          <div className="p-6 text-zinc-500">{t('admin.messages.empty')}</div>
        ) : (
          <div className="overflow-x-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[980px] table-fixed text-sm">
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[250px]" />
                <col className="w-[170px]" />
                <col className="w-[120px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[150px]" />
                <col className="w-[220px]" />
              </colgroup>
              <thead className="bg-zinc-900/95 text-zinc-400">
                <tr>
                  <th className="text-left p-3 font-medium">{t('common.date')}</th>
                  <th className="text-left p-3 font-medium">{t('admin.messages.contact')}</th>
                  <th className="text-left p-3 font-medium">{t('common.subject')}</th>
                  <th className="text-left p-3 font-medium">{t('common.category')}</th>
                  <th className="text-left p-3 font-medium">{t('admin.messages.origin')}</th>
                  <th className="text-left p-3 font-medium">{t('common.status')}</th>
                  <th className="text-left p-3 font-medium">{t('common.priority')}</th>
                  <th className="sticky right-0 border-l border-zinc-800 bg-zinc-900/95 text-right p-3 font-medium">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-800 text-zinc-200 align-top hover:bg-zinc-900/30">
                    <td className="p-3 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                    <td className="p-3">
                      <p className="truncate font-medium">{row.name || t('admin.messages.anonymous')}</p>
                      <p className="truncate text-zinc-500">{row.email || t('common.notAvailable')}</p>
                    </td>
                    <td className="p-3">
                      <p className="line-clamp-2">{row.subject}</p>
                    </td>
                    <td className="p-3 whitespace-nowrap">{getCategoryLabel(row.category)}</td>
                    <td className="p-3">
                      <p className="truncate text-zinc-300">{row.origin_page || t('common.notAvailable')}</p>
                    </td>
                    <td className="p-3">
                      <select
                        className="h-9 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        value={row.status}
                        disabled={actionKey !== null}
                        onChange={(event) =>
                          void updateRow(row, { status: event.target.value as ContactStatus })
                        }
                      >
                        <option value="new">{getStatusLabel('new')}</option>
                        <option value="in_progress">{getStatusLabel('in_progress')}</option>
                        <option value="closed">{getStatusLabel('closed')}</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        className="h-9 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        value={row.priority}
                        disabled={actionKey !== null}
                        onChange={(event) =>
                          void updateRow(row, { priority: event.target.value as ContactPriority })
                        }
                      >
                        <option value="low">{getPriorityLabel('low')}</option>
                        <option value="normal">{getPriorityLabel('normal')}</option>
                        <option value="high">{getPriorityLabel('high')}</option>
                      </select>
                    </td>
                    <td className="sticky right-0 border-l border-zinc-800 bg-zinc-950/95 p-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/admin/messages/${row.id}`}
                          onClick={(event) => {
                            if (actionKey !== null) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <Button size="sm" variant="secondary" disabled={actionKey !== null}>
                            {t('myMessages.viewDetails')}
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="danger"
                          isLoading={actionKey === `delete:${row.id}`}
                          disabled={actionKey !== null}
                          onClick={() => void deleteRow(row)}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
