import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Inbox, Newspaper, Settings2, Swords } from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useTranslation } from '../../lib/i18n';
import { useMaintenanceModeContext } from '../../lib/supabase/MaintenanceModeContext';

function toDatetimeLocalValue(value: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoStringOrNull(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid-launch-date');
  }

  return date.toISOString();
}

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const {
    maintenance,
    launchDate,
    launchVideoUrl,
    updatedAt,
    isLoading,
    updateMaintenanceMode,
    updateSettings,
  } = useMaintenanceModeContext();
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);
  const [launchDateInput, setLaunchDateInput] = useState(() => toDatetimeLocalValue(launchDate));
  const [launchVideoUrlInput, setLaunchVideoUrlInput] = useState(() => launchVideoUrl ?? '');
  const [isSavingLaunchDate, setIsSavingLaunchDate] = useState(false);
  const [isSavingLaunchVideoUrl, setIsSavingLaunchVideoUrl] = useState(false);

  useEffect(() => {
    if (!isSavingLaunchDate) {
      setLaunchDateInput(toDatetimeLocalValue(launchDate));
    }
  }, [isSavingLaunchDate, launchDate]);

  useEffect(() => {
    if (!isSavingLaunchVideoUrl) {
      setLaunchVideoUrlInput(launchVideoUrl ?? '');
    }
  }, [isSavingLaunchVideoUrl, launchVideoUrl]);

  const handleMaintenanceToggle = async () => {
    setIsSavingMaintenance(true);

    try {
      const nextValue = !maintenance;
      await updateMaintenanceMode(nextValue);
      toast.success(nextValue ? 'Mode maintenance activé.' : 'Mode maintenance désactivé.');
    } catch {
      toast.error("Impossible de mettre à jour le mode maintenance.");
    } finally {
      setIsSavingMaintenance(false);
    }
  };

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
      const trimmedLaunchVideoUrl = launchVideoUrlInput.trim();
      await updateSettings({ launch_video_url: trimmedLaunchVideoUrl || null });
      toast.success(trimmedLaunchVideoUrl ? 'URL vidéo enregistrée.' : 'URL vidéo supprimée.');
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="md:col-span-2 border-zinc-800">
        <CardHeader className="mb-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-rose-400" />
                Maintenance globale
              </CardTitle>
              <CardDescription className="mt-2">
                Active ou désactive le blocage global du site en temps réel, sans redéploiement.
              </CardDescription>
            </div>
            <div className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
              {isLoading ? 'Chargement...' : maintenance ? 'ON' : 'OFF'}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-4">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Mode maintenance</p>
              <p className="text-sm text-zinc-400">
                {maintenance
                  ? 'Le site public est actuellement bloqué pour les visiteurs.'
                  : 'Le site public est actuellement accessible.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={maintenance}
              aria-label="Basculer le mode maintenance"
              onClick={handleMaintenanceToggle}
              disabled={isLoading || isSavingMaintenance}
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                maintenance
                  ? 'border-rose-500 bg-rose-500/90'
                  : 'border-zinc-700 bg-zinc-800'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  maintenance ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
            <span>
              Dernière mise à jour : {updatedAt ? new Date(updatedAt).toLocaleString() : 'inconnue'}
            </span>
            <Button
              variant={maintenance ? 'secondary' : 'primary'}
              onClick={handleMaintenanceToggle}
              isLoading={isSavingMaintenance}
              disabled={isLoading}
            >
              {maintenance ? 'Désactiver la maintenance' : 'Activer la maintenance'}
            </Button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-white">Date de lancement</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Laisse vide pour le mode simple. Renseigne une date pour afficher le mode lancement avec compte à rebours.
                </p>
              </div>

              <Input
                type="datetime-local"
                label="Lancement prévu"
                value={launchDateInput}
                onChange={(event) => setLaunchDateInput(event.target.value)}
                disabled={isLoading || isSavingLaunchDate}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={handleLaunchDateSave}
                  isLoading={isSavingLaunchDate}
                  disabled={isLoading}
                >
                  Enregistrer la date
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLaunchDateClear}
                  disabled={isLoading || isSavingLaunchDate || !launchDate}
                >
                  Vider la date
                </Button>
                <span className="text-sm text-zinc-500">
                  {launchDate
                    ? `Date active : ${new Date(launchDate).toLocaleString()}`
                    : 'Aucune date active'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-white">Vidéo de lancement</p>
                <p className="mt-1 text-sm text-zinc-400">
                  URL facultative. Si elle est vide, aucune vidéo ne sera affichée sur l'écran de maintenance.
                </p>
              </div>

              <Input
                type="url"
                label="URL vidéo"
                value={launchVideoUrlInput}
                onChange={(event) => setLaunchVideoUrlInput(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={isLoading || isSavingLaunchVideoUrl}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={handleLaunchVideoUrlSave}
                  isLoading={isSavingLaunchVideoUrl}
                  disabled={isLoading}
                >
                  Enregistrer l'URL
                </Button>
                <Button
                  variant="outline"
                  onClick={handleLaunchVideoUrlClear}
                  disabled={isLoading || isSavingLaunchVideoUrl || !launchVideoUrl}
                >
                  Vider l'URL
                </Button>
                <span className="text-sm text-zinc-500">
                  {launchVideoUrl ? 'Une vidéo est actuellement configurée' : 'Aucune vidéo active'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Link to="/admin/news" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="w-5 h-5 text-rose-400" />
                  {t('admin.dashboard.newsTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.newsDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/battles" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="w-5 h-5 text-rose-400" />
                  {t('admin.dashboard.battlesTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.battlesDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/messages" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="w-5 h-5 text-rose-400" />
                  {t('admin.dashboard.messagesTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.messagesDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <Link to="/admin/beat-analytics" className="group">
        <Card className="h-full border-zinc-800 hover:border-rose-500/60 transition-colors">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-rose-400" />
                  {t('admin.dashboard.beatAnalyticsTitle')}
                </CardTitle>
                <CardDescription className="mt-2">
                  {t('admin.dashboard.beatAnalyticsDescription')}
                </CardDescription>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
