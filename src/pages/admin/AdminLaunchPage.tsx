import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  Film,
  Globe2,
  KeyRound,
  Lock,
  Mail,
  Radio,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useMaintenanceModeContext } from '@/lib/supabase/MaintenanceModeContext';
import type { SiteAccessMode } from '@/lib/supabase/useMaintenanceMode';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  parseLaunchPageContent,
  serializeLaunchPageContent,
  type LaunchPageContent,
} from '@/lib/launchPageContent';

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
type LaunchPageTextKey = Exclude<
  keyof LaunchPageContent,
  'heroChips' | 'conversionBullets' | 'highlightCards' | 'platformRows' | 'processSteps'
>;

const ACCESS_MODE_ORDER: SiteAccessMode[] = ['private', 'controlled', 'public'];

const ACCESS_MODE_META: Record<SiteAccessMode, {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  badge: string;
  dotClassName: string;
  selectedClassName: string;
}> = {
  private: {
    icon: Lock,
    title: 'Privé',
    eyebrow: 'Whitelist uniquement',
    badge: 'Accès fermé',
    dotClassName: 'bg-rose-400',
    selectedClassName: 'border-rose-400/60 bg-rose-500/10 text-white shadow-[0_0_0_1px_rgba(251,113,133,0.12)]',
  },
  controlled: {
    icon: KeyRound,
    title: 'Contrôlé',
    eyebrow: 'Adresses inscrites confirmées',
    badge: 'Sélection campagne',
    dotClassName: 'bg-amber-400',
    selectedClassName: 'border-amber-400/60 bg-amber-500/10 text-white shadow-[0_0_0_1px_rgba(251,191,36,0.12)]',
  },
  public: {
    icon: Globe2,
    title: 'Public',
    eyebrow: 'Ouverture totale',
    badge: 'Plateforme ouverte',
    dotClassName: 'bg-emerald-400',
    selectedClassName: 'border-emerald-400/60 bg-emerald-500/10 text-white shadow-[0_0_0_1px_rgba(52,211,153,0.12)]',
  },
};

const ACCESS_MODE_DESCRIPTIONS: Record<SiteAccessMode, string> = {
  private:
    'Seuls les emails présents dans la whitelist ont accès. Tous les autres voient la page de lancement.',
  controlled:
    'La whitelist a accès complet. Les adresses inscrites confirmées dans la waitlist ont également accès. Les autres voient la page de lancement ou l\'écran d\'attente.',
  public:
    'Tout le monde a accès à la plateforme. Le système whitelist/waitlist reste actif pour les futures campagnes.',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDatetimeLocalValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoStringOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid-launch-date');
  return date.toISOString();
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getLaunchTiming(value: string | null) {
  if (!value) {
    return {
      label: 'Non programmée',
      detail: 'La page utilise le mode simple, sans compte à rebours.',
      tone: 'neutral' as const,
    };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      label: 'Date invalide',
      detail: 'La date enregistrée ne peut pas être lue.',
      tone: 'danger' as const,
    };
  }

  if (date.getTime() <= Date.now()) {
    return {
      label: 'Date passée',
      detail: formatDateTime(value) ?? 'Date enregistrée',
      tone: 'warning' as const,
    };
  }

  return {
    label: 'Compte à rebours actif',
    detail: formatDateTime(value) ?? 'Date programmée',
    tone: 'success' as const,
  };
}

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClassName = {
    neutral: 'border-zinc-800 bg-zinc-950/45 text-zinc-300',
    success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    warning: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    danger: 'border-rose-500/25 bg-rose-500/10 text-rose-200',
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${toneClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</p>
          <p className="mt-2 text-lg font-semibold text-white">{value}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{detail}</p>
    </div>
  );
}

function MessageField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-300">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className="w-full resize-none rounded-xl border border-zinc-700/80 bg-zinc-950/70 px-3 py-3 text-sm leading-relaxed text-white placeholder:text-zinc-600 transition-colors focus:border-rose-400/70 focus:outline-none focus:ring-2 focus:ring-rose-500/10 disabled:opacity-60"
      />
    </label>
  );
}

