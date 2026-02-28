import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase/client';

const SOCIAL_SETTINGS_KEY = 'social_links';
const SITE_AUDIO_SETTINGS_TABLE = 'site_audio_settings';

interface SocialLinksForm {
  twitter: string;
  instagram: string;
  youtube: string;
}

interface SiteAudioSettingsRow {
  id: string;
  enabled: boolean;
  watermark_audio_path: string | null;
  gain_db: number;
  min_interval_sec: number;
  max_interval_sec: number;
  created_at: string;
  updated_at: string;
}

interface WatermarkSettingsForm {
  enabled: boolean;
  gain_db: string;
  min_interval_sec: string;
  max_interval_sec: string;
}

interface ReprocessStats {
  enqueued: number;
  skipped: number;
}

const EMPTY_FORM: SocialLinksForm = {
  twitter: '',
  instagram: '',
  youtube: '',
};

const EMPTY_WATERMARK_FORM: WatermarkSettingsForm = {
  enabled: true,
  gain_db: '-10',
  min_interval_sec: '20',
  max_interval_sec: '45',
};

const HTTP_URL_REGEX = /^https?:\/\//i;

const sanitizeUrl = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return HTTP_URL_REGEX.test(trimmed) ? trimmed : '';
};

const isAllowedUrl = (value: string) => value.length === 0 || HTTP_URL_REGEX.test(value);

const asFiniteNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const adminDb = supabase as any;

