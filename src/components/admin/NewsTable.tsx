import { Edit3, Mail, Trash2, Video } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useTranslation } from '../../lib/i18n';
import { formatDateTime } from '../../lib/utils/format';

export interface AdminNewsVideoRow {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  is_published: boolean;
  broadcast_email: boolean;
  broadcast_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface NewsTableProps {
  rows: AdminNewsVideoRow[];
  onEdit: (row: AdminNewsVideoRow) => void;
  onDelete: (row: AdminNewsVideoRow) => void;
  onBroadcast: (row: AdminNewsVideoRow) => void;
  deletingId: string | null;
  broadcastingId: string | null;
}

export function NewsTable({
  rows,
  onEdit,
  onDelete,
  onBroadcast,
  deletingId,
  broadcastingId,
}: NewsTableProps) {
  const { t } = useTranslation();

  const formatDate = (value: string | null) => {
    if (!value) return t('common.notAvailable');
    return formatDateTime(value);
  };

  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-zinc-700 rounded-xl p-8 text-center">
        <p className="text-zinc-400">{t('admin.news.table.empty')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-zinc-800 rounded-xl">
      <table className="w-full min-w-[920px]">
        <thead className="bg-zinc-900/80">
          <tr className="text-left text-xs uppercase tracking-[0.08em] text-zinc-500">
            <th className="px-4 py-3">{t('admin.news.table.title')}</th>
            <th className="px-4 py-3">{t('admin.news.table.publication')}</th>
            <th className="px-4 py-3">{t('admin.news.table.broadcast')}</th>
            <th className="px-4 py-3">{t('admin.news.table.createdAt')}</th>
            <th className="px-4 py-3">{t('admin.news.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const canBroadcast = row.is_published && !row.broadcast_sent_at;
            return (
              <tr key={row.id} className="border-t border-zinc-800">
                <td className="px-4 py-3 align-top">
                  <div className="flex items-start gap-2">
                    <Video className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-white font-medium truncate">{row.title}</p>
                      <p className="text-zinc-500 text-xs truncate mt-1">{row.video_url}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <Badge variant={row.is_published ? 'success' : 'default'}>
                    {row.is_published ? t('producer.published') : t('producer.draft')}
                  </Badge>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="space-y-1">
                    <Badge variant={row.broadcast_email ? 'warning' : 'default'}>
                      {row.broadcast_email ? t('admin.news.table.autoBroadcastOn') : t('admin.news.table.autoBroadcastOff')}
                    </Badge>
                    <p className="text-xs text-zinc-500">
                      {t('admin.news.table.sentAt')}: {formatDate(row.broadcast_sent_at)}
                    </p>
                    {canBroadcast && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1"
                        leftIcon={<Mail className="w-3.5 h-3.5" />}
                        onClick={() => onBroadcast(row)}
                        isLoading={broadcastingId === row.id}
                      >
                        {t('admin.news.table.broadcastNow')}
                      </Button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-zinc-400 text-sm">
                  {formatDate(row.created_at)}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                      onClick={() => onEdit(row)}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300"
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      onClick={() => onDelete(row)}
                      isLoading={deletingId === row.id}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
