import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import type { Json } from '../../lib/supabase/database.types';
import { formatDateTime } from '../../lib/utils/format';

const SOCIAL_SETTINGS_KEY = 'social_links';
const HOMEPAGE_STATS_SETTINGS_KEY = 'show_homepage_stats';
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

const parseEnabledToggle = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const enabled = (value as Record<string, unknown>).enabled;
  if (typeof enabled === 'boolean') {
    return enabled;
  }

  if (typeof enabled === 'string') {
    const normalized = enabled.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return false;
};

const isAllowedUrl = (value: string) => value.length === 0 || HTTP_URL_REGEX.test(value);

const asFiniteNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toEdgeInvokeErrorMessage = async (error: unknown) => {
  if (!error || typeof error !== 'object') return null;

  const message = 'message' in error
    ? asNonEmptyString((error as { message?: unknown }).message)
    : null;
  const context = 'context' in error
    ? (error as { context?: unknown }).context
    : null;

  if (!(context instanceof Response)) {
    return message;
  }

  try {
    const payload = await context.clone().json() as Record<string, unknown>;
    const apiError = asNonEmptyString(payload.error);
    const apiMessage = asNonEmptyString(payload.message);
    return apiError || apiMessage || message;
  } catch {
    try {
      const text = asNonEmptyString(await context.clone().text());
      return text || message;
    } catch {
      return message;
    }
  }
};