export function AdminSettingsPage() {
  const [socialForm, setSocialForm] = useState<SocialLinksForm>(EMPTY_FORM);
  const [isSocialLoading, setIsSocialLoading] = useState(true);
  const [isSocialSaving, setIsSocialSaving] = useState(false);

  const [siteAudioSettings, setSiteAudioSettings] = useState<SiteAudioSettingsRow | null>(null);
  const [watermarkForm, setWatermarkForm] = useState<WatermarkSettingsForm>(EMPTY_WATERMARK_FORM);
  const [isWatermarkLoading, setIsWatermarkLoading] = useState(true);
  const [isWatermarkSaving, setIsWatermarkSaving] = useState(false);
  const [isUploadingWatermark, setIsUploadingWatermark] = useState(false);
  const [isEnqueueingReprocess, setIsEnqueueingReprocess] = useState(false);
  const [selectedWatermarkFile, setSelectedWatermarkFile] = useState<File | null>(null);
  const [reprocessStats, setReprocessStats] = useState<ReprocessStats | null>(null);

  const currentWatermarkPath = siteAudioSettings?.watermark_audio_path ?? null;
  const lastUpdatedLabel = useMemo(() => {
    if (!siteAudioSettings?.updated_at) return 'Jamais';
    const parsed = new Date(siteAudioSettings.updated_at);
    if (Number.isNaN(parsed.getTime())) return 'Inconnue';
    return parsed.toLocaleString('fr-FR');
  }, [siteAudioSettings?.updated_at]);

  useEffect(() => {
    const loadSocialLinks = async () => {
      setIsSocialLoading(true);
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SOCIAL_SETTINGS_KEY)
        .maybeSingle();

      if (error) {
        console.error('admin social settings load error', error);
        toast.error('Impossible de charger les liens sociaux.');
        setIsSocialLoading(false);
        return;
      }

      const payload = data?.value;
      const parsed = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
      setSocialForm({
        twitter: sanitizeUrl(parsed.twitter),
        instagram: sanitizeUrl(parsed.instagram),
        youtube: sanitizeUrl(parsed.youtube),
      });
      setIsSocialLoading(false);
    };

    const loadSiteAudioSettings = async () => {
      setIsWatermarkLoading(true);
      const { data, error } = await adminDb
        .from(SITE_AUDIO_SETTINGS_TABLE)
        .select('id, enabled, watermark_audio_path, gain_db, min_interval_sec, max_interval_sec, updated_at, created_at')
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('admin site audio settings load error', error);
        toast.error('Impossible de charger la configuration watermark.');
        setIsWatermarkLoading(false);
        return;
      }

      const settings = (data ?? null) as SiteAudioSettingsRow | null;
      setSiteAudioSettings(settings);
      if (settings) {
        setWatermarkForm({
          enabled: Boolean(settings.enabled),
          gain_db: String(settings.gain_db ?? -10),
          min_interval_sec: String(settings.min_interval_sec ?? 20),
          max_interval_sec: String(settings.max_interval_sec ?? 45),
        });
      }
      setIsWatermarkLoading(false);
    };

    void Promise.all([loadSocialLinks(), loadSiteAudioSettings()]);
  }, []);

  const handleSocialSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSocialSaving) return;

    const nextForm: SocialLinksForm = {
      twitter: socialForm.twitter.trim(),
      instagram: socialForm.instagram.trim(),
      youtube: socialForm.youtube.trim(),
    };

    if (!isAllowedUrl(nextForm.twitter) || !isAllowedUrl(nextForm.instagram) || !isAllowedUrl(nextForm.youtube)) {
      toast.error('Utilisez uniquement des URLs http(s).');
      return;
    }

    setIsSocialSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          key: SOCIAL_SETTINGS_KEY,
          value: nextForm,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );

    if (error) {
      console.error('admin social settings save error', error);
      toast.error('Impossible d’enregistrer les liens sociaux.');
      setIsSocialSaving(false);
      return;
    }

    setSocialForm(nextForm);
    toast.success('Liens sociaux mis à jour.');
    setIsSocialSaving(false);
  };

  const handleWatermarkSettingsSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isWatermarkSaving) return;

    const gainDb = asFiniteNumber(watermarkForm.gain_db);
    const minInterval = asFiniteNumber(watermarkForm.min_interval_sec);
    const maxInterval = asFiniteNumber(watermarkForm.max_interval_sec);

    if (gainDb === null || minInterval === null || maxInterval === null) {
      toast.error('Les réglages watermark doivent être numériques.');
      return;
    }

    if (minInterval < 1 || maxInterval < minInterval) {
      toast.error('Les intervalles watermark sont invalides.');
      return;
    }

    setIsWatermarkSaving(true);

    const payload = {
      enabled: watermarkForm.enabled,
      gain_db: gainDb,
      min_interval_sec: Math.round(minInterval),
      max_interval_sec: Math.round(maxInterval),
      updated_at: new Date().toISOString(),
    };

    const query = siteAudioSettings?.id
      ? adminDb
          .from(SITE_AUDIO_SETTINGS_TABLE)
          .update(payload)
          .eq('id', siteAudioSettings.id)
      : adminDb
          .from(SITE_AUDIO_SETTINGS_TABLE)
          .insert({
            ...payload,
            watermark_audio_path: currentWatermarkPath,
          });

    const { data, error } = await query
      .select('id, enabled, watermark_audio_path, gain_db, min_interval_sec, max_interval_sec, updated_at, created_at')
      .maybeSingle();

    if (error) {
      console.error('admin site audio settings save error', error);
      toast.error('Impossible d’enregistrer la configuration watermark.');
      setIsWatermarkSaving(false);
      return;
    }

    const nextSettings = data as SiteAudioSettingsRow | null;
    setSiteAudioSettings(nextSettings);
    if (nextSettings) {
      setWatermarkForm({
        enabled: Boolean(nextSettings.enabled),
        gain_db: String(nextSettings.gain_db ?? gainDb),
        min_interval_sec: String(nextSettings.min_interval_sec ?? Math.round(minInterval)),
        max_interval_sec: String(nextSettings.max_interval_sec ?? Math.round(maxInterval)),
      });
    }

    toast.success('Configuration watermark mise à jour.');
    setIsWatermarkSaving(false);
  };

  const handleWatermarkUpload = async () => {
    if (!selectedWatermarkFile || isUploadingWatermark) return;

    setIsUploadingWatermark(true);
    const formData = new FormData();
    formData.append('file', selectedWatermarkFile);

    const { data, error } = await supabase.functions.invoke('admin-upload-watermark', {
      body: formData,
    });

    if (error) {
      console.error('admin-upload-watermark invoke error', error);
      toast.error('Impossible d’uploader le sample watermark.');
      setIsUploadingWatermark(false);
      return;
    }

    const payload = (data ?? {}) as { path?: string; settings?: SiteAudioSettingsRow | null };
    if (payload.settings) {
      setSiteAudioSettings(payload.settings);
      setWatermarkForm({
        enabled: Boolean(payload.settings.enabled),
        gain_db: String(payload.settings.gain_db ?? watermarkForm.gain_db),
        min_interval_sec: String(payload.settings.min_interval_sec ?? watermarkForm.min_interval_sec),
        max_interval_sec: String(payload.settings.max_interval_sec ?? watermarkForm.max_interval_sec),
      });
    } else if (payload.path) {
      setSiteAudioSettings((prev) => prev
        ? { ...prev, watermark_audio_path: payload.path, updated_at: new Date().toISOString() }
        : prev);
    }

    setSelectedWatermarkFile(null);
    toast.success('Sample watermark uploadé.');
    setIsUploadingWatermark(false);
  };

  const handleEnqueueReprocess = async () => {
    if (isEnqueueingReprocess) return;

    setIsEnqueueingReprocess(true);
    const { data, error } = await supabase.functions.invoke('enqueue-preview-reprocess', {
      body: {},
    });

    if (error) {
      console.error('enqueue-preview-reprocess invoke error', error);
      toast.error('Impossible d’enfiler la régénération globale.');
      setIsEnqueueingReprocess(false);
      return;
    }

    const payload = (data ?? {}) as { enqueued_count?: number; skipped_count?: number };
    const count = Number.isFinite(payload.enqueued_count) ? Number(payload.enqueued_count) : 0;
    const skipped = Number.isFinite(payload.skipped_count) ? Number(payload.skipped_count) : 0;
    setReprocessStats({ enqueued: count, skipped });
    toast.success(`Jobs enqueued: ${count} • skipped: ${skipped}`);
    setIsEnqueueingReprocess(false);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">Watermark global</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Configurez le sample admin, les paramètres d’injection et l’enqueue global du reprocess.
        </p>

        <form onSubmit={handleWatermarkSettingsSave} className="mt-6 space-y-4">
          <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={watermarkForm.enabled}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/50"
            />
            Watermark global activé
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <Input
              type="number"
              step="0.1"
              label="Gain (dB)"
              value={watermarkForm.gain_db}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, gain_db: event.target.value }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
            />
            <Input
              type="number"
              min="1"
              step="1"
              label="Interval min (sec)"
              value={watermarkForm.min_interval_sec}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, min_interval_sec: event.target.value }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
            />
            <Input
              type="number"
              min="1"
              step="1"
              label="Interval max (sec)"
              value={watermarkForm.max_interval_sec}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, max_interval_sec: event.target.value }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300 space-y-1">
            <p>
              <span className="text-zinc-500">Sample courant:</span>{' '}
              <span className="break-all">{currentWatermarkPath ?? 'Aucun sample uploadé'}</span>
            </p>
            <p>
              <span className="text-zinc-500">Dernière mise à jour:</span> {lastUpdatedLabel}
            </p>
            {reprocessStats && (
              <>
                <p>
                  <span className="text-zinc-500">Jobs enqueued:</span> {reprocessStats.enqueued}
                </p>
                <p>
                  <span className="text-zinc-500">Jobs skipped (already up to date):</span> {reprocessStats.skipped}
                </p>
              </>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label htmlFor="watermark-file" className="block text-sm font-medium text-zinc-300 mb-1.5">
                Upload sample watermark
              </label>
              <input
                id="watermark-file"
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave"
                onChange={(event) => setSelectedWatermarkFile(event.target.files?.[0] ?? null)}
                disabled={isUploadingWatermark}
                className="block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-300 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-200"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleWatermarkUpload}
              isLoading={isUploadingWatermark}
              disabled={!selectedWatermarkFile || isUploadingWatermark}
            >
              Uploader le sample
            </Button>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" isLoading={isWatermarkLoading || isWatermarkSaving}>
              Enregistrer les réglages
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleEnqueueReprocess}
              isLoading={isEnqueueingReprocess}
              disabled={isEnqueueingReprocess}
            >
              Régénérer toutes les previews
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">Paramètres sociaux</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Configurez les liens Twitter, Instagram et YouTube affichés dans le footer.
        </p>

        <form onSubmit={handleSocialSave} className="mt-6 space-y-4">
          <Input
            type="url"
            label="Twitter URL"
            value={socialForm.twitter}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, twitter: event.target.value }))}
            placeholder="https://twitter.com/..."
            disabled={isSocialLoading || isSocialSaving}
          />
          <Input
            type="url"
            label="Instagram URL"
            value={socialForm.instagram}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, instagram: event.target.value }))}
            placeholder="https://instagram.com/..."
            disabled={isSocialLoading || isSocialSaving}
          />
          <Input
            type="url"
            label="YouTube URL"
            value={socialForm.youtube}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, youtube: event.target.value }))}
            placeholder="https://youtube.com/@..."
            disabled={isSocialLoading || isSocialSaving}
          />

          <div className="pt-2">
            <Button type="submit" isLoading={isSocialLoading || isSocialSaving}>
              Enregistrer
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
