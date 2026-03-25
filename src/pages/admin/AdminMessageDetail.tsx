import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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

interface AdminMessageDetailRow {
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

interface MessageReplyRow {
  id: string;
  message_id: string;
  admin_id: string | null;
  reply: string;
  created_at: string;
}

interface AdminProfileSummary {
  id: string;
  username: string | null;
  email: string | null;
}

interface AdminReplyResponse {
  ok?: boolean;
  reply_id?: string;
  status?: ContactStatus;
  error?: string;
}

const contactMessagesSource = 'contact_messages' as unknown as keyof Database['public']['Tables'];
const messageRepliesSource = 'message_replies' as unknown as keyof Database['public']['Tables'];
const userProfilesSource = 'user_profiles' as unknown as keyof Database['public']['Tables'];

const asNonEmptyString = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);

const parseDetailRow = (row: unknown): AdminMessageDetailRow | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const id = asNonEmptyString(source.id);
  const createdAt = asNonEmptyString(source.created_at);
  const subject = asNonEmptyString(source.subject);
  const message = asNonEmptyString(source.message);
  const category = asNonEmptyString(source.category) as ContactCategory | null;
  const status = asNonEmptyString(source.status) as ContactStatus | null;
  const priority = asNonEmptyString(source.priority) as ContactPriority | null;

  if (!id || !createdAt || !subject || !message || !category || !status || !priority) return null;
  if (!['support', 'battle', 'payment', 'partnership', 'other'].includes(category)) return null;
  if (!['new', 'in_progress', 'closed'].includes(status)) return null;
  if (!['low', 'normal', 'high'].includes(priority)) return null;

  return {
    id,
    created_at: createdAt,
    user_id: asNonEmptyString(source.user_id),
    name: asNonEmptyString(source.name),
    email: asNonEmptyString(source.email),
    subject,
    category,
    message,
    status,
    priority,
    origin_page: asNonEmptyString(source.origin_page),
  };
};

const parseReplyRow = (row: unknown): MessageReplyRow | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const id = asNonEmptyString(source.id);
  const messageId = asNonEmptyString(source.message_id);
  const reply = asNonEmptyString(source.reply);
  const createdAt = asNonEmptyString(source.created_at);
  if (!id || !messageId || !reply || !createdAt) return null;

  return {
    id,
    message_id: messageId,
    admin_id: asNonEmptyString(source.admin_id),
    reply,
    created_at: createdAt,
  };
};

const parseAdminProfile = (row: unknown): AdminProfileSummary | null => {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;
  const id = asNonEmptyString(source.id);
  if (!id) return null;
  return {
    id,
    username: asNonEmptyString(source.username),
    email: asNonEmptyString(source.email),
  };
};

