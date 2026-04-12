import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Pause, Play } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useAudioPlayer } from '../../context/AudioPlayerContext';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { invokeWithAuth } from '@/lib/supabase/invokeWithAuth';
import { useMaintenanceModeContext } from '../../lib/supabase/MaintenanceModeContext';
import type { Json } from '../../lib/supabase/database.types';
import type { PricingVisibility } from '../../lib/supabase/useMaintenanceMode';
import { formatDateTime } from '../../lib/utils/format';

const SOCIAL_SETTINGS_KEY = 'social_links';
const SITE_AUDIO_SETTINGS_TABLE = 'site_audio_settings' as const;
const AI_AUTO_EXEC_KEY = 'ai_auto_execution';

interface SocialLinksForm {
  twitter: string;
  instagram: string;
  youtube: string;
  tiktok: string;
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

interface AiAutoExecutionSettings {
  enabled: boolean;
  confidence_threshold: number;
  auto_validate: boolean;
  auto_cancel: boolean;
}

interface AiAutoExecRunResult {
  ok: boolean;
  reason?: string;
  executed: number;
  failed: number;
  skipped: number;
  threshold?: number;
}

const DEFAULT_AI_AUTO_EXEC: AiAutoExecutionSettings = {
  enabled: false,
  confidence_threshold: 0.85,
  auto_validate: true,
  auto_cancel: false,
};

interface ReprocessStats {
  enqueued: number;
  skipped: number;
}

interface VisibilityToggleFieldConfig {
  key: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface VisibilityToggleCardConfig {
  key: string;
  title: string;
  subtitle: string;
  toggles: VisibilityToggleFieldConfig[];
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  isSaving: boolean;
}

const EMPTY_FORM: SocialLinksForm = {
  twitter: '',
  instagram: '',
  youtube: '',
  tiktok: '',
};

const EMPTY_WATERMARK_FORM: WatermarkSettingsForm = {
  enabled: true,
  gain_db: '-10',
  min_interval_sec: '20',
  max_interval_sec: '45',
};

const URL_PROTOCOL_REGEX = /^[a-z][a-z\d+.-]*:/i;

const sanitizeUrl = (value?: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  const fixed = trimmed.replace('https:,//', 'https://');
  const candidate = URL_PROTOCOL_REGEX.test(fixed) ? fixed : `https://${fixed}`;

  try {
    const parsed = new URL(candidate);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
};

const isAllowedUrl = (value: string) => value.length === 0 || sanitizeUrl(value) !== null;

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

export function AdminSettingsPage() {
  const { currentTrack, isPlaying, playTrack } = useAudioPlayer();
  const { t } = useTranslation();
  const {
    showHomepageStats: storedShowHomepageStats,
    showUserPremiumCredits: storedShowUserPremiumCredits,
    pricingVisibility: storedPricingVisibility,
    isLoading: isPublicSettingsLoading,
    error: publicSettingsError,
    updateHomepageStatsVisibility,
    updateUserPremiumCreditsVisibility,
    updatePricingPlansVisibility,
  } = useMaintenanceModeContext();
  const [socialForm, setSocialForm] = useState<SocialLinksForm>(EMPTY_FORM);
  const [isSocialLoading, setIsSocialLoading] = useState(true);
  const [isSocialSaving, setIsSocialSaving] = useState(false);
  const [showHomepageStatsInput, setShowHomepageStatsInput] = useState(storedShowHomepageStats);
  const [isHomepageStatsSaving, setIsHomepageStatsSaving] = useState(false);
  const [showUserPremiumCreditsInput, setShowUserPremiumCreditsInput] = useState(storedShowUserPremiumCredits);
  const [isUserPremiumCreditsSaving, setIsUserPremiumCreditsSaving] = useState(false);
  const [pricingVisibilityInput, setPricingVisibilityInput] = useState<PricingVisibility>(storedPricingVisibility);
  const [isPricingPlansSaving, setIsPricingPlansSaving] = useState(false);

  const [siteAudioSettings, setSiteAudioSettings] = useState<SiteAudioSettingsRow | null>(null);
  const [watermarkForm, setWatermarkForm] = useState<WatermarkSettingsForm>(EMPTY_WATERMARK_FORM);
  const [isWatermarkLoading, setIsWatermarkLoading] = useState(true);
  const [isWatermarkSaving, setIsWatermarkSaving] = useState(false);
  const [isUploadingWatermark, setIsUploadingWatermark] = useState(false);
  const [isEnqueueingReprocess, setIsEnqueueingReprocess] = useState(false);
  const [selectedWatermarkFile, setSelectedWatermarkFile] = useState<File | null>(null);
  const [reprocessStats, setReprocessStats] = useState<ReprocessStats | null>(null);
  const [watermarkPreviewUrl, setWatermarkPreviewUrl] = useState<string | null>(null);

  const [aiAutoExecSettings, setAiAutoExecSettings] = useState<AiAutoExecutionSettings>(DEFAULT_AI_AUTO_EXEC);
  const [isAiAutoExecLoading, setIsAiAutoExecLoading] = useState(true);
  const [isAiAutoExecSaving, setIsAiAutoExecSaving] = useState(false);
  const [isAiAutoExecRunning, setIsAiAutoExecRunning] = useState(false);
  const [aiAutoExecRunResult, setAiAutoExecRunResult] = useState<AiAutoExecRunResult | null>(null);
  const isWatermarkPreviewActive = (currentTrack?.id?.startsWith('admin-watermark-preview-') ?? false) && isPlaying;

  const currentWatermarkPath = siteAudioSettings?.watermark_audio_path ?? null;
  const lastUpdatedLabel = useMemo(() => {
    if (!siteAudioSettings?.updated_at) return t('admin.settingsPage.never');
    const parsed = new Date(siteAudioSettings.updated_at);
    if (Number.isNaN(parsed.getTime())) return t('common.unknown');
    return formatDateTime(parsed);
  }, [siteAudioSettings?.updated_at, t]);

  useEffect(() => {
    if (!isHomepageStatsSaving) {
      setShowHomepageStatsInput(storedShowHomepageStats);
    }
  }, [isHomepageStatsSaving, storedShowHomepageStats]);

  useEffect(() => {
    if (!isUserPremiumCreditsSaving) {
      setShowUserPremiumCreditsInput(storedShowUserPremiumCredits);
    }
  }, [isUserPremiumCreditsSaving, storedShowUserPremiumCredits]);

  useEffect(() => {
    if (!isPricingPlansSaving) {
      setPricingVisibilityInput(storedPricingVisibility);
    }
  }, [isPricingPlansSaving, storedPricingVisibility]);

  useEffect(() => {
    if (!publicSettingsError) {
      return;
    }

    toast.error(t('admin.settingsPage.publicSettingsLoadError'));
  }, [publicSettingsError, t]);

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
        twitter: sanitizeUrl(parsed.twitter) ?? '',
        instagram: sanitizeUrl(parsed.instagram) ?? '',
        youtube: sanitizeUrl(parsed.youtube) ?? '',
        tiktok: sanitizeUrl(parsed.tiktok) ?? '',
      });
      setIsSocialLoading(false);
    };

