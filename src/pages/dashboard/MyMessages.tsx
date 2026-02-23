import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase/client';
import type { Database } from '../../lib/supabase/types';

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

const categoryLabel: Record<ContactCategory, string> = {
  support: 'Support',
  battle: 'Battle',
  payment: 'Paiement',
  partnership: 'Partenariat',
  other: 'Autre',
};

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

  if (!(category in categoryLabel) || !(status in statusLabel) || !(priority in priorityLabel)) {
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
  const [rows, setRows] = useState<MyMessageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<MyMessageRow | null>(null);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from(contactMessagesSource)
      .select('id, created_at, subject, category, status, priority, message')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error loading contact messages for dashboard:', error);
      toast.error('Impossible de charger vos messages.');
      setRows([]);
      setIsLoading(false);
      return;
    }

    const parsedRows = ((data as unknown[]) ?? [])
      .map((row) => parseMessageRow(row))
      .filter((row): row is MyMessageRow => row !== null);

    setRows(parsedRows);
    setIsLoading(false);
  }, []);

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
            Mes messages
          </h1>
          <p className="text-zinc-400">Suivi de vos demandes envoyées au support.</p>
        </div>

        <Card className="p-0 overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-zinc-400">Chargement...</div>
          ) : !hasMessages ? (
            <div className="p-6 text-zinc-500">Aucun message envoyé pour le moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-zinc-900/90 text-zinc-400">
                  <tr>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Sujet</th>
                    <th className="text-left p-3 font-medium">Catégorie</th>
                    <th className="text-left p-3 font-medium">Statut</th>
                    <th className="text-left p-3 font-medium">Priorité</th>
                    <th className="text-right p-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-800 text-zinc-200">
                      <td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="p-3">{row.subject}</td>
                      <td className="p-3 whitespace-nowrap">{categoryLabel[row.category]}</td>
                      <td className="p-3 whitespace-nowrap">{statusLabel[row.status]}</td>
                      <td className="p-3 whitespace-nowrap">{priorityLabel[row.priority]}</td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedMessage(row)}>
                          Voir détail
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
        title={selectedMessage?.subject || 'Détail message'}
        description={selectedMessage ? `Envoyé le ${new Date(selectedMessage.created_at).toLocaleString()}` : undefined}
        size="lg"
      >
        {selectedMessage && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Catégorie: <span className="text-zinc-200">{categoryLabel[selectedMessage.category]}</span>
              {' · '}
              Statut: <span className="text-zinc-200">{statusLabel[selectedMessage.status]}</span>
              {' · '}
              Priorité: <span className="text-zinc-200">{priorityLabel[selectedMessage.priority]}</span>
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