function LaunchOverview() {
  const {
    siteAccessMode,
    launchDate,
    launchVideoUrl,
    waitlistCountDisplay,
    isLoading,
  } = useMaintenanceModeContext();

  const meta = ACCESS_MODE_META[siteAccessMode];
  const ModeIcon = meta.icon;
  const timing = getLaunchTiming(launchDate);
  const hasVideo = Boolean(launchVideoUrl?.trim());

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(9,9,11,0.98))]">
      <div className="border-b border-zinc-800/80 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
              <Radio className="h-3.5 w-3.5 text-rose-300" />
              Console lancement
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">
              Pilotage de la page d&apos;accès
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Organise l&apos;ouverture de Beatelion, ajuste les messages visibles avant connexion et valide les producteurs autorisés.
            </p>
          </div>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
          >
            <Eye className="h-4 w-4" />
            Ouvrir le site
          </a>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={ModeIcon}
          label="Accès"
          value={isLoading ? 'Chargement' : meta.badge}
          detail={ACCESS_MODE_DESCRIPTIONS[siteAccessMode]}
          tone={siteAccessMode === 'public' ? 'success' : siteAccessMode === 'controlled' ? 'warning' : 'danger'}
        />
        <StatTile
          icon={CalendarClock}
          label="Lancement"
          value={timing.label}
          detail={timing.detail}
          tone={timing.tone}
        />
        <StatTile
          icon={Film}
          label="Vidéo"
          value={hasVideo ? 'Configurée' : 'Aucune vidéo'}
          detail={hasVideo ? 'La vidéo est affichée sur la page publique.' : 'Aucun aperçu vidéo ne sera affiché.'}
          tone={hasVideo ? 'success' : 'neutral'}
        />
        <StatTile
          icon={Users}
          label="Compteur public"
          value={waitlistCountDisplay > 0 ? `+${waitlistCountDisplay}` : 'Masqué'}
          detail="Nombre affiché comme preuve sociale sur l'écran de lancement."
          tone={waitlistCountDisplay > 0 ? 'success' : 'neutral'}
        />
      </div>
    </section>
  );
}

// ─── Section: Paramètres de lancement ─────────────────────────────────────────

