import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
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

interface MessageReplyRow {
  id: string;
  message_id: string;
  reply: string;
  created_at: string;
}

const contactMessagesSource = 'contact_messages' as unknown as keyof Database['public']['Tables'];
const messageRepliesSource = 'message_replies' as unknown as keyof Database['public']['Tables'];

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

const parseReplyRow = (row: unknown): MessageReplyRow | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const id = asNonEmptyString(source.id);
  const messageId = asNonEmptyString(source.message_id);
  const reply = asNonEmptyString(source.reply);
  const createdAt = asNonEmptyString(source.created_at);

  if (!id || !messageId || !reply || !createdAt) {
    return null;
  }

  return {
    id,
    message_id: messageId,
    reply,
    created_at: createdAt,
  };
};

export function MyMessagesPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MyMessageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<MyMessageRow | null>(null);
  const [replies, setReplies] = useState<MessageReplyRow[]>([]);
  const [isRepliesLoading, setIsRepliesLoading] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

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
  const hasReplies = useMemo(() => replies.length > 0, [replies]);

  const loadReplies = useCallback(async (messageId: string) => {
    setIsRepliesLoading(true);
    const { data, error } = await supabase
      .from(messageRepliesSource)
      .select('id, message_id, reply, created_at')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading message replies for user dashboard:', error);
      setReplies([]);
      setIsRepliesLoading(false);
      return;
    }

    const parsedReplies = ((data as unknown[]) ?? [])
      .map((row) => parseReplyRow(row))
      .filter((row): row is MessageReplyRow => row !== null);

    setReplies(parsedReplies);
    setIsRepliesLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedMessage?.id) {
      setReplies([]);
      setIsRepliesLoading(false);
      return;
    }
    void loadReplies(selectedMessage.id);
  }, [selectedMessage?.id, loadReplies]);

  const handleDeleteMessage = async (row: MyMessageRow) => {
    if (deletingMessageId !== null) return;
    if (row.status !== 'closed') {
      toast.error(t('myMessages.deleteClosedOnly'));
      return;
    }

    const confirmed = window.confirm(
      t('myMessages.deleteConfirm', { subject: row.subject }),
    );
    if (!confirmed) return;

    setDeletingMessageId(row.id);

    const { error } = await supabase
      .from(contactMessagesSource)
      .delete()
      .eq('id', row.id)
      .eq('status', 'closed');

    if (error) {
      console.error('Error deleting own contact message:', error);
      toast.error(t('myMessages.deleteError'));
      setDeletingMessageId(null);
      return;
    }

    setRows((prev) => prev.filter((item) => item.id !== row.id));
    if (selectedMessage?.id === row.id) {
      setSelectedMessage(null);
    }
    setReplies([]);
    toast.success(t('myMessages.deleteSuccess'));
    setDeletingMessageId(null);
  };

  const getStatusBadgeClassName = (status: ContactStatus) => {
    if (status === 'closed') return 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300';
    if (status === 'in_progress') return 'border-amber-600/40 bg-amber-500/10 text-amber-300';
    return 'border-sky-600/40 bg-sky-500/10 text-sky-300';
  };

  const getPriorityBadgeClassName = (priority: ContactPriority) => {
    if (priority === 'high') return 'border-rose-600/40 bg-rose-500/10 text-rose-300';
    if (priority === 'low') return 'border-zinc-600/40 bg-zinc-500/10 text-zinc-300';
    return 'border-violet-600/40 bg-violet-500/10 text-violet-300';
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
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
              <table className="w-full min-w-[920px] text-sm">
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
                    <tr key={row.id} className="border-t border-zinc-800 text-zinc-200 hover:bg-zinc-900/40">
                      <td className="p-3 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                      <td className="p-3 font-medium">{row.subject}</td>
                      <td className="p-3 whitespace-nowrap">{getCategoryLabel(row.category)}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${getStatusBadgeClassName(row.status)}`}>
                          {getStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${getPriorityBadgeClassName(row.priority)}`}>
                          {getPriorityLabel(row.priority)}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={deletingMessageId !== null}
                            onClick={() => setSelectedMessage(row)}
                          >
                            {t('myMessages.viewDetails')}
                          </Button>
                          {row.status === 'closed' && (
                            <Button
                              size="sm"
                              variant="danger"
                              isLoading={deletingMessageId === row.id}
                              disabled={deletingMessageId !== null}
                              onClick={() => void handleDeleteMessage(row)}
                            >
                              {t('common.delete')}
                            </Button>
                          )}
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

      <Modal
        isOpen={Boolean(selectedMessage)}
        onClose={() => setSelectedMessage(null)}
        title={selectedMessage?.subject || t('myMessages.detailsTitle')}
        description={selectedMessage ? t('myMessages.sentAt', { date: formatDateTime(selectedMessage.created_at) }) : undefined}
        size="lg"
      >
        {selectedMessage && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-400">{t('common.category')}:</span>
              <span className="rounded-full border border-zinc-700 bg-zinc-800/70 px-2 py-1 text-xs font-medium text-zinc-200">
                {getCategoryLabel(selectedMessage.category)}
              </span>
              <span className={`rounded-full border px-2 py-1 text-xs font-medium ${getStatusBadgeClassName(selectedMessage.status)}`}>
                {getStatusLabel(selectedMessage.status)}
              </span>
              <span className={`rounded-full border px-2 py-1 text-xs font-medium ${getPriorityBadgeClassName(selectedMessage.priority)}`}>
                {getPriorityLabel(selectedMessage.priority)}
              </span>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t('myMessages.conversationTitle')}</p>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                <p className="mb-1 text-xs text-zinc-500">
                  {t('myMessages.youLabel')} · {formatDateTime(selectedMessage.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">
                  {selectedMessage.message}
                </p>
              </div>

              {isRepliesLoading ? (
                <p className="text-sm text-zinc-500">{t('common.loading')}</p>
              ) : hasReplies ? (
                <div className="space-y-3">
                  {replies.map((reply) => (
                    <div key={reply.id} className="rounded-lg border border-emerald-700/30 bg-emerald-500/5 p-3">
                      <p className="mb-1 text-xs text-emerald-300/80">
                        {t('myMessages.supportLabel')} · {formatDateTime(reply.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">
                        {reply.reply}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">{t('myMessages.noSupportReply')}</p>
              )}
            </div>

            <div className="flex justify-end">
              {selectedMessage.status === 'closed' && (
                <Button
                  type="button"
                  variant="danger"
                  isLoading={deletingMessageId === selectedMessage.id}
                  disabled={deletingMessageId !== null}
                  onClick={() => void handleDeleteMessage(selectedMessage)}
                >
                  {t('common.delete')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
