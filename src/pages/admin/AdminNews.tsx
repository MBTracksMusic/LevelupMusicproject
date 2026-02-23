import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { supabase } from '../../lib/supabase/client';
import type { Database } from '../../lib/supabase/types';
import { NewsForm, type NewsFormValues } from '../../components/admin/NewsForm';
import { NewsTable, type AdminNewsVideoRow } from '../../components/admin/NewsTable';

type NewsRow = AdminNewsVideoRow;

type BroadcastResult = {
  status?: string;
  reason?: string;
  sent?: number;
  total?: number;
};

const newsVideosSource = 'news_videos' as unknown as keyof Database['public']['Tables'];

function asString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function parseNewsRow(row: unknown): NewsRow | null {
  if (!row || typeof row !== 'object') return null;
  const source = row as Record<string, unknown>;

  const id = asString(source.id);
  const title = asString(source.title);
  const videoUrl = asString(source.video_url);
  const createdAt = asString(source.created_at);
  const updatedAt = asString(source.updated_at);
  if (!id || !title || !videoUrl || !createdAt || !updatedAt) return null;

  return {
    id,
    title,
    description: asString(source.description),
    video_url: videoUrl,
    thumbnail_url: asString(source.thumbnail_url),
    is_published: source.is_published === true,
    broadcast_email: source.broadcast_email === true,
    broadcast_sent_at: asString(source.broadcast_sent_at),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function AdminNewsPage() {
  const [rows, setRows] = useState<NewsRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<NewsRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [broadcastingId, setBroadcastingId] = useState<string | null>(null);
  const [confirmBroadcastRow, setConfirmBroadcastRow] = useState<NewsRow | null>(null);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [rows],
  );

  const loadNews = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from(newsVideosSource)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading news videos:', error);
      toast.error('Impossible de charger les news vidéos.');
      setRows([]);
      setIsLoading(false);
      return;
    }

    const parsed = ((data as unknown[]) ?? [])
      .map((row) => parseNewsRow(row))
      .filter((row): row is NewsRow => row !== null);

    setRows(parsed);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadNews();
  }, [loadNews]);

  const closeFormModal = () => {
    if (isSubmitting) return;
    setIsModalOpen(false);
    setEditingRow(null);
  };

  const invokeBroadcast = useCallback(
    async (row: NewsRow, options?: { silentSuccess?: boolean }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('broadcast-news', {
        body: { news_id: row.id },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      if (error) {
        const payload = data as { error?: string } | null;
        const message = payload?.error || error.message || 'Diffusion impossible.';
        throw new Error(message);
      }

      const payload = (data as BroadcastResult | null) ?? null;
      if (payload?.status === 'already_sent') {
        if (!options?.silentSuccess) {
          toast('Cette news a déjà été diffusée.');
        }
      } else if (payload?.status === 'partial') {
        toast.error(
          `Diffusion partielle (${payload.sent ?? 0}/${payload.total ?? 0}). Relancer pour terminer.`,
        );
      } else if (!options?.silentSuccess) {
        toast.success('Diffusion email déclenchée.');
      }

      return payload;
    },
    [],
  );

  const handleCreate = () => {
    setEditingRow(null);
    setIsModalOpen(true);
  };

  const handleEdit = (row: NewsRow) => {
    setEditingRow(row);
    setIsModalOpen(true);
  };

  const handleDelete = async (row: NewsRow) => {
    const confirmed = window.confirm(`Supprimer la news "${row.title}" ?`);
    if (!confirmed) return;

    setDeletingId(row.id);
    const { error } = await supabase.from(newsVideosSource).delete().eq('id', row.id);

    if (error) {
      console.error('Error deleting news video:', error);
      toast.error('Suppression impossible.');
      setDeletingId(null);
      return;
    }

    toast.success('News supprimée.');
    setRows((prev) => prev.filter((item) => item.id !== row.id));
    setDeletingId(null);
  };

  const handleSave = async (values: NewsFormValues) => {
    setIsSubmitting(true);

    const payload = {
      title: values.title,
      description: values.description || null,
      video_url: values.video_url,
      thumbnail_url: values.thumbnail_url || null,
      is_published: values.is_published,
      broadcast_email: values.broadcast_email,
    };

    const wasPublishedBeforeEdit = editingRow?.is_published === true;
    const becamePublished = values.is_published && !wasPublishedBeforeEdit;

    const query = editingRow
      ? supabase.from(newsVideosSource).update(payload).eq('id', editingRow.id)
      : supabase.from(newsVideosSource).insert(payload);

    const { data, error } = await query.select('*').single();

    if (error) {
      console.error('Error saving news video:', error);
      toast.error('Enregistrement impossible.');
      setIsSubmitting(false);
      return;
    }

    const parsed = parseNewsRow(data);
    if (!parsed) {
      toast.error('Réponse serveur invalide.');
      setIsSubmitting(false);
      return;
    }

    setRows((prev) => {
      if (!editingRow) {
        return [parsed, ...prev];
      }
      return prev.map((item) => (item.id === parsed.id ? parsed : item));
    });

    toast.success(editingRow ? 'News mise à jour.' : 'News créée.');
    setIsSubmitting(false);
    setIsModalOpen(false);
    setEditingRow(null);

    const shouldAutoBroadcast =
      values.broadcast_email &&
      values.is_published &&
      !parsed.broadcast_sent_at &&
      (!editingRow || becamePublished);

    if (shouldAutoBroadcast) {
      setBroadcastingId(parsed.id);
      try {
        await invokeBroadcast(parsed, { silentSuccess: true });
      } catch (broadcastError) {
        console.error('Auto broadcast error:', broadcastError);
        toast.error((broadcastError as Error).message || 'Diffusion automatique impossible.');
      } finally {
        setBroadcastingId(null);
        await loadNews();
      }
    }
  };

  const requestBroadcast = (row: NewsRow) => {
    setConfirmBroadcastRow(row);
  };

  const confirmBroadcast = async () => {
    const row = confirmBroadcastRow;
    if (!row) return;

    setBroadcastingId(row.id);
    try {
      await invokeBroadcast(row);
    } catch (error) {
      console.error('Broadcast error:', error);
      toast.error((error as Error).message || 'Diffusion impossible.');
    } finally {
      setConfirmBroadcastRow(null);
      setBroadcastingId(null);
      await loadNews();
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">News vidéos</h2>
            <p className="text-zinc-400 text-sm mt-1">
              Gestion des annonces affichées sur la homepage.
            </p>
          </div>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={handleCreate}>
            Nouvelle news
          </Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-zinc-400">Chargement...</div>
        ) : (
          <NewsTable
            rows={sortedRows}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onBroadcast={requestBroadcast}
            deletingId={deletingId}
            broadcastingId={broadcastingId}
          />
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={closeFormModal}
        title={editingRow ? 'Modifier la news vidéo' : 'Créer une news vidéo'}
        size="lg"
      >
        <NewsForm
          mode={editingRow ? 'edit' : 'create'}
          initialValues={
            editingRow
              ? {
                  title: editingRow.title,
                  description: editingRow.description ?? '',
                  video_url: editingRow.video_url,
                  thumbnail_url: editingRow.thumbnail_url ?? '',
                  is_published: editingRow.is_published,
                  broadcast_email: editingRow.broadcast_email,
                }
              : undefined
          }
          isSubmitting={isSubmitting}
          onSubmit={handleSave}
          onCancel={closeFormModal}
        />
      </Modal>

      <Modal
        isOpen={Boolean(confirmBroadcastRow)}
        onClose={() => setConfirmBroadcastRow(null)}
        title="Confirmer la diffusion"
        description="Cette action enverra un email à tous les abonnés éligibles."
        size="md"
      >
        <div className="space-y-4">
          <p className="text-zinc-300 text-sm">
            News: <span className="text-white font-medium">{confirmBroadcastRow?.title}</span>
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmBroadcastRow(null)}
              disabled={Boolean(broadcastingId)}
            >
              Annuler
            </Button>
            <Button onClick={confirmBroadcast} isLoading={Boolean(broadcastingId)}>
              Confirmer la diffusion
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
