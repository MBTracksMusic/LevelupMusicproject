import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';
import type { Database } from '../../lib/supabase/types';
import { formatDateTime } from '../../lib/utils/format';

type ContactStatus = 'new' | 'in_progress' | 'closed';
type ContactPriority = 'low' | 'normal' | 'high';
type ContactCategory = 'support' | 'battle' | 'payment' | 'partnership' | 'other';

interface MyMessageRow {
  id: string;
  created_at: string;
  subject: string;
  category: ContactCategory;
  status: ContactStatus;
  priority: ContactPriority;
  message: string;
}

const contactMessagesSource = 'contact_messages' as unknown as keyof Database['public']['Tables'];

const asNonEmptyString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

const parseMessageRow = (row: unknown): MyMessageRow | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const id = asNonEmptyString(source.id);
  const createdAt = asNonEmptyString(source.created_at);
  const subject = asNonEmptyString(source.subject);
  const message = asNonEmptyString(source.message);
  const category = asNonEmptyString(source.category) as ContactCategory | null;
  const status = asNonEmptyString(source.status) as ContactStatus | null;
  const priority = asNonEmptyString(source.priority) as ContactPriority | null;

  if (!id || !createdAt || !subject || !message || !category || !status || !priority) {
    return null;
  }

  if (!['support', 'battle', 'payment', 'partnership', 'other'].includes(category)) {
    return null;
  }

  if (!['new', 'in_progress', 'closed'].includes(status)) {
    return null;
  }

  if (!['low', 'normal', 'high'].includes(priority)) {
    return null;
  }

  return {
    id,
    created_at: createdAt,
    subject,
    category,
    status,
    priority,
    message,
  };
};

export function MyMessagesPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MyMessageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<MyMessageRow | null>(null);

  const getStatusLabel = (status: ContactStatus) => {
    if (status === 'new') return t('myMessages.statusNew');
    if (status === 'in_progress') return t('myMessages.statusInProgress');
    return t('myMessages.statusClosed');
  };

  const getPriorityLabel = (priority: ContactPriority) => {
    if (priority === 'low') return t('myMessages.priorityLow');
    if (priority === 'high') return t('myMessages.priorityHigh');
    return t('myMessages.priorityNormal');
  };

  const getCategoryLabel = (category: ContactCategory) => {
    if (category === 'support') return t('myMessages.categorySupport');
    if (category === 'battle') return t('myMessages.categoryBattle');
    if (category === 'payment') return t('myMessages.categoryPayment');
    if (category === 'partnership') return t('myMessages.categoryPartnership');
    return t('myMessages.categoryOther');
  };

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from(contactMessagesSource)
      .select('id, created_at, subject, category, status, priority, message')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error loading contact messages for dashboard:', error);
      toast.error(t('myMessages.loadError'));
      setRows([]);
      setIsLoading(false);
      return;
    }

    const parsedRows = ((data as unknown[]) ?? [])
      .map((row) => parseMessageRow(row))
      .filter((row): row is MyMessageRow => row !== null);

    setRows(parsedRows);
    setIsLoading(false);
  }, [t]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const hasMessages = useMemo(() => rows.length > 0, [rows]);

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white inline-flex items-center gap-2">
            <MessageSquareText className="w-6 h-6 text-rose-400" />
            {t('myMessages.title')}
          </h1>
          <p className="text-zinc-400">{t('myMessages.subtitle')}</p>
        </div>

        <Card className="p-0 overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-zinc-400">{t('common.loading')}</div>
          ) : !hasMessages ? (
            <div className="p-6 text-zinc-500">{t('myMessages.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-zinc-900/90 text-zinc-400">
                  <tr>
                    <th className="text-left p-3 font-medium">{t('common.date')}</th>
                    <th className="text-left p-3 font-medium">{t('common.subject')}</th>
                    <th className="text-left p-3 font-medium">{t('common.category')}</th>
                    <th className="text-left p-3 font-medium">{t('common.status')}</th>
                    <th className="text-left p-3 font-medium">{t('common.priority')}</th>
                    <th className="text-right p-3 font-medium">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-800 text-zinc-200">
                      <td className="p-3 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                      <td className="p-3">{row.subject}</td>
                      <td className="p-3 whitespace-nowrap">{getCategoryLabel(row.category)}</td>
                      <td className="p-3 whitespace-nowrap">{getStatusLabel(row.status)}</td>
                      <td className="p-3 whitespace-nowrap">{getPriorityLabel(row.priority)}</td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedMessage(row)}>
                          {t('myMessages.viewDetails')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        isOpen={Boolean(selectedMessage)}
        onClose={() => setSelectedMessage(null)}
        title={selectedMessage?.subject || t('myMessages.detailsTitle')}
        description={selectedMessage ? t('myMessages.sentAt', { date: formatDateTime(selectedMessage.created_at) }) : undefined}
        size="lg"
      >
        {selectedMessage && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              {t('common.category')}: <span className="text-zinc-200">{getCategoryLabel(selectedMessage.category)}</span>
              {' · '}
              {t('common.status')}: <span className="text-zinc-200">{getStatusLabel(selectedMessage.status)}</span>
              {' · '}
              {t('common.priority')}: <span className="text-zinc-200">{getPriorityLabel(selectedMessage.priority)}</span>
            </p>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 whitespace-pre-wrap text-zinc-200 text-sm">
              {selectedMessage.message}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