function LaunchSettingsCard() {
  const {
    launchDate,
    launchVideoUrl,
    isLoading,
    updateSettings,
  } = useMaintenanceModeContext();

  const [launchDateInput, setLaunchDateInput] = useState(() => toDatetimeLocalValue(launchDate));
  const [launchVideoUrlInput, setLaunchVideoUrlInput] = useState(() => launchVideoUrl ?? '');
  const [isSavingLaunchDate, setIsSavingLaunchDate] = useState(false);
  const [isSavingLaunchVideoUrl, setIsSavingLaunchVideoUrl] = useState(false);

  useEffect(() => {
    if (!isSavingLaunchDate) setLaunchDateInput(toDatetimeLocalValue(launchDate));
  }, [isSavingLaunchDate, launchDate]);

  useEffect(() => {
    if (!isSavingLaunchVideoUrl) setLaunchVideoUrlInput(launchVideoUrl ?? '');
  }, [isSavingLaunchVideoUrl, launchVideoUrl]);

  const handleLaunchDateSave = async () => {
    setIsSavingLaunchDate(true);
    try {
      await updateSettings({ launch_date: toIsoStringOrNull(launchDateInput) });
      toast.success(launchDateInput ? 'Date de lancement enregistrée.' : 'Date de lancement supprimée.');
    } catch {
      toast.error("Impossible d'enregistrer la date de lancement.");
    } finally {
      setIsSavingLaunchDate(false);
    }
  };

  const handleLaunchDateClear = async () => {
    setIsSavingLaunchDate(true);
    try {
      setLaunchDateInput('');
      await updateSettings({ launch_date: null });
      toast.success('Date de lancement supprimée.');
    } catch {
      toast.error("Impossible de supprimer la date de lancement.");
    } finally {
      setIsSavingLaunchDate(false);
    }
  };

  const handleLaunchVideoUrlSave = async () => {
    setIsSavingLaunchVideoUrl(true);
    try {
      const trimmed = launchVideoUrlInput.trim();
      await updateSettings({ launch_video_url: trimmed || null });
      toast.success(trimmed ? 'URL vidéo enregistrée.' : 'URL vidéo supprimée.');
    } catch {
      toast.error("Impossible d'enregistrer l'URL vidéo.");
    } finally {
      setIsSavingLaunchVideoUrl(false);
    }
  };

  const handleLaunchVideoUrlClear = async () => {
    setIsSavingLaunchVideoUrl(true);
    try {
      setLaunchVideoUrlInput('');
      await updateSettings({ launch_video_url: null });
      toast.success('URL vidéo supprimée.');
    } catch {
      toast.error("Impossible de supprimer l'URL vidéo.");
    } finally {
      setIsSavingLaunchVideoUrl(false);
    }
  };

  const timing = getLaunchTiming(launchDate);
  const hasVideo = Boolean(launchVideoUrl?.trim());

  return (
    <Card padding="none" className="border-zinc-800 bg-zinc-900/80">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Paramètres de lancement</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Date, compte à rebours et vidéo affichés sur la page publique.
            </p>
          </div>
          <CalendarClock className="mt-1 h-5 w-5 text-zinc-500" />
        </div>
      </div>

      <div className="divide-y divide-zinc-800">
        <section className="p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white">Date de lancement</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Laisse vide pour masquer le compte à rebours.
                </p>
              </div>
              <span className={[
                'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
                timing.tone === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : timing.tone === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : timing.tone === 'danger'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      : 'border-zinc-700 bg-zinc-950/60 text-zinc-400',
              ].join(' ')}>
                <Clock3 className="h-3.5 w-3.5" />
                {timing.label}
              </span>
            </div>
            <Input
              type="datetime-local"
              label="Lancement prévu"
              value={launchDateInput}
              onChange={(e) => setLaunchDateInput(e.target.value)}
              disabled={isLoading || isSavingLaunchDate}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={handleLaunchDateSave}
                isLoading={isSavingLaunchDate}
                disabled={isLoading}
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
              >
                Enregistrer
              </Button>
              <Button
                variant="outline"
                onClick={handleLaunchDateClear}
                disabled={isLoading || isSavingLaunchDate || !launchDate}
                leftIcon={<XCircle className="h-4 w-4" />}
              >
                Vider
              </Button>
              <span className="text-xs text-zinc-500">{timing.detail}</span>
            </div>
          </div>
        </section>

        <section className="p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white">Vidéo de lancement</p>
                <p className="mt-1 text-sm text-zinc-400">
                  URL YouTube facultative affichée sous le formulaire d&apos;accès.
                </p>
              </div>
              <span className={[
                'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
                hasVideo
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-700 bg-zinc-950/60 text-zinc-400',
              ].join(' ')}>
                <Film className="h-3.5 w-3.5" />
                {hasVideo ? 'Active' : 'Inactive'}
              </span>
            </div>
            <Input
              type="url"
              label="URL vidéo"
              value={launchVideoUrlInput}
              onChange={(e) => setLaunchVideoUrlInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              disabled={isLoading || isSavingLaunchVideoUrl}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={handleLaunchVideoUrlSave}
                isLoading={isSavingLaunchVideoUrl}
                disabled={isLoading}
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
              >
                Enregistrer
              </Button>
              <Button
                variant="outline"
                onClick={handleLaunchVideoUrlClear}
                disabled={isLoading || isSavingLaunchVideoUrl || !launchVideoUrl}
                leftIcon={<XCircle className="h-4 w-4" />}
              >
                Vider
              </Button>
              <span className="text-xs text-zinc-500">
                {hasVideo ? 'La vidéo est configurée pour la page publique.' : 'Aucune vidéo active.'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </Card>
  );
}

// ─── Section: Phase de lancement ─────────────────────────────────────────────

function LaunchPhaseCard() {
  const {
    siteAccessMode,
    launchMessagePublic,
    launchMessageWaitlistPending,
    launchMessageWhitelist,
    waitlistCountDisplay,
    isLoading: isSettingsLoading,
    updateSettings,
  } = useMaintenanceModeContext();

  const [mode, setMode] = useState<SiteAccessMode>(siteAccessMode);
  const [publicContent, setPublicContent] = useState<LaunchPageContent>(() =>
    parseLaunchPageContent(launchMessagePublic),
  );
  const [msgPending, setMsgPending] = useState(launchMessageWaitlistPending ?? '');
  const [msgWhitelist, setMsgWhitelist] = useState(launchMessageWhitelist ?? '');
  const [countDisplay, setCountDisplay] = useState(String(waitlistCountDisplay ?? 0));
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingCampaign, setIsSendingCampaign] = useState(false);

  // Sync when Realtime pushes an update
  useEffect(() => { setMode(siteAccessMode); }, [siteAccessMode]);
  useEffect(() => { setPublicContent(parseLaunchPageContent(launchMessagePublic)); }, [launchMessagePublic]);
  useEffect(() => { setMsgPending(launchMessageWaitlistPending ?? ''); }, [launchMessageWaitlistPending]);
  useEffect(() => { setMsgWhitelist(launchMessageWhitelist ?? ''); }, [launchMessageWhitelist]);
  useEffect(() => { setCountDisplay(String(waitlistCountDisplay ?? 0)); }, [waitlistCountDisplay]);

  const updatePublicText = (key: LaunchPageTextKey, value: string) => {
    setPublicContent((previous) => ({ ...previous, [key]: value }));
  };

  const updatePublicArrayText = (
    key: 'heroChips' | 'conversionBullets',
    index: number,
    value: string,
  ) => {
    setPublicContent((previous) => ({
      ...previous,
      [key]: previous[key].map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  };

  const updateHighlightCard = (
    index: number,
    field: keyof LaunchPageContent['highlightCards'][number],
    value: string,
  ) => {
    setPublicContent((previous) => ({
      ...previous,
      highlightCards: previous.highlightCards.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const updatePlatformRow = (
    index: number,
    field: keyof LaunchPageContent['platformRows'][number],
    value: string,
  ) => {
    setPublicContent((previous) => ({
      ...previous,
      platformRows: previous.platformRows.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const updateProcessStep = (
    index: number,
    field: keyof LaunchPageContent['processSteps'][number],
    value: string,
  ) => {
    setPublicContent((previous) => ({
      ...previous,
      processSteps: previous.processSteps.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const handleSendCampaign = async () => {
    if (isSendingCampaign) return;
    setIsSendingCampaign(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('User is not authenticated.');
      const { data, error } = await supabase.functions.invoke<{
        success?: boolean;
        error?: string;
        sent?: number;
      }>('send-waitlist-campaign', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) { toast.error('Erreur réseau'); return; }
      if (!data?.success) { toast.error('Erreur: ' + (data?.error ?? 'unknown')); return; }
      toast.success(`Campagne envoyée (${data.sent ?? 0} emails)`);
    } catch {
      toast.error("Erreur lors de l'envoi");
    } finally {
      setIsSendingCampaign(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isSettingsLoading) return;

    const parsedCount = Math.max(0, Math.floor(Number(countDisplay) || 0));

    setIsSaving(true);
    try {
      await updateSettings({
        site_access_mode: mode,
        launch_message_public: serializeLaunchPageContent(publicContent),
        launch_message_waitlist_pending: msgPending.trim() || null,
        launch_message_whitelist: msgWhitelist.trim() || null,
        waitlist_count_display: parsedCount,
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
    <Card padding="none" className="border-zinc-800 bg-zinc-900/80">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Phase de lancement</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Définis qui peut entrer sur la plateforme.
            </p>
          </div>
          <ShieldCheck className="mt-1 h-5 w-5 text-zinc-500" />
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6 p-5">
        <div>
          <p className="mb-3 text-sm font-medium text-zinc-300">Mode d&apos;accès</p>
          <div className="grid gap-3 lg:grid-cols-3">
            {ACCESS_MODE_ORDER.map((value) => {
              const meta = ACCESS_MODE_META[value];
              const Icon = meta.icon;
              const isSelected = mode === value;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={isSettingsLoading || isSaving}
                  className={[
                    'min-h-[118px] rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                    isSelected
                      ? meta.selectedClassName
                      : 'border-zinc-800 bg-zinc-950/45 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-950/80',
                  ].join(' ')}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className={`mt-1 h-2 w-2 rounded-full ${meta.dotClassName}`} />
                  </span>
                  <span className="mt-4 block text-base font-semibold text-white">{meta.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{meta.eyebrow}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm leading-relaxed text-zinc-400">
            {ACCESS_MODE_DESCRIPTIONS[mode]}
          </p>
        </div>

        {mode === 'public' && siteAccessMode !== 'public' && (
          <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Vous êtes sur le point d&apos;ouvrir la plateforme au public. Cette action est
            visible immédiatement par tous les visiteurs.
          </div>
        )}

        <div className="border-t border-zinc-800 pt-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/70">
              <Mail className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-300">Textes de la page publique</p>
              <p className="mt-1 text-xs text-zinc-500">
                Tous ces champs pilotent directement la landing page. Les anciens messages simples sont repris comme message principal.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Hero</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Input
                  label="Sous-titre header"
                  value={publicContent.headerTagline}
                  onChange={(e) => updatePublicText('headerTagline', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Badge hero"
                  value={publicContent.heroBadge}
                  onChange={(e) => updatePublicText('heroBadge', e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <MessageField
                  label="Titre hero - ligne blanche"
                  value={publicContent.heroTitlePrimary}
                  onChange={(value) => updatePublicText('heroTitlePrimary', value)}
                  placeholder="Aujourd’hui, tout le monde pense être bon."
                  rows={2}
                  disabled={isSaving}
                />
                <MessageField
                  label="Titre hero - ligne dégradée"
                  value={publicContent.heroTitleAccent}
                  onChange={(value) => updatePublicText('heroTitleAccent', value)}
                  placeholder="Mais personne n’est vraiment testé."
                  rows={2}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <MessageField
                  label="Message principal"
                  value={publicContent.heroMessage}
                  onChange={(value) => updatePublicText('heroMessage', value)}
                  placeholder="Entre dans le cercle des producteurs..."
                  rows={3}
                  disabled={isSaving}
                />
                <MessageField
                  label="Sous-texte"
                  value={publicContent.heroSubline}
                  onChange={(value) => updatePublicText('heroSubline', value)}
                  placeholder="Sur Beatelion, ton niveau est comparé..."
                  rows={3}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {publicContent.heroChips.map((item, index) => (
                  <Input
                    key={`hero-chip-${index}`}
                    label={`Pastille ${index + 1}`}
                    value={item}
                    onChange={(e) => updatePublicArrayText('heroChips', index, e.target.value)}
                    disabled={isSaving}
                  />
                ))}
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {publicContent.conversionBullets.map((item, index) => (
                  <Input
                    key={`conversion-bullet-${index}`}
                    label={`Bullet ${index + 1}`}
                    value={item}
                    onChange={(e) => updatePublicArrayText('conversionBullets', index, e.target.value)}
                    disabled={isSaving}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Cartes de valeur</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {publicContent.highlightCards.map((item, index) => (
                  <div key={`highlight-card-${index}`} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <Input
                      label={`Titre carte ${index + 1}`}
                      value={item.title}
                      onChange={(e) => updateHighlightCard(index, 'title', e.target.value)}
                      disabled={isSaving}
                    />
                    <MessageField
                      label={`Texte carte ${index + 1}`}
                      value={item.text}
                      onChange={(value) => updateHighlightCard(index, 'text', value)}
                      placeholder="Texte affiché dans la carte"
                      rows={3}
                      disabled={isSaving}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Formulaire et CTA</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <Input
                  label="Eyebrow formulaire"
                  value={publicContent.formEyebrow}
                  onChange={(e) => updatePublicText('formEyebrow', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Titre formulaire"
                  value={publicContent.formTitle}
                  onChange={(e) => updatePublicText('formTitle', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Sous-titre formulaire"
                  value={publicContent.formSubtitle}
                  onChange={(e) => updatePublicText('formSubtitle', e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Input
                  label="Label email"
                  value={publicContent.emailLabel}
                  onChange={(e) => updatePublicText('emailLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Placeholder email"
                  value={publicContent.emailPlaceholder}
                  onChange={(e) => updatePublicText('emailPlaceholder', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Texte bouton"
                  value={publicContent.formSubmitLabel}
                  onChange={(e) => updatePublicText('formSubmitLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Texte bouton pendant envoi"
                  value={publicContent.formSubmittingLabel}
                  onChange={(e) => updatePublicText('formSubmittingLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Micro-trust"
                  value={publicContent.trustText}
                  onChange={(e) => updatePublicText('trustText', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Social proof statique"
                  value={publicContent.socialProofText}
                  onChange={(e) => updatePublicText('socialProofText', e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4">
                <MessageField
                  label="Note sous formulaire"
                  value={publicContent.formNote}
                  onChange={(value) => updatePublicText('formNote', value)}
                  placeholder="Tu recevras un email..."
                  rows={3}
                  disabled={isSaving}
                />
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Compte à rebours et accès validé</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-5">
                <Input
                  label="Libellé date"
                  value={publicContent.countdownLabel}
                  onChange={(e) => updatePublicText('countdownLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Jours"
                  value={publicContent.countdownDaysLabel}
                  onChange={(e) => updatePublicText('countdownDaysLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Heures"
                  value={publicContent.countdownHoursLabel}
                  onChange={(e) => updatePublicText('countdownHoursLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Minutes"
                  value={publicContent.countdownMinutesLabel}
                  onChange={(e) => updatePublicText('countdownMinutesLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Secondes"
                  value={publicContent.countdownSecondsLabel}
                  onChange={(e) => updatePublicText('countdownSecondsLabel', e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <Input
                  label="Titre accès validé"
                  value={publicContent.loginTitle}
                  onChange={(e) => updatePublicText('loginTitle', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Texte accès validé"
                  value={publicContent.loginText}
                  onChange={(e) => updatePublicText('loginText', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Bouton connexion"
                  value={publicContent.loginCta}
                  onChange={(e) => updatePublicText('loginCta', e.target.value)}
                  disabled={isSaving}
                />
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Preuve sociale et aperçu plateforme</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Input
                  label="Libellé compteur dynamique"
                  value={publicContent.waitlistCountLabel}
                  onChange={(e) => updatePublicText('waitlistCountLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Libellé accès par vagues"
                  value={publicContent.wavesLabel}
                  onChange={(e) => updatePublicText('wavesLabel', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Eyebrow aperçu"
                  value={publicContent.platformEyebrow}
                  onChange={(e) => updatePublicText('platformEyebrow', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Titre aperçu"
                  value={publicContent.platformTitle}
                  onChange={(e) => updatePublicText('platformTitle', e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {publicContent.platformRows.map((item, index) => (
                  <div key={`platform-row-${index}`} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <Input
                      label={`Aperçu ${index + 1}`}
                      value={item.label}
                      onChange={(e) => updatePlatformRow(index, 'label', e.target.value)}
                      disabled={isSaving}
                    />
                    <Input
                      label={`Détail ${index + 1}`}
                      value={item.value}
                      onChange={(e) => updatePlatformRow(index, 'value', e.target.value)}
                      disabled={isSaving}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Vidéo, process et footer</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <Input
                  label="Titre vidéo"
                  value={publicContent.videoTitle}
                  onChange={(e) => updatePublicText('videoTitle', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Sous-titre vidéo"
                  value={publicContent.videoSubtitle}
                  onChange={(e) => updatePublicText('videoSubtitle', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Titre iframe"
                  value={publicContent.videoIframeTitle}
                  onChange={(e) => updatePublicText('videoIframeTitle', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Eyebrow process"
                  value={publicContent.processEyebrow}
                  onChange={(e) => updatePublicText('processEyebrow', e.target.value)}
                  disabled={isSaving}
                />
                <Input
                  label="Footer"
                  value={publicContent.footerText}
                  onChange={(e) => updatePublicText('footerText', e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {publicContent.processSteps.map((item, index) => (
                  <div key={`process-step-${index}`} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <Input
                      label={`Numéro étape ${index + 1}`}
                      value={item.step}
                      onChange={(e) => updateProcessStep(index, 'step', e.target.value)}
                      disabled={isSaving}
                    />
                    <Input
                      label={`Titre étape ${index + 1}`}
                      value={item.title}
                      onChange={(e) => updateProcessStep(index, 'title', e.target.value)}
                      disabled={isSaving}
                    />
                    <MessageField
                      label={`Texte étape ${index + 1}`}
                      value={item.text}
                      onChange={(value) => updateProcessStep(index, 'text', value)}
                      placeholder="Texte affiché dans l'étape"
                      rows={3}
                      disabled={isSaving}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-4">
              <p className="text-sm font-semibold text-white">Autres écrans d'accès</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <MessageField
                  label="Waitlist en attente"
                  value={msgPending}
                  onChange={setMsgPending}
                  placeholder="Tu es sur la liste. Les accès s'ouvrent progressivement."
                  rows={3}
                  disabled={isSaving}
                />
                <MessageField
                  label="Whitelist"
                  value={msgWhitelist}
                  onChange={setMsgWhitelist}
                  placeholder="Bienvenue dans le cercle."
                  rows={3}
                  disabled={isSaving}
                />
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-5">
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Compteur social (page de lancement)
          </label>
          <p className="mb-2 text-xs text-zinc-500">
            Affiché sous la forme &ldquo;+X producteurs ont demandé leur accès&rdquo;. Mets&nbsp;<strong className="text-zinc-400">0</strong> pour masquer.
          </p>
          <input
            type="number"
            min={0}
            step={1}
            title="Compteur social affiché sur la page de lancement"
            value={countDisplay}
            onChange={(e) => setCountDisplay(e.target.value)}
            disabled={isSaving}
            className="h-10 w-40 rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 text-sm text-white placeholder:text-zinc-600 focus:border-rose-400/70 focus:outline-none focus:ring-2 focus:ring-rose-500/10 disabled:opacity-60"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-5">
          <Button
            type="submit"
            isLoading={isSaving}
            disabled={isSettingsLoading || isSaving}
            leftIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            Sauvegarder
          </Button>
          <span className="text-xs text-zinc-500">Les changements sont appliqués dès validation.</span>
        </div>
      </form>

      <div className="border-t border-zinc-800 bg-zinc-950/30 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-300">Campagne waitlist</p>
            <p className="mt-1 text-xs text-zinc-500">
              Envoie un email à tous les inscrits en attente pour les inviter à rejoindre la plateforme.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleSendCampaign}
            isLoading={isSendingCampaign}
            leftIcon={<Send className="h-4 w-4" />}
          >
            Envoyer la campagne
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Waitlist ────────────────────────────────────────────────────────

function WaitlistCard() {
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [tab, setTab] = useState<WaitlistTab>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('waitlist')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      const msg = (error as { message?: string; code?: string }).message
        ?? JSON.stringify(error);
      const code = (error as { code?: string }).code ?? '';
      setLoadError(`[${code}] ${msg}`);
      console.error('[AdminLaunch] waitlist load error', error);
    } else {
      setRows((data as unknown as WaitlistRow[]) ?? []);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('waitlist').update(patch).eq('id', id);

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

  const TABS: { key: WaitlistTab; label: string; icon: LucideIcon }[] = [
    { key: 'pending', label: `En attente (${counts.pending})`, icon: Clock3 },
    { key: 'accepted', label: `Acceptés (${counts.accepted})`, icon: CheckCircle2 },
    { key: 'rejected', label: `Refusés (${counts.rejected})`, icon: XCircle },
  ];

  return (
    <Card padding="none" className="border-zinc-800 bg-zinc-900/80">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Waitlist</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {rows.length} inscription{rows.length !== 1 ? 's' : ''} au total
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} isLoading={isLoading}>
          Rafraîchir
        </Button>
      </div>

      <div className="grid gap-2 border-b border-zinc-800 bg-zinc-950/25 p-3 sm:grid-cols-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              'inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              tab === key
                ? 'border-rose-400/50 bg-rose-500/10 text-white'
                : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="max-h-[430px] overflow-auto">
        {loadError && (
          <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 font-mono break-all">
            <span className="font-semibold">Erreur DB :</span> {loadError}
          </div>
        )}
        {isLoading ? (
          <p className="py-8 text-center text-sm text-zinc-500">Chargement...</p>
        ) : loadError ? null : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            Aucune entrée {tab === 'pending' ? 'en attente' : tab === 'accepted' ? 'acceptée' : 'refusée'}.
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-900">
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Date</th>
                {tab === 'pending' && <th className="px-5 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filtered.map((row) => (
                <tr key={row.id} className="py-2">
                  <td className="px-5 py-3 text-zinc-200">
                    {row.email}
                    {row.user_id && (
                      <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        compte lié
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">{row.source}</td>
                  <td className="px-5 py-3 text-zinc-500">
                    {new Date(row.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  {tab === 'pending' && (
                    <td className="px-5 py-3">
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('access_whitelist')
      .select('id, email, user_id, granted_at, note, is_active')
      .order('granted_at', { ascending: false });

    if (error) {
      toast.error('Erreur chargement whitelist.');
      console.error('[AdminLaunch] whitelist load error', error);
    } else {
      setRows((data as unknown as WhitelistRow[]) ?? []);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
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
      setRows((prev) => [data as unknown as WhitelistRow, ...prev]);
      setNewEmail('');
      setNewNote('');
      toast.success('Email ajouté à la whitelist.');
    }
    setIsAdding(false);
  };

  const toggleActive = async (row: WhitelistRow) => {
    setTogglingId(row.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
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
    <Card padding="none" className="border-zinc-800 bg-zinc-900/80">
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Whitelist</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {activeRows.length} email{activeRows.length !== 1 ? 's' : ''} actif
              {activeRows.length !== 1 ? 's' : ''} avec accès complet.
            </p>
          </div>
          <ShieldCheck className="mt-1 h-5 w-5 text-zinc-500" />
        </div>
      </div>

      <form onSubmit={handleAdd} className="grid gap-3 border-b border-zinc-800 bg-zinc-950/25 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
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

      <div className="max-h-[430px] overflow-auto">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-zinc-500">Chargement...</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">
            Aucun email dans la whitelist.
          </p>
        ) : (
          <table className="w-full min-w-[680px] text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-900">
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Note</th>
                <th className="px-5 py-3">Ajouté le</th>
                <th className="px-5 py-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {[...activeRows, ...inactiveRows].map((row) => (
                <tr key={row.id} className={row.is_active ? '' : 'opacity-40'}>
                  <td className="px-5 py-3 text-zinc-200">
                    {row.email}
                    {row.user_id && (
                      <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                        compte lié
                      </span>
                    )}
                  </td>
                  <td className="max-w-[180px] truncate px-5 py-3 text-zinc-500">
                    {row.note ?? '-'}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">
                    {new Date(row.granted_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-5 py-3">
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
      <LaunchOverview />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <LaunchPhaseCard />
        <LaunchSettingsCard />
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        <WaitlistCard />
        <WhitelistCard />
      </div>
    </div>
  );
}