const adminDb = supabase as any;

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const [socialForm, setSocialForm] = useState<SocialLinksForm>(EMPTY_FORM);
  const [isSocialLoading, setIsSocialLoading] = useState(true);
  const [isSocialSaving, setIsSocialSaving] = useState(false);
  const [showHomepageStats, setShowHomepageStats] = useState(false);
  const [isHomepageStatsLoading, setIsHomepageStatsLoading] = useState(true);
  const [isHomepageStatsSaving, setIsHomepageStatsSaving] = useState(false);

  const [siteAudioSettings, setSiteAudioSettings] = useState<SiteAudioSettingsRow | null>(null);
  const [watermarkForm, setWatermarkForm] = useState<WatermarkSettingsForm>(EMPTY_WATERMARK_FORM);
  const [isWatermarkLoading, setIsWatermarkLoading] = useState(true);
  const [isWatermarkSaving, setIsWatermarkSaving] = useState(false);
  const [isUploadingWatermark, setIsUploadingWatermark] = useState(false);
  const [isEnqueueingReprocess, setIsEnqueueingReprocess] = useState(false);
  const [selectedWatermarkFile, setSelectedWatermarkFile] = useState<File | null>(null);
  const [reprocessStats, setReprocessStats] = useState<ReprocessStats | null>(null);
  const [watermarkPreviewUrl, setWatermarkPreviewUrl] = useState<string | null>(null);

  const currentWatermarkPath = siteAudioSettings?.watermark_audio_path ?? null;
  const lastUpdatedLabel = useMemo(() => {
    if (!siteAudioSettings?.updated_at) return t('admin.settingsPage.never');
    const parsed = new Date(siteAudioSettings.updated_at);
    if (Number.isNaN(parsed.getTime())) return t('common.unknown');
    return formatDateTime(parsed);
  }, [siteAudioSettings?.updated_at, t]);

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
        toast.error(t('admin.settingsPage.socialLoadError'));
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

    const loadHomepageStatsToggle = async () => {
      setIsHomepageStatsLoading(true);
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', HOMEPAGE_STATS_SETTINGS_KEY)
        .maybeSingle();

      if (error) {
        console.error('admin homepage stats settings load error', error);
        toast.error(t('admin.settingsPage.homepageStatsLoadError'));
        setIsHomepageStatsLoading(false);
        return;
      }

      setShowHomepageStats(parseEnabledToggle(data?.value));
      setIsHomepageStatsLoading(false);
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
        toast.error(t('admin.settingsPage.watermarkLoadError'));
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

    void Promise.all([loadSocialLinks(), loadHomepageStatsToggle(), loadSiteAudioSettings()]);
  }, [t]);

  useEffect(() => {
    let isCancelled = false;
    let previewObjectUrl: string | null = null;

    const loadWatermarkPreviewUrl = async () => {
      if (!currentWatermarkPath) {
        setWatermarkPreviewUrl(null);
        return;
      }

      const { data, error } = await supabase.storage
        .from('watermark-assets')
        .download(currentWatermarkPath);

      if (error) {
        console.error('admin watermark preview download error', error);
        if (!isCancelled) {
          setWatermarkPreviewUrl(null);
        }
        return;
      }

      if (!data) {
        if (!isCancelled) {
          setWatermarkPreviewUrl(null);
        }
        return;
      }

      previewObjectUrl = URL.createObjectURL(data);

      if (!isCancelled) {
        setWatermarkPreviewUrl(previewObjectUrl);
      }
    };

    void loadWatermarkPreviewUrl();

    return () => {
      isCancelled = true;
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }
    };
  }, [currentWatermarkPath, siteAudioSettings?.updated_at]);

  const handleSocialSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSocialSaving) return;

    const nextForm: SocialLinksForm = {
      twitter: socialForm.twitter.trim(),
      instagram: socialForm.instagram.trim(),
      youtube: socialForm.youtube.trim(),
    };

    if (!isAllowedUrl(nextForm.twitter) || !isAllowedUrl(nextForm.instagram) || !isAllowedUrl(nextForm.youtube)) {
      toast.error(t('admin.settingsPage.urlsHttpOnly'));
      return;
    }

    setIsSocialSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          key: SOCIAL_SETTINGS_KEY,
          value: nextForm as unknown as Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );

    if (error) {
      console.error('admin social settings save error', error);
      toast.error(t('admin.settingsPage.socialSaveError'));
      setIsSocialSaving(false);
      return;
    }

    setSocialForm(nextForm);
    toast.success(t('admin.settingsPage.socialSaveSuccess'));
    setIsSocialSaving(false);
  };

  const handleHomepageStatsSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isHomepageStatsSaving) return;

    setIsHomepageStatsSaving(true);
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          key: HOMEPAGE_STATS_SETTINGS_KEY,
          value: { enabled: showHomepageStats } as unknown as Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );

    if (error) {
      console.error('admin homepage stats settings save error', error);
      toast.error(t('admin.settingsPage.homepageStatsSaveError'));
      setIsHomepageStatsSaving(false);
      return;
    }

    toast.success(t('admin.settingsPage.homepageStatsSaveSuccess'));
    setIsHomepageStatsSaving(false);
  };

  const handleWatermarkSettingsSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isWatermarkSaving) return;

    const gainDb = asFiniteNumber(watermarkForm.gain_db);
    const minInterval = asFiniteNumber(watermarkForm.min_interval_sec);
    const maxInterval = asFiniteNumber(watermarkForm.max_interval_sec);

    if (gainDb === null || minInterval === null || maxInterval === null) {
      toast.error(t('admin.settingsPage.watermarkNumericError'));
      return;
    }

    if (minInterval < 1 || maxInterval < minInterval) {
      toast.error(t('admin.settingsPage.watermarkIntervalError'));
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
      toast.error(t('admin.settingsPage.watermarkSaveError'));
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

    toast.success(t('admin.settingsPage.watermarkSaveSuccess'));
    setIsWatermarkSaving(false);
  };

  const handleWatermarkUpload = async () => {
    if (!selectedWatermarkFile || isUploadingWatermark) return;

    setIsUploadingWatermark(true);

    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed?.session) {
      toast.error('Authentication expired. Please log in again.');
      setIsUploadingWatermark(false);
      return;
    }
    const token = refreshed.session.access_token;

    const formData = new FormData();
    formData.append('file', selectedWatermarkFile);

    const { data, error } = await supabase.functions.invoke('admin-upload-watermark', {
      body: formData,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (error) {
      console.error('admin-upload-watermark invoke error', error);
      const detailedMessage = await toEdgeInvokeErrorMessage(error);
      toast.error(detailedMessage || t('admin.settingsPage.uploadError'));
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
        ? { ...prev, watermark_audio_path: payload.path ?? null, updated_at: new Date().toISOString() }
        : prev);
    }

    setSelectedWatermarkFile(null);
    toast.success(t('admin.settingsPage.uploadSuccess'));
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
      toast.error(t('admin.settingsPage.reprocessError'));
      setIsEnqueueingReprocess(false);
      return;
    }

    const payload = (data ?? {}) as { enqueued_count?: number; skipped_count?: number };
    const count = Number.isFinite(payload.enqueued_count) ? Number(payload.enqueued_count) : 0;
    const skipped = Number.isFinite(payload.skipped_count) ? Number(payload.skipped_count) : 0;
    setReprocessStats({ enqueued: count, skipped });
    toast.success(t('admin.settingsPage.reprocessSuccess', { count, skipped }));
    setIsEnqueueingReprocess(false);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">{t('admin.settingsPage.watermarkTitle')}</h2>
        <p className="text-zinc-400 text-sm mt-1">
          {t('admin.settingsPage.watermarkSubtitle')}
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
            {t('admin.settingsPage.enabledLabel')}
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <Input
              type="number"
              step="0.1"
              label={t('admin.settingsPage.gainLabel')}
              value={watermarkForm.gain_db}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, gain_db: event.target.value }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
            />
            <Input
              type="number"
              min="1"
              step="1"
              label={t('admin.settingsPage.minIntervalLabel')}
              value={watermarkForm.min_interval_sec}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, min_interval_sec: event.target.value }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
            />
            <Input
              type="number"
              min="1"
              step="1"
              label={t('admin.settingsPage.maxIntervalLabel')}
              value={watermarkForm.max_interval_sec}
              onChange={(event) => setWatermarkForm((prev) => ({ ...prev, max_interval_sec: event.target.value }))}
              disabled={isWatermarkLoading || isWatermarkSaving}
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300 space-y-1">
            <p>
              <span className="text-zinc-500">{t('admin.settingsPage.currentSampleLabel')}:</span>{' '}
              <span className="break-all">{currentWatermarkPath ?? t('admin.settingsPage.noSample')}</span>
            </p>
            {watermarkPreviewUrl && (
              <audio controls src={watermarkPreviewUrl} className="w-full rounded-md" />
            )}
            <p>
              <span className="text-zinc-500">{t('admin.settingsPage.lastUpdatedLabel')}:</span> {lastUpdatedLabel}
            </p>
            {reprocessStats && (
              <>
                <p>
                  <span className="text-zinc-500">{t('admin.settingsPage.jobsEnqueuedLabel')}:</span> {reprocessStats.enqueued}
                </p>
                <p>
                  <span className="text-zinc-500">{t('admin.settingsPage.jobsSkippedLabel')}:</span> {reprocessStats.skipped}
                </p>
              </>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label htmlFor="watermark-file" className="block text-sm font-medium text-zinc-300 mb-1.5">
                {t('admin.settingsPage.uploadLabel')}
              </label>
              <input
                id="watermark-file"
                type="file"
                accept="audio/wav,audio/x-wav,audio/wave"
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
              {t('admin.settingsPage.uploadAction')}
            </Button>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" isLoading={isWatermarkLoading || isWatermarkSaving}>
              {t('admin.settingsPage.saveWatermark')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleEnqueueReprocess}
              isLoading={isEnqueueingReprocess}
              disabled={isEnqueueingReprocess}
            >
              {t('admin.settingsPage.reprocessAction')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">{t('admin.settingsPage.homepageStatsTitle')}</h2>
        <p className="text-zinc-400 text-sm mt-1">
          {t('admin.settingsPage.homepageStatsSubtitle')}
        </p>

        <form onSubmit={handleHomepageStatsSave} className="mt-6 space-y-4">
          <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={showHomepageStats}
              onChange={(event) => setShowHomepageStats(event.target.checked)}
              disabled={isHomepageStatsLoading || isHomepageStatsSaving}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/50"
            />
            {t('admin.settingsPage.homepageStatsLabel')}
          </label>

          <div className="pt-2">
            <Button
              type="submit"
              isLoading={isHomepageStatsSaving}
              disabled={isHomepageStatsLoading || isHomepageStatsSaving}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">{t('admin.settingsPage.socialTitle')}</h2>
        <p className="text-zinc-400 text-sm mt-1">
          {t('admin.settingsPage.socialSubtitle')}
        </p>

        <form onSubmit={handleSocialSave} className="mt-6 space-y-4">
          <Input
            type="url"
            label={t('admin.settingsPage.twitterLabel')}
            value={socialForm.twitter}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, twitter: event.target.value }))}
            placeholder={t('admin.settingsPage.twitterPlaceholder')}
            disabled={isSocialLoading || isSocialSaving}
          />
          <Input
            type="url"
            label={t('admin.settingsPage.instagramLabel')}
            value={socialForm.instagram}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, instagram: event.target.value }))}
            placeholder={t('admin.settingsPage.instagramPlaceholder')}
            disabled={isSocialLoading || isSocialSaving}
          />
          <Input
            type="url"
            label={t('admin.settingsPage.youtubeLabel')}
            value={socialForm.youtube}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, youtube: event.target.value }))}
            placeholder={t('admin.settingsPage.youtubePlaceholder')}
            disabled={isSocialLoading || isSocialSaving}
          />

          <div className="pt-2">
            <Button type="submit" isLoading={isSocialLoading || isSocialSaving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