export function AdminMessageDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [message, setMessage] = useState<AdminMessageDetailRow | null>(null);
  const [replies, setReplies] = useState<MessageReplyRow[]>([]);
  const [adminProfiles, setAdminProfiles] = useState<Record<string, AdminProfileSummary>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<ContactStatus>('in_progress');

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

  const loadMessageDetail = useCallback(async () => {
    if (!id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data: messageData, error: messageError } = await supabase
      .from(contactMessagesSource)
      .select('id, created_at, user_id, name, email, subject, category, message, status, priority, origin_page')
      .eq('id', id)
      .maybeSingle();

    if (messageError) {
      console.error('Error loading admin message detail:', messageError);
      toast.error(t('admin.messages.loadError'));
      setMessage(null);
      setReplies([]);
      setIsLoading(false);
      return;
    }

    const parsedMessage = parseDetailRow(messageData);
    if (!parsedMessage) {
      setMessage(null);
      setReplies([]);
      setIsLoading(false);
      return;
    }

    const { data: repliesData, error: repliesError } = await supabase
      .from(messageRepliesSource)
      .select('id, message_id, admin_id, reply, created_at')
      .eq('message_id', parsedMessage.id)
      .order('created_at', { ascending: true });

    if (repliesError) {
      console.error('Error loading message replies:', repliesError);
      toast.error(t('admin.messages.loadError'));
      setMessage(parsedMessage);
      setReplies([]);
      setAdminProfiles({});
      setReplyStatus(parsedMessage.status);
      setIsLoading(false);
      return;
    }

    const parsedReplies = ((repliesData as unknown[]) ?? [])
      .map((row) => parseReplyRow(row))
      .filter((row): row is MessageReplyRow => row !== null);

    const adminIds = Array.from(new Set(parsedReplies
      .map((row) => row.admin_id)
      .filter((value): value is string => Boolean(value))));

    const profilesMap: Record<string, AdminProfileSummary> = {};
    if (adminIds.length > 0) {
      const { data: profileData, error: profileError } = await supabase
        .from(userProfilesSource)
        .select('id, username, email')
        .in('id', adminIds);

      if (profileError) {
        console.error('Error loading admin profile summaries:', profileError);
      } else {
        for (const row of (profileData as unknown[]) ?? []) {
          const parsed = parseAdminProfile(row);
          if (parsed) {
            profilesMap[parsed.id] = parsed;
          }
        }
      }
    }

    setMessage(parsedMessage);
    setReplies(parsedReplies);
    setAdminProfiles(profilesMap);
    setReplyStatus(parsedMessage.status);
    setIsLoading(false);
  }, [id, t]);

  useEffect(() => {
    void loadMessageDetail();
  }, [loadMessageDetail]);

  const updateStatus = async (nextStatus: ContactStatus) => {
    if (!message || isUpdatingStatus || message.status === nextStatus) return;
    setIsUpdatingStatus(true);

    const { data, error } = await supabase
      .from(contactMessagesSource)
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', message.id)
      .select('id, created_at, user_id, name, email, subject, category, message, status, priority, origin_page')
      .maybeSingle();

    if (error) {
      console.error('Error updating contact message status:', error);
      toast.error(t('admin.messages.updateError'));
      setIsUpdatingStatus(false);
      return;
    }

    const parsed = parseDetailRow(data);
    if (!parsed) {
      toast.error(t('admin.messages.invalidResponse'));
      setIsUpdatingStatus(false);
      return;
    }

    setMessage(parsed);
    setReplyStatus(parsed.status);
    toast.success(t('admin.messages.updateSuccess'));
    setIsUpdatingStatus(false);
  };

  const handleReplySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message || isSubmittingReply) return;

    const normalizedReply = replyText.trim();
    if (normalizedReply.length < 3) {
      toast.error(t('admin.messages.invalidResponse'));
      return;
    }

    setIsSubmittingReply(true);

    try {
      const { data, error } = await invokeWithAuth<AdminReplyResponse>('admin-reply-contact-message', {
        message_id: message.id,
        reply: normalizedReply,
        status: replyStatus,
      });

      if (error) {
        console.error('Error sending admin reply:', error);
        toast.error(data?.error || error.message || t('admin.messages.updateError'));
        return;
      }

      if (data?.ok !== true) {
        toast.error(data?.error || t('admin.messages.invalidResponse'));
        return;
      }

      toast.success(t('common.save'));
      setReplyText('');
      await loadMessageDetail();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('admin.messages.updateError');
      console.error('Error sending admin reply:', err);
      toast.error(errorMsg);
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleDeleteMessage = async () => {
    if (!message || isDeletingMessage) return;

    const confirmed = window.confirm(
      t('admin.messages.deleteConfirm', { subject: message.subject }),
    );
    if (!confirmed) return;

    setIsDeletingMessage(true);
    const { error } = await supabase
      .from(contactMessagesSource)
      .delete()
      .eq('id', message.id);

    if (error) {
      console.error('Error deleting admin contact message:', error);
      toast.error(t('admin.messages.deleteError'));
      setIsDeletingMessage(false);
      return;
    }

    toast.success(t('admin.messages.deleteSuccess'));
    setIsDeletingMessage(false);
    navigate(backPath);
  };

  const backPath = '/admin/messages';
  const hasMessage = useMemo(() => Boolean(message), [message]);

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-white">{t('admin.messages.title')}</h2>
            <p className="text-zinc-400 text-sm">{message?.subject || t('common.loading')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(backPath)}>
              {t('common.back')}
            </Button>
            <Link to={backPath} className="text-sm text-zinc-400 hover:text-white">
              {t('admin.messages.subtitle')}
            </Link>
          </div>
        </div>
      </Card>

      {!id ? (
        <Card className="p-6 text-zinc-400">Message introuvable.</Card>
      ) : isLoading ? (
        <Card className="p-6 text-zinc-400">{t('common.loading')}</Card>
      ) : !hasMessage ? (
        <Card className="p-6 text-zinc-400">Message introuvable.</Card>
      ) : (
        <>
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <p className="text-zinc-300"><span className="text-zinc-500">{t('admin.messages.contact')}:</span> {message?.name || t('admin.messages.anonymous')}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('common.email')}:</span> {message?.email || t('common.notAvailable')}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('common.subject')}:</span> {message?.subject}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('common.category')}:</span> {message ? getCategoryLabel(message.category) : '-'}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('admin.messages.origin')}:</span> {message?.origin_page || t('common.notAvailable')}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('common.date')}:</span> {message ? formatDateTime(message.created_at) : '-'}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('common.status')}:</span> {message ? getStatusLabel(message.status) : '-'}</p>
              <p className="text-zinc-300"><span className="text-zinc-500">{t('common.priority')}:</span> {message ? getPriorityLabel(message.priority) : '-'}</p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">{t('common.message')}</p>
              <p className="whitespace-pre-wrap text-sm text-zinc-200">{message?.message}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                isLoading={isUpdatingStatus}
                disabled={!message || isUpdatingStatus || message.status === 'in_progress'}
                onClick={() => void updateStatus('in_progress')}
              >
                En cours
              </Button>
              <Button
                type="button"
                variant="outline"
                isLoading={isUpdatingStatus}
                disabled={!message || isUpdatingStatus || isDeletingMessage || message.status === 'closed'}
                onClick={() => void updateStatus('closed')}
              >
                Resolu
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={isDeletingMessage}
                disabled={!message || isUpdatingStatus || isSubmittingReply || isDeletingMessage}
                onClick={() => void handleDeleteMessage()}
              >
                {t('common.delete')}
              </Button>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <h3 className="text-lg font-semibold text-white">Historique des reponses</h3>
            {replies.length === 0 ? (
              <p className="text-sm text-zinc-500">Aucune reponse pour le moment.</p>
            ) : (
              <div className="space-y-3">
                {replies.map((row) => {
                  const profile = row.admin_id ? adminProfiles[row.admin_id] : null;
                  const adminLabel = profile?.username || profile?.email || row.admin_id || 'admin';
                  return (
                    <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 space-y-2">
                      <p className="text-xs text-zinc-500">
                        {adminLabel} • {formatDateTime(row.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-zinc-200">{row.reply}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <h3 className="text-lg font-semibold text-white">Repondre</h3>
            <form className="space-y-3" onSubmit={handleReplySubmit}>
              <textarea
                className="w-full min-h-[140px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100"
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Ecrivez une reponse a l'utilisateur..."
                disabled={isSubmittingReply}
              />
              <div className="flex flex-wrap items-center gap-3">
                <select
                  className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
                  value={replyStatus}
                  onChange={(event) => setReplyStatus(event.target.value as ContactStatus)}
                  disabled={isSubmittingReply}
                >
                  <option value="new">Nouveau</option>
                  <option value="in_progress">En cours</option>
                  <option value="closed">Resolu</option>
                </select>
                <Button type="submit" isLoading={isSubmittingReply} disabled={isSubmittingReply || replyText.trim().length < 3}>
                  Envoyer la reponse
                </Button>
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
