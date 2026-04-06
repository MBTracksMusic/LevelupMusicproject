import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useMaintenanceModeContext } from '@/lib/supabase/MaintenanceModeContext';
import type { SiteAccessMode } from '@/lib/supabase/useMaintenanceMode';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaitlistRow {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'rejected';
  source: string;
  created_at: string;
  accepted_at: string | null;
  user_id: string | null;
  notes: string | null;
}

interface WhitelistRow {
  id: string;
  email: string;
  user_id: string | null;
  granted_at: string;
  note: string | null;
  is_active: boolean;
}

type WaitlistTab = 'pending' | 'accepted' | 'rejected';

const ACCESS_MODE_OPTIONS: { value: SiteAccessMode; label: string }[] = [
  { value: 'private', label: '🔒 Privé — whitelist uniquement' },
  { value: 'controlled', label: '🟡 Contrôlé — whitelist + waitlist acceptés' },
  { value: 'public', label: '🟢 Public — ouverture totale' },
];

const ACCESS_MODE_DESCRIPTIONS: Record<SiteAccessMode, string> = {
  private:
    'Seuls les emails présents dans la whitelist ont accès. Tous les autres voient la page de lancement.',
  controlled:
    'La whitelist a accès complet. Les personnes acceptées en waitlist ont également accès. Les autres voient la page de lancement ou l\'écran d\'attente.',
  public:
    'Tout le monde a accès à la plateforme. Le système whitelist/waitlist reste actif pour les futures campagnes.',
};

// ─── Section: Phase de lancement ─────────────────────────────────────────────

