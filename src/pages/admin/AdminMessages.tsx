import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { supabase } from '../../lib/supabase/client';
import type { Database } from '../../lib/supabase/types';

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
      toast.error('Chargement des messages impossible.');
      setRows([]);
      setIsLoading(false);
      return;
    }

    const parsed = ((data as unknown[]) ?? [])
      .map((row) => parseAdminMessage(row))
      .filter((row): row is AdminMessageRow => row !== null);

    setRows(parsed);
    setIsLoading(false);
  }, [categoryFilter, statusFilter]);

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
      toast.error('Mise à jour impossible.');
      setActionKey(null);
      return;
    }

    const parsed = parseAdminMessage(data);
    if (!parsed) {
      toast.error('Réponse serveur invalide.');
      setActionKey(null);
      return;
    }

    setRows((prev) => prev.map((item) => (item.id === parsed.id ? parsed : item)));
    toast.success('Message mis à jour.');
    setActionKey(null);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Messages reçus</h2>
            <p className="text-zinc-400 text-sm mt-1">
              Vue admin des demandes contact/support.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="all">Tous statuts</option>
              <option value="new">Nouveau</option>
              <option value="in_progress">En cours</option>
              <option value="closed">Clos</option>
            </select>

            <select
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
            >
              <option value="all">Toutes catégories</option>
              <option value="support">Support</option>
              <option value="battle">Battle</option>
              <option value="payment">Paiement</option>
              <option value="partnership">Partenariat</option>
              <option value="other">Autre</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-zinc-400">Chargement...</div>
        ) : filteredCount === 0 ? (
          <div className="p-6 text-zinc-500">Aucun message pour ces filtres.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-zinc-900/90 text-zinc-400">
                <tr>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-left p-3 font-medium">Contact</th>
                  <th className="text-left p-3 font-medium">Sujet</th>
                  <th className="text-left p-3 font-medium">Catégorie</th>
                  <th className="text-left p-3 font-medium">Origine</th>
                  <th className="text-left p-3 font-medium">Statut</th>
                  <th className="text-left p-3 font-medium">Priorité</th>
                  <th className="text-left p-3 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-800 text-zinc-200 align-top">
                    <td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="p-3 whitespace-nowrap">
                      <p>{row.name || 'Anonyme'}</p>
                      <p className="text-zinc-500">{row.email || '-'}</p>
                    </td>
                    <td className="p-3">{row.subject}</td>
                    <td className="p-3 whitespace-nowrap">{categoryLabel[row.category]}</td>
                    <td className="p-3 whitespace-nowrap">{row.origin_page || '-'}</td>
                    <td className="p-3">
                      <select
                        className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        value={row.status}
                        disabled={actionKey !== null}
                        onChange={(event) =>
                          void updateRow(row, { status: event.target.value as ContactStatus })
                        }
                      >
                        <option value="new">{statusLabel.new}</option>
                        <option value="in_progress">{statusLabel.in_progress}</option>
                        <option value="closed">{statusLabel.closed}</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                        value={row.priority}
                        disabled={actionKey !== null}
                        onChange={(event) =>
                          void updateRow(row, { priority: event.target.value as ContactPriority })
                        }
                      >
                        <option value="low">{priorityLabel.low}</option>
                        <option value="normal">{priorityLabel.normal}</option>
                        <option value="high">{priorityLabel.high}</option>
                      </select>
                    </td>
                    <td className="p-3 max-w-[360px]">
                      <p className="line-clamp-4 whitespace-pre-wrap text-zinc-300">{row.message}</p>
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