    const loadSiteAudioSettings = async () => {
      setIsWatermarkLoading(true);
      const { data, error } = await supabase
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

    const loadAiAutoExecSettings = async () => {
      setIsAiAutoExecLoading(true);
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', AI_AUTO_EXEC_KEY)
        .maybeSingle();

      if (error) {
        console.error('admin ai_auto_execution load error', error);
        setIsAiAutoExecLoading(false);
        return;
      }

      const payload = data?.value;
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        setAiAutoExecSettings({
          enabled: Boolean(p.enabled),
          confidence_threshold: typeof p.confidence_threshold === 'number' ? p.confidence_threshold : 0.85,
          auto_validate: typeof p.auto_validate === 'boolean' ? p.auto_validate : true,
          auto_cancel: typeof p.auto_cancel === 'boolean' ? p.auto_cancel : false,
        });
      }
      setIsAiAutoExecLoading(false);
    };

    void Promise.all([loadSocialLinks(), loadSiteAudioSettings(), loadAiAutoExecSettings()]);
  }, [t]);

  const handlePlayWatermarkPreview = () => {
    if (!watermarkPreviewUrl) {
      return;
    }

    playTrack({
      id: `admin-watermark-preview-${siteAudioSettings?.updated_at ?? 'default'}`,
      title: t('admin.settingsPage.currentSampleLabel'),
      audioUrl: watermarkPreviewUrl,
    });
  };

  useEffect(() => {
    let isCancelled = false;

    const loadWatermarkPreviewUrl = async () => {
      if (!currentWatermarkPath) {
        setWatermarkPreviewUrl(null);
        return;
      }

      const { data, error } = await supabase.storage
        .from('watermark-assets')
        .createSignedUrl(currentWatermarkPath, 24 * 60 * 60);

      if (error) {
        console.error('admin watermark preview signed URL error', error);
        if (!isCancelled) {
          setWatermarkPreviewUrl(null);
        }
        return;
      }

      const signedUrl = data?.signedUrl;
      if (!signedUrl) {
        if (!isCancelled) {
          setWatermarkPreviewUrl(null);
        }
        return;
      }

      const previewUrl = new URL(signedUrl);
      if (siteAudioSettings?.updated_at) {
        previewUrl.searchParams.set('t', siteAudioSettings.updated_at);
      }

      if (!isCancelled) {
        setWatermarkPreviewUrl(previewUrl.toString());
      }
    };

    void loadWatermarkPreviewUrl();

    return () => {
      isCancelled = true;
      setWatermarkPreviewUrl(null);
    };
  }, [currentWatermarkPath, siteAudioSettings?.updated_at]);

  const handleSocialSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSocialSaving) return;

    const rawForm: SocialLinksForm = {
      twitter: socialForm.twitter.trim(),
      instagram: socialForm.instagram.trim(),
      youtube: socialForm.youtube.trim(),
      tiktok: socialForm.tiktok.trim(),
    };

    if (!isAllowedUrl(rawForm.twitter) || !isAllowedUrl(rawForm.instagram) || !isAllowedUrl(rawForm.youtube) || !isAllowedUrl(rawForm.tiktok)) {
      toast.error(t('admin.settingsPage.urlsHttpOnly'));
      return;
    }

    const nextForm: SocialLinksForm = {
      twitter: sanitizeUrl(rawForm.twitter) ?? '',
      instagram: sanitizeUrl(rawForm.instagram) ?? '',
      youtube: sanitizeUrl(rawForm.youtube) ?? '',
      tiktok: sanitizeUrl(rawForm.tiktok) ?? '',
    };

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
    if (isHomepageStatsSaving || isPublicSettingsLoading) return;

    setIsHomepageStatsSaving(true);
    try {
      await updateHomepageStatsVisibility(showHomepageStatsInput);
      toast.success(t('admin.settingsPage.homepageStatsSaveSuccess'));
    } catch (error) {
      console.error('admin homepage stats settings save error', error);
      toast.error(t('admin.settingsPage.homepageStatsSaveError'));
    } finally {
      setIsHomepageStatsSaving(false);
    }
  };

  const handleUserPremiumCreditsSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isUserPremiumCreditsSaving || isPublicSettingsLoading) return;

    setIsUserPremiumCreditsSaving(true);
    try {
      await updateUserPremiumCreditsVisibility(showUserPremiumCreditsInput);
      toast.success(t('admin.settingsPage.pricingPlansSaveSuccess'));
    } catch (error) {
      console.error('admin user premium credits visibility save error', error);
      toast.error(t('admin.settingsPage.pricingPlansSaveError'));
    } finally {
      setIsUserPremiumCreditsSaving(false);
    }
  };

  const handlePricingPlansSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPricingPlansSaving || isPublicSettingsLoading) return;

    setIsPricingPlansSaving(true);
    try {
      await updatePricingPlansVisibility(pricingVisibilityInput);
      toast.success(t('admin.settingsPage.pricingPlansSaveSuccess'));
    } catch (error) {
      console.error('admin pricing plans settings save error', error);
      toast.error(t('admin.settingsPage.pricingPlansSaveError'));
    } finally {
      setIsPricingPlansSaving(false);
    }
  };

  const setPricingPlanVisibility = (key: keyof PricingVisibility, checked: boolean) => {
    setPricingVisibilityInput((prev) => ({ ...prev, [key]: checked }));
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
      ? supabase
          .from(SITE_AUDIO_SETTINGS_TABLE)
          .update(payload)
          .eq('id', siteAudioSettings.id)
      : supabase
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
    setWatermarkPreviewUrl(null);
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
      setWatermarkPreviewUrl(null);
      setSiteAudioSettings(payload.settings);
      setWatermarkForm({
        enabled: Boolean(payload.settings.enabled),
        gain_db: String(payload.settings.gain_db ?? watermarkForm.gain_db),
        min_interval_sec: String(payload.settings.min_interval_sec ?? watermarkForm.min_interval_sec),
        max_interval_sec: String(payload.settings.max_interval_sec ?? watermarkForm.max_interval_sec),
      });
    } else if (payload.path) {
      setWatermarkPreviewUrl(null);
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

    try {
      const { data, error } = await invokeWithAuth('enqueue-preview-reprocess', {});

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
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('admin.settingsPage.reprocessError');
      toast.error(errorMsg);
    }
    setIsEnqueueingReprocess(false);
  };

  const handleAiAutoExecSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsAiAutoExecSaving(true);

    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          key: AI_AUTO_EXEC_KEY,
          value: {
            enabled: aiAutoExecSettings.enabled,
            confidence_threshold: aiAutoExecSettings.confidence_threshold,
            auto_validate: aiAutoExecSettings.auto_validate,
            auto_cancel: aiAutoExecSettings.auto_cancel,
          } as unknown as Json,
        },
        { onConflict: 'key' }
      );

    if (error) {
      console.error('admin ai_auto_execution save error', error);
      toast.error('Erreur lors de la sauvegarde des paramètres IA.');
    } else {
      toast.success('Paramètres d\'auto-exécution IA sauvegardés.');
    }

    setIsAiAutoExecSaving(false);
  };

  const handleAiAutoExecRunNow = async () => {
    setIsAiAutoExecRunning(true);
    setAiAutoExecRunResult(null);

    const { data, error } = await supabase.rpc(
      'agent_auto_execute_ai_battle_actions' as any,
      { p_limit: 50 }
    );

    if (error) {
      console.error('agent_auto_execute_ai_battle_actions failed:', error);
      toast.error(`Erreur : ${error.message}`);
      setIsAiAutoExecRunning(false);
      return;
    }

    const result = (data ?? {}) as AiAutoExecRunResult;
    setAiAutoExecRunResult(result);

    if (!result.ok) {
      toast.error(result.reason ?? 'Échec de l\'auto-exécution.');
    } else if (result.reason === 'auto_execution_disabled') {
      toast.error('L\'auto-exécution est désactivée dans les paramètres.');
    } else {
      toast.success(
        `Terminé — exécutés : ${result.executed}, échoués : ${result.failed}, ignorés : ${result.skipped}`
      );
    }

    setIsAiAutoExecRunning(false);
  };

  const visibilityToggleCards: VisibilityToggleCardConfig[] = [
    {
      key: 'homepage-stats',
      title: t('admin.settingsPage.homepageStatsTitle'),
      subtitle: t('admin.settingsPage.homepageStatsSubtitle'),
      toggles: [
        {
          key: 'homepage-stats-toggle',
          label: t('admin.settingsPage.homepageStatsLabel'),
          checked: showHomepageStatsInput,
          onChange: setShowHomepageStatsInput,
        },
      ],
      onSubmit: handleHomepageStatsSave,
      isSaving: isHomepageStatsSaving,
    },
    {
      key: 'user-premium-credits',
      title: t('admin.settingsPage.pricingPlanUserPremiumLabel'),
      subtitle: t('admin.settingsPage.pricingPlansSubtitle'),
      toggles: [
        {
          key: 'user-premium-credits-toggle',
          label: 'Affichage des crédits',
          checked: showUserPremiumCreditsInput,
          onChange: setShowUserPremiumCreditsInput,
        },
      ],
      onSubmit: handleUserPremiumCreditsSave,
      isSaving: isUserPremiumCreditsSaving,
    },
    {
      key: 'pricing-plans',
      title: t('admin.settingsPage.pricingPlansTitle'),
      subtitle: t('admin.settingsPage.pricingPlansSubtitle'),
      toggles: [
        {
          key: 'pricing-plan-free',
          label: t('admin.settingsPage.pricingPlanFreeLabel'),
          checked: pricingVisibilityInput.free,
          onChange: (checked) => setPricingPlanVisibility('free', checked),
        },
        {
          key: 'pricing-plan-user-premium',
          label: t('admin.settingsPage.pricingPlanUserPremiumLabel'),
          checked: pricingVisibilityInput.userPremium,
          onChange: (checked) => setPricingPlanVisibility('userPremium', checked),
        },
        {
          key: 'pricing-plan-producer',
          label: t('admin.settingsPage.pricingPlanProducerLabel'),
          checked: pricingVisibilityInput.producer,
          onChange: (checked) => setPricingPlanVisibility('producer', checked),
        },
        {
          key: 'pricing-plan-producer-elite',
          label: t('admin.settingsPage.pricingPlanProducerEliteLabel'),
          checked: pricingVisibilityInput.producerElite,
          onChange: (checked) => setPricingPlanVisibility('producerElite', checked),
        },
      ],
      onSubmit: handlePricingPlansSave,
      isSaving: isPricingPlansSaving,
    },
  ];

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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePlayWatermarkPreview}
                leftIcon={
                  isWatermarkPreviewActive ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )
                }
              >
                {isWatermarkPreviewActive ? t('common.pause') : t('common.play')}
              </Button>
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

      {visibilityToggleCards.map((card) => (
        <Card key={card.key} className="p-6 border-zinc-800">
          <h2 className="text-xl font-semibold text-white">{card.title}</h2>
          <p className="text-zinc-400 text-sm mt-1">
            {card.subtitle}
          </p>

          <form onSubmit={card.onSubmit} className="mt-6 space-y-4">
            {card.toggles.map((toggle) => (
              <label
                key={toggle.key}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200"
              >
                <input
                  type="checkbox"
                  checked={toggle.checked}
                  onChange={(event) => toggle.onChange(event.target.checked)}
                  disabled={isPublicSettingsLoading || card.isSaving}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/50"
                />
                {toggle.label}
              </label>
            ))}

            <div className="pt-2">
              <Button
                type="submit"
                isLoading={card.isSaving}
                disabled={isPublicSettingsLoading || card.isSaving}
              >
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Card>
      ))}

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
          <Input
            type="url"
            label={t('admin.settingsPage.tiktokLabel')}
            value={socialForm.tiktok}
            onChange={(event) => setSocialForm((prev) => ({ ...prev, tiktok: event.target.value }))}
            placeholder={t('admin.settingsPage.tiktokPlaceholder')}
            disabled={isSocialLoading || isSocialSaving}
          />

          <div className="pt-2">
            <Button type="submit" isLoading={isSocialLoading || isSocialSaving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6 border-zinc-800">
        <h2 className="text-xl font-semibold text-white">Auto-exécution IA</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Quand activée, l'IA exécute automatiquement les actions proposées dont le score de confiance
          dépasse le seuil. Le cron appelle{' '}
          <code className="text-xs text-rose-400">agent-auto-execute-ai-actions</code>. Le bouton
          ci-dessous permet de lancer une passe manuellement.
        </p>

        <form onSubmit={(e) => void handleAiAutoExecSave(e)} className="mt-6 space-y-4">
          <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={aiAutoExecSettings.enabled}
              onChange={(e) => setAiAutoExecSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
              disabled={isAiAutoExecLoading || isAiAutoExecSaving}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/50"
            />
            Activer l'auto-exécution
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Seuil de confiance (0–1)
              </label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={String(aiAutoExecSettings.confidence_threshold)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) {
                    setAiAutoExecSettings((prev) => ({ ...prev, confidence_threshold: v }));
                  }
                }}
                disabled={isAiAutoExecLoading || isAiAutoExecSaving}
              />
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200 self-end">
              <input
                type="checkbox"
                checked={aiAutoExecSettings.auto_validate}
                onChange={(e) => setAiAutoExecSettings((prev) => ({ ...prev, auto_validate: e.target.checked }))}
                disabled={isAiAutoExecLoading || isAiAutoExecSaving}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/50"
              />
              Auto-valider les battles
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-200 self-end">
              <input
                type="checkbox"
                checked={aiAutoExecSettings.auto_cancel}
                onChange={(e) => setAiAutoExecSettings((prev) => ({ ...prev, auto_cancel: e.target.checked }))}
                disabled={isAiAutoExecLoading || isAiAutoExecSaving}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-rose-500/50"
              />
              Auto-annuler les battles
            </label>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" isLoading={isAiAutoExecLoading || isAiAutoExecSaving}>
              {t('common.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleAiAutoExecRunNow()}
              isLoading={isAiAutoExecRunning}
              disabled={isAiAutoExecRunning}
            >
              Lancer maintenant
            </Button>
          </div>
        </form>

        {aiAutoExecRunResult && (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm space-y-1">
            <p className="text-zinc-400 font-medium">Dernier résultat</p>
            {aiAutoExecRunResult.reason && (
              <p className="text-amber-400">{aiAutoExecRunResult.reason}</p>
            )}
            <div className="flex gap-6 text-zinc-300">
              <span>✓ exécutés : <strong>{aiAutoExecRunResult.executed}</strong></span>
              <span>✗ échoués : <strong>{aiAutoExecRunResult.failed}</strong></span>
              <span>— ignorés : <strong>{aiAutoExecRunResult.skipped}</strong></span>
              {aiAutoExecRunResult.threshold !== undefined && (
                <span className="text-zinc-500">seuil : {aiAutoExecRunResult.threshold}</span>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