function LaunchPhaseCard() {
  const {
    siteAccessMode,
    launchMessagePublic,
    launchMessageWaitlistPending,
    launchMessageWhitelist,
    isLoading: isSettingsLoading,
    updateSettings,
  } = useMaintenanceModeContext();

  const [mode, setMode] = useState<SiteAccessMode>(siteAccessMode);
  const [msgPublic, setMsgPublic] = useState(launchMessagePublic ?? '');
  const [msgPending, setMsgPending] = useState(launchMessageWaitlistPending ?? '');
  const [msgWhitelist, setMsgWhitelist] = useState(launchMessageWhitelist ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Sync when Realtime pushes an update
  useEffect(() => { setMode(siteAccessMode); }, [siteAccessMode]);
  useEffect(() => { setMsgPublic(launchMessagePublic ?? ''); }, [launchMessagePublic]);
  useEffect(() => { setMsgPending(launchMessageWaitlistPending ?? ''); }, [launchMessageWaitlistPending]);
  useEffect(() => { setMsgWhitelist(launchMessageWhitelist ?? ''); }, [launchMessageWhitelist]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isSettingsLoading) return;

    setIsSaving(true);
    try {
      await updateSettings({
        site_access_mode: mode,
        launch_message_public: msgPublic.trim() || null,
        launch_message_waitlist_pending: msgPending.trim() || null,
        launch_message_whitelist: msgWhitelist.trim() || null,
      } as Parameters<typeof updateSettings>[0]);
      toast.success('Paramètres de lancement sauvegardés.');
    } catch (err) {
      console.error('[AdminLaunch] save error', err);
      toast.error('Erreur lors de la sauvegarde.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-6 border-zinc-800">
      <h2 className="text-xl font-semibold text-white">Phase de lancement</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Source de vérité unique pour l&apos;accès au site.
      </p>

      <form onSubmit={handleSave} className="mt-6 space-y-5">
        {/* Mode selector */}
        <Select
          label="Mode d'accès"
          value={mode}
          onChange={(e) => setMode(e.target.value as SiteAccessMode)}
          options={ACCESS_MODE_OPTIONS}
          disabled={isSettingsLoading || isSaving}
        />

        {/* Description of current mode */}
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-400">
          {ACCESS_MODE_DESCRIPTIONS[mode]}
        </p>

        {/* Warning when switching to public */}
        {mode === 'public' && siteAccessMode !== 'public' && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            Vous êtes sur le point d&apos;ouvrir la plateforme au public. Cette action est
            visible immédiatement par tous les visiteurs.
          </div>
        )}

        {/* Dynamic messages */}
        <div className="space-y-3 border-t border-zinc-800 pt-5">
          <p className="text-sm font-medium text-zinc-300">Messages dynamiques</p>
          <p className="text-xs text-zinc-500">
            Laissez vide pour utiliser les messages par défaut.
          </p>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-400">
              Message public (visiteurs non inscrits)
            </label>
            <textarea
              value={msgPublic}
              onChange={(e) => setMsgPublic(e.target.value)}
              placeholder="Beatelion est en accès privé."
              rows={2}
              disabled={isSaving}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-400">
              Message waitlist en attente
            </label>
            <textarea
              value={msgPending}
              onChange={(e) => setMsgPending(e.target.value)}
              placeholder="Tu es sur la liste. Les accès s'ouvrent progressivement."
              rows={2}
              disabled={isSaving}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-400">
              Message whitelist (toast de bienvenue)
            </label>
            <textarea
              value={msgWhitelist}
              onChange={(e) => setMsgWhitelist(e.target.value)}
              placeholder="Bienvenue dans le cercle."
              rows={2}
              disabled={isSaving}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>

        <Button type="submit" isLoading={isSaving} disabled={isSettingsLoading || isSaving}>
          Sauvegarder
        </Button>
      </form>
    </Card>
  );
}

// ─── Section: Waitlist ────────────────────────────────────────────────────────

function WaitlistCard() {
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [tab, setTab] = useState<WaitlistTab>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('waitlist')
      .select('id, email, status, source, created_at, accepted_at, user_id, notes')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erreur chargement waitlist.');
      console.error('[AdminLaunch] waitlist load error', error);
    } else {
      setRows((data as WaitlistRow[]) ?? []);
    }
    setIsLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const updateStatus = async (id: string, status: 'accepted' | 'rejected') => {
    setActioningId(id);
    const patch =
      status === 'accepted'
        ? { status, accepted_at: new Date().toISOString() }
        : { status };

    const { error } = await supabase.from('waitlist').update(patch).eq('id', id);

    if (error) {
      toast.error('Erreur lors de la mise à jour.');
      console.error('[AdminLaunch] waitlist update error', error);
    } else {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, ...patch }
            : r,
        ),
      );
      toast.success(status === 'accepted' ? 'Accès accordé.' : 'Entrée refusée.');
    }
    setActioningId(null);
  };

  const filtered = rows.filter((r) => r.status === tab);
  const counts: Record<WaitlistTab, number> = {
    pending: rows.filter((r) => r.status === 'pending').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  };

  const TABS: { key: WaitlistTab; label: string }[] = [
    { key: 'pending', label: `En attente (${counts.pending})` },
    { key: 'accepted', label: `Acceptés (${counts.accepted})` },
    { key: 'rejected', label: `Refusés (${counts.rejected})` },
  ];

  return (
    <Card className="p-6 border-zinc-800">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Waitlist</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {rows.length} inscription{rows.length !== 1 ? 's' : ''} au total
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} isLoading={isLoading}>
          Rafraîchir
        </Button>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-2 border-b border-zinc-800 pb-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              'rounded-t px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'border-b-2 border-rose-500 text-white'
                : 'text-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-zinc-500">Chargement...</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            Aucune entrée {tab === 'pending' ? 'en attente' : tab === 'accepted' ? 'acceptée' : 'refusée'}.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">Date</th>
                {tab === 'pending' && <th className="pb-2">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filtered.map((row) => (
                <tr key={row.id} className="py-2">
                  <td className="py-2.5 pr-4 text-zinc-200">
                    {row.email}
                    {row.user_id && (
                      <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        compte lié
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-500">{row.source}</td>
                  <td className="py-2.5 pr-4 text-zinc-500">
                    {new Date(row.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  {tab === 'pending' && (
                    <td className="py-2.5">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          title="Accepter"
                          disabled={actioningId === row.id}
                          onClick={() => updateStatus(row.id, 'accepted')}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Refuser"
                          disabled={actioningId === row.id}
                          onClick={() => updateStatus(row.id, 'rejected')}
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ─── Section: Whitelist ───────────────────────────────────────────────────────

function WhitelistCard() {
  const [rows, setRows] = useState<WhitelistRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('access_whitelist')
      .select('id, email, user_id, granted_at, note, is_active')
      .order('granted_at', { ascending: false });

    if (error) {
      toast.error('Erreur chargement whitelist.');
      console.error('[AdminLaunch] whitelist load error', error);
    } else {
      setRows((data as WhitelistRow[]) ?? []);
    }
    setIsLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      toast.error('Email invalide.');
      return;
    }
    setIsAdding(true);

    const { data, error } = await supabase
      .from('access_whitelist')
      .insert({ email, note: newNote.trim() || null })
      .select('id, email, user_id, granted_at, note, is_active')
      .single();

    if (error) {
      if (error.code === '23505') {
        toast.error('Cet email est déjà dans la whitelist.');
      } else {
        toast.error('Erreur lors de l\'ajout.');
        console.error('[AdminLaunch] whitelist insert error', error);
      }
    } else {
      setRows((prev) => [data as WhitelistRow, ...prev]);
      setNewEmail('');
      setNewNote('');
      toast.success('Email ajouté à la whitelist.');
    }
    setIsAdding(false);
  };

  const toggleActive = async (row: WhitelistRow) => {
    setTogglingId(row.id);
    const { error } = await supabase
      .from('access_whitelist')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);

    if (error) {
      toast.error('Erreur lors de la mise à jour.');
    } else {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)),
      );
    }
    setTogglingId(null);
  };

  const activeRows = rows.filter((r) => r.is_active);
  const inactiveRows = rows.filter((r) => !r.is_active);

  return (
    <Card className="p-6 border-zinc-800">
      <h2 className="text-xl font-semibold text-white">Whitelist</h2>
      <p className="mt-1 text-sm text-zinc-400">
        {activeRows.length} email{activeRows.length !== 1 ? 's' : ''} actif
        {activeRows.length !== 1 ? 's' : ''} — accès complet indépendamment de la phase.
      </p>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="producteur@email.com"
            disabled={isAdding}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Note interne (optionnel)"
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Invitation DM Instagram"
            disabled={isAdding}
          />
        </div>
        <Button
          type="submit"
          isLoading={isAdding}
          leftIcon={<UserPlus className="h-4 w-4" />}
          className="shrink-0"
        >
          Ajouter
        </Button>
      </form>

      {/* Active entries */}
      <div className="mt-6 overflow-x-auto">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-zinc-500">Chargement...</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Aucun email dans la whitelist.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Note</th>
                <th className="pb-2 pr-4">Ajouté le</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {[...activeRows, ...inactiveRows].map((row) => (
                <tr key={row.id} className={row.is_active ? '' : 'opacity-40'}>
                  <td className="py-2.5 pr-4 text-zinc-200">
                    {row.email}
                    {row.user_id && (
                      <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        compte lié
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-500 max-w-[160px] truncate">
                    {row.note ?? '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-500">
                    {new Date(row.granted_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="py-2.5">
                    <button
                      type="button"
                      title={row.is_active ? 'Désactiver' : 'Réactiver'}
                      disabled={togglingId === row.id}
                      onClick={() => toggleActive(row)}
                      className={[
                        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50',
                        row.is_active
                          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/30'
                          : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30',
                      ].join(' ')}
                    >
                      {row.is_active ? (
                        <Trash2 className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminLaunchPage() {
  return (
    <div className="space-y-6">
      <LaunchPhaseCard />
      <WaitlistCard />
      <WhitelistCard />
    </div>
  );
}
