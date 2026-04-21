import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth/hooks';
import { useCreditBalance } from '../lib/credits/useCreditBalance';
import { useTranslation } from '../lib/i18n';
import { updateProfile, updatePassword } from '../lib/auth/service';
import { supabase } from '@/lib/supabase/client';
import { invokeProtectedEdgeFunction } from '../lib/supabase/edgeAuth';
import { useUserSubscriptionStatus } from '../lib/subscriptions/useUserSubscriptionStatus';
import { extractStoragePathFromCandidate } from '../lib/utils/storage';
import { formatDate, formatPrice } from '../lib/utils/format';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { AlertTriangle, User, Lock, Globe, Save, Camera, Instagram, Youtube, Cloud, Music2, Disc3 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PrivateAccessCard } from '../components/account/PrivateAccessCard';

const AVATAR_BUCKET = import.meta.env.VITE_SUPABASE_AVATAR_BUCKET || 'avatars';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_SOCIAL_LINK_LENGTH = 255;
const CREDIT_VALUE_CENTS = 1000;

type SocialLinkKey = 'instagram' | 'youtube' | 'soundcloud' | 'tiktok' | 'spotify';

type DeleteAccountRpcResult = {
  success?: unknown;
  status?: unknown;
  message?: unknown;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const formatDeleteAccountError = (error: unknown, fallbackMessage: string): string => {
  if (!isObjectRecord(error)) {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim();
    }
    return fallbackMessage;
  }

  const message =
    typeof error.message === 'string' && error.message.trim().length > 0
      ? error.message.trim()
      : fallbackMessage;

  const details = typeof error.details === 'string' && error.details.trim().length > 0
    ? error.details.trim()
    : null;
  const hint = typeof error.hint === 'string' && error.hint.trim().length > 0
    ? error.hint.trim()
    : null;
  const code = typeof error.code === 'string' && error.code.trim().length > 0
    ? error.code.trim()
    : null;

  const metaParts = [
    details,
    hint ? `hint: ${hint}` : null,
    code ? `code: ${code}` : null,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);

  if (metaParts.length === 0) {
    return message;
  }

  return `${message} (${metaParts.join(' | ')})`;
};

export function SettingsPage() {
  const navigate = useNavigate();
  const { profile, user, refreshProfile, signOut } = useAuth();
  const { t, language, updateLanguage } = useTranslation();
  const { balance: creditBalance, isLoading: isCreditBalanceLoading } = useCreditBalance(user?.id);
  const { subscription: userSubscription } = useUserSubscriptionStatus(user?.id);
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'preferences'>('profile');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [profileData, setProfileData] = useState({
    username: profile?.username || '',
    full_name: profile?.full_name || '',
    bio: profile?.bio || '',
    website_url: profile?.website_url || '',
  });

  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountReason, setDeleteAccountReason] = useState('');
  const [deleteAccountConfirmInput, setDeleteAccountConfirmInput] = useState('');
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(profile?.avatar_url || '');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [localAvatarObjectUrl, setLocalAvatarObjectUrl] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [socialLinksData, setSocialLinksData] = useState<Record<SocialLinkKey, string>>(() => {
    const links = profile?.social_links || {};
    return {
      instagram: typeof links.instagram === 'string' ? links.instagram : '',
      youtube: typeof links.youtube === 'string' ? links.youtube : '',
      soundcloud: typeof links.soundcloud === 'string' ? links.soundcloud : '',
      tiktok: typeof links.tiktok === 'string' ? links.tiktok : '',
      spotify: typeof links.spotify === 'string' ? links.spotify : '',
    };
  });

  useEffect(() => {
    if (!selectedAvatarFile) {
      setAvatarPreviewUrl(profile?.avatar_url || '');
    }
  }, [profile?.avatar_url, selectedAvatarFile]);

  useEffect(() => {
    const links = profile?.social_links || {};
    setSocialLinksData({
      instagram: typeof links.instagram === 'string' ? links.instagram : '',
      youtube: typeof links.youtube === 'string' ? links.youtube : '',
      soundcloud: typeof links.soundcloud === 'string' ? links.soundcloud : '',
      tiktok: typeof links.tiktok === 'string' ? links.tiktok : '',
      spotify: typeof links.spotify === 'string' ? links.spotify : '',
    });
  }, [profile?.id, profile?.social_links]);

  useEffect(() => {
    return () => {
      if (localAvatarObjectUrl) {
        URL.revokeObjectURL(localAvatarObjectUrl);
      }
    };
  }, [localAvatarObjectUrl]);

  const getAvatarExtension = (file: File) => {
    if (file.type === 'image/jpeg') return 'jpg';
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    if (file.type === 'image/gif') return 'gif';
    const fileNameParts = file.name.split('.');
    const fromName = fileNameParts.length > 1 ? fileNameParts.pop() : null;
    return (fromName || 'jpg').toLowerCase();
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarError(t('settings.avatarMustBeImage'));
      toast.error(t('settings.avatarMustBeImage'));
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError(t('settings.avatarTooLarge'));
      toast.error(t('settings.avatarTooLarge'));
      return;
    }

    if (localAvatarObjectUrl) {
      URL.revokeObjectURL(localAvatarObjectUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    setLocalAvatarObjectUrl(previewUrl);
    setSelectedAvatarFile(file);
    setAvatarPreviewUrl(previewUrl);
    setAvatarError(null);
  };

  const uploadAvatarAndGetUrl = async (file: File) => {
    if (!profile?.id) {
      throw new Error(t('settings.userNotAuthenticated'));
    }

    setIsAvatarUploading(true);
    setAvatarError(null);

    try {
      const previousAvatarPath = extractStoragePathFromCandidate(profile.avatar_url, AVATAR_BUCKET);
      if (previousAvatarPath) {
        const { error: removeError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .remove([previousAvatarPath]);
        if (removeError) {
          console.warn('avatar remove warning', removeError);
        }
      }

      const extension = getAvatarExtension(file);
      const avatarPath = `${profile.id}/avatar.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(avatarPath, file, { upsert: true, cacheControl: '3600' });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(avatarPath);

      if (!publicData?.publicUrl) {
        throw new Error(t('settings.avatarPublicUrlError'));
      }

      return `${publicData.publicUrl}?v=${Date.now()}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.avatarUploadError');
      setAvatarError(message);
      throw error;
    } finally {
      setIsAvatarUploading(false);
    }
  };

  const normalizeSocialLink = (value: string, label: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (trimmed.toLowerCase().includes('javascript:')) {
      throw new Error(t('settings.socialLinkInvalid', { label }));
    }

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (withProtocol.length > MAX_SOCIAL_LINK_LENGTH) {
      throw new Error(
        t('settings.socialLinkTooLong', { label, max: MAX_SOCIAL_LINK_LENGTH })
      );
    }

    return withProtocol;
  };

  const buildNormalizedSocialLinks = () => {
    return {
      instagram: normalizeSocialLink(socialLinksData.instagram, 'Instagram'),
      youtube: normalizeSocialLink(socialLinksData.youtube, 'YouTube'),
      soundcloud: normalizeSocialLink(socialLinksData.soundcloud, 'SoundCloud'),
      tiktok: normalizeSocialLink(socialLinksData.tiktok, 'TikTok'),
      spotify: normalizeSocialLink(socialLinksData.spotify, 'Spotify'),
    };
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const normalizedSocialLinks = buildNormalizedSocialLinks();

      let avatarUrl = profile?.avatar_url || undefined;
      if (selectedAvatarFile) {
        avatarUrl = await uploadAvatarAndGetUrl(selectedAvatarFile);
      }

      await updateProfile({
        username: profileData.username,
        full_name: profileData.full_name,
        bio: profileData.bio,
        website_url: profileData.website_url,
        avatar_url: avatarUrl,
      });

      if (profile?.id) {
        const { error: socialLinksUpdateError } = await supabase
          .from('user_profiles')
          .update({ social_links: normalizedSocialLinks })
          .eq('id', profile.id);

        if (socialLinksUpdateError) {
          throw socialLinksUpdateError;
        }
      }

      await refreshProfile();
      if (localAvatarObjectUrl) {
        URL.revokeObjectURL(localAvatarObjectUrl);
        setLocalAvatarObjectUrl(null);
      }
      setSelectedAvatarFile(null);
      setAvatarError(null);
      setAvatarPreviewUrl(avatarUrl || '');
      setSocialLinksData({
        instagram: normalizedSocialLinks.instagram || '',
        youtube: normalizedSocialLinks.youtube || '',
        soundcloud: normalizedSocialLinks.soundcloud || '',
        tiktok: normalizedSocialLinks.tiktok || '',
        spotify: normalizedSocialLinks.spotify || '',
      });
      toast.success(t('settings.profileUpdateSuccess'));
    } catch (error) {
      console.error('Error updating profile', error);
      const message = error instanceof Error ? error.message : t('settings.profileUpdateError');
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error(t('auth.passwordMismatch'));
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast.error(t('auth.weakPassword'));
      return;
    }

    setIsLoading(true);

    try {
      await updatePassword(passwordData.newPassword);
      toast.success(t('settings.passwordUpdateSuccess'));
      setPasswordData({ newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error updating password', error);
      toast.error(t('settings.passwordUpdateError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLanguageChange = async (newLanguage: string) => {
    try {
      await updateLanguage(newLanguage);
      toast.success(t('settings.languageUpdateSuccess'));
    } catch (error) {
      console.error('Error updating language', error);
      toast.error(t('settings.languageUpdateError'));
    }
  };

  const closeDeleteAccountModal = () => {
    if (isDeletingAccount) return;
    setIsDeleteAccountModalOpen(false);
    setDeleteAccountReason('');
    setDeleteAccountConfirmInput('');
  };

  const handleDeleteMyAccount = async () => {
    if (!profile?.id) {
      toast.error(t('settings.userNotAuthenticated'));
      return;
    }

    if (deleteAccountConfirmInput.trim().toUpperCase() !== 'SUPPRIMER') {
      toast.error(t('settings.deleteAccountConfirmationError'));
      return;
    }

    setIsDeletingAccount(true);

    try {
      const reason = deleteAccountReason.trim();
      const rpcResponse = await supabase.rpc('delete_my_account', {
        p_reason: reason.length > 0 ? reason : null,
      });
      console.info('delete_my_account response:', rpcResponse);

      const { data, error } = rpcResponse;

      if (error) {
        throw error;
      }

      const rpcResult = (Array.isArray(data) ? data[0] : data) as DeleteAccountRpcResult | undefined;
      if (!isObjectRecord(rpcResult)) {
        throw new Error('delete_my_account returned an invalid payload');
      }

      if (rpcResult.success !== true) {
        const failureMessage =
          typeof rpcResult.message === 'string' && rpcResult.message.trim().length > 0
            ? rpcResult.message.trim()
            : t('settings.deleteAccountError');
        throw new Error(failureMessage);
      }

      const successMessage =
        typeof rpcResult.message === 'string' && rpcResult.message.trim().length > 0
          ? rpcResult.message.trim()
          : t('settings.deleteAccountSuccess');

      toast.success(successMessage);
      setIsDeleteAccountModalOpen(false);
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('delete_my_account error:', error);
      toast.error(formatDeleteAccountError(error, t('settings.deleteAccountError')));
    } finally {
      setIsDeletingAccount(false);
      setDeleteAccountReason('');
      setDeleteAccountConfirmInput('');
    }
  };

  const tabs = [
    { id: 'profile', label: t('user.profile'), icon: User },
    { id: 'security', label: t('settings.tabSecurity'), icon: Lock },
    { id: 'preferences', label: t('settings.tabPreferences'), icon: Globe },
  ];
  const creditValueCents = typeof creditBalance === 'number'
    ? Math.max(creditBalance, 0) * CREDIT_VALUE_CENTS
    : null;
  const hasActiveUserSubscription = userSubscription?.subscription_status === 'active';
  const subscriptionPlanLabel = userSubscription?.plan_code === 'user_monthly'
    ? t('pricing.userPremiumTitle')
    : userSubscription?.plan_code ?? t('dashboard.userSubscriptionStatus');
  const nextRenewalLabel = userSubscription?.current_period_end
    ? formatDate(userSubscription.current_period_end, language)
    : null;

  const openPortal = async () => {
    setPortalError(null);
    setIsPortalLoading(true);

    try {
      const returnUrl = `${window.location.origin}/settings`;
      const data = await invokeProtectedEdgeFunction<{ url?: string; error?: string }>(
        'create-portal-session',
        {
          body: { returnUrl },
        }
      );

      if (data?.error?.includes('no_stripe_customer')) {
        setPortalError(t('producerDashboard.noLinkedSubscription'));
        return;
      }

      if (!data?.url) {
        throw new Error(t('producerDashboard.portalUrlMissing'));
      }

      window.location.assign(data.url);
    } catch (error) {
      console.error('Error opening Stripe billing portal', error);
      const rawMessage = error instanceof Error ? error.message : '';
      if (rawMessage.includes('no_stripe_customer')) {
        setPortalError(t('producerDashboard.noLinkedSubscription'));
        return;
      }
      const isFunctionNetworkError = rawMessage.includes('Failed to send a request to the Edge Function');
      setPortalError(
        isFunctionNetworkError
          ? t('producerDashboard.portalFunctionUnavailable')
          : error instanceof Error
            ? error.message
            : t('producerDashboard.portalSubscriptionError')
      );
    } finally {
      setIsPortalLoading(false);
    }
  };

  return (
    <div className="pt-20 pb-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t('nav.settings')}</h1>
          <p className="text-zinc-400">{t('settings.subtitle')}</p>
        </div>

        <div className="flex gap-4 mb-6 border-b border-zinc-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-rose-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'profile' && (
          <div className="space-y-6">
            <PrivateAccessCard profile={profile} />

            {hasActiveUserSubscription && (
              <Card className="p-6">
                <div className="space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white">{t('dashboard.userSubscriptionStatus')}</h2>
                    <p className="mt-1 text-sm text-zinc-400">{subscriptionPlanLabel}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                      <p className="text-sm font-medium text-zinc-300">{t('dashboard.subscriptionStatus')}</p>
                      <p className="mt-1 text-sm text-emerald-300">{t('dashboard.userSubscriptionActive')}</p>
                    </div>
                    {nextRenewalLabel && (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                        <p className="text-sm font-medium text-zinc-300">{t('dashboard.userSubscriptionRenewalLabel')}</p>
                        <p className="mt-1 text-sm text-zinc-200">{nextRenewalLabel}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <p className="text-sm text-zinc-400">
                      {t('producerDashboard.cancellationAnytime', { date: nextRenewalLabel ?? '-' })}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      isLoading={isPortalLoading}
                      onClick={() => void openPortal()}
                    >
                      {t('producerDashboard.manageSubscription')}
                    </Button>
                  </div>

                  {portalError && (
                    <p className="text-sm text-red-400">{portalError}</p>
                  )}
                </div>
              </Card>
            )}

            <Card className="p-6">
              <form onSubmit={handleProfileUpdate} className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">
                    {t('settings.profileSectionTitle')}
                  </h2>
                  <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <p className="text-sm font-medium text-zinc-300 mb-3">{t('settings.avatarTitle')}</p>
                    <div className="flex items-center gap-4">
                      {avatarPreviewUrl ? (
                        <img
                          src={avatarPreviewUrl}
                          alt={profile?.username || t('settings.avatarTitle')}
                          className="w-20 h-20 rounded-full object-cover border border-zinc-700"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                          <User className="w-8 h-8 text-zinc-500" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarChange}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => avatarInputRef.current?.click()}
                          disabled={isLoading || isAvatarUploading}
                          className="flex items-center gap-2"
                        >
                          <Camera className="w-4 h-4" />
                          {t('settings.changeAvatar')}
                        </Button>
                        <p className="text-xs text-zinc-500">{t('settings.avatarFormats')}</p>
                        {avatarError && (
                          <p className="text-xs text-red-400">{avatarError}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <Input
                    type="text"
                    label={t('auth.username')}
                    value={profileData.username}
                    onChange={(e) =>
                      setProfileData({ ...profileData, username: e.target.value })
                    }
                    leftIcon={<User className="w-5 h-5" />}
                    required
                  />
                  <Input
                    type="text"
                    label={t('auth.fullName')}
                    value={profileData.full_name}
                    onChange={(e) =>
                      setProfileData({ ...profileData, full_name: e.target.value })
                    }
                  />
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      {t('settings.bioLabel')}
                    </label>
                    <textarea
                      value={profileData.bio}
                      onChange={(e) =>
                        setProfileData({ ...profileData, bio: e.target.value })
                      }
                      rows={4}
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                      placeholder={t('settings.bioPlaceholder')}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-300 mb-2">{t('settings.socialLinksTitle')}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input
                        type="text"
                        label={t('settings.instagramLabel')}
                        value={socialLinksData.instagram}
                        onChange={(e) =>
                          setSocialLinksData({ ...socialLinksData, instagram: e.target.value })
                        }
                        placeholder={t('settings.instagramPlaceholder')}
                        leftIcon={<Instagram className="w-4 h-4" />}
                        maxLength={MAX_SOCIAL_LINK_LENGTH}
                      />
                      <Input
                        type="text"
                        label={t('settings.youtubeLabel')}
                        value={socialLinksData.youtube}
                        onChange={(e) =>
                          setSocialLinksData({ ...socialLinksData, youtube: e.target.value })
                        }
                        placeholder={t('settings.youtubePlaceholder')}
                        leftIcon={<Youtube className="w-4 h-4" />}
                        maxLength={MAX_SOCIAL_LINK_LENGTH}
                      />
                      <Input
                        type="text"
                        label={t('settings.soundcloudLabel')}
                        value={socialLinksData.soundcloud}
                        onChange={(e) =>
                          setSocialLinksData({ ...socialLinksData, soundcloud: e.target.value })
                        }
                        placeholder={t('settings.soundcloudPlaceholder')}
                        leftIcon={<Cloud className="w-4 h-4" />}
                        maxLength={MAX_SOCIAL_LINK_LENGTH}
                      />
                      <Input
                        type="text"
                        label={t('settings.tiktokLabel')}
                        value={socialLinksData.tiktok}
                        onChange={(e) =>
                          setSocialLinksData({ ...socialLinksData, tiktok: e.target.value })
                        }
                        placeholder={t('settings.tiktokPlaceholder')}
                        leftIcon={<Music2 className="w-4 h-4" />}
                        maxLength={MAX_SOCIAL_LINK_LENGTH}
                      />
                      <Input
                        type="text"
                        label={t('settings.spotifyLabel')}
                        value={socialLinksData.spotify}
                        onChange={(e) =>
                          setSocialLinksData({ ...socialLinksData, spotify: e.target.value })
                        }
                        placeholder={t('settings.spotifyPlaceholder')}
                        leftIcon={<Disc3 className="w-4 h-4" />}
                        maxLength={MAX_SOCIAL_LINK_LENGTH}
                      />
                    </div>
                  </div>
                  <Input
                    type="url"
                    label={t('settings.websiteLabel')}
                    value={profileData.website_url}
                    onChange={(e) =>
                      setProfileData({ ...profileData, website_url: e.target.value })
                    }
                    placeholder={t('settings.websitePlaceholder')}
                  />
                  </div>
                </div>

                <Button type="submit" isLoading={isLoading || isAvatarUploading} className="flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  {t('settings.saveChanges')}
                </Button>
              </form>
            </Card>
          </div>
        )}

        {activeTab === 'security' && (
          <Card className="p-6 space-y-8">
            <form onSubmit={handlePasswordUpdate} className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-white mb-4">
                  {t('user.changePassword')}
                </h2>
                <div className="space-y-4">
                  <Input
                    type="password"
                    label={t('settings.newPasswordLabel')}
                    value={passwordData.newPassword}
                    onChange={(e) =>
                      setPasswordData({ ...passwordData, newPassword: e.target.value })
                    }
                    leftIcon={<Lock className="w-5 h-5" />}
                    placeholder="••••••••"
                    required
                  />
                  <Input
                    type="password"
                    label={t('auth.confirmPassword')}
                    value={passwordData.confirmPassword}
                    onChange={(e) =>
                      setPasswordData({ ...passwordData, confirmPassword: e.target.value })
                    }
                    leftIcon={<Lock className="w-5 h-5" />}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <Button type="submit" isLoading={isLoading} className="flex items-center gap-2">
                <Save className="w-4 h-4" />
                {t('settings.updatePasswordButton')}
              </Button>
            </form>

            <section className="rounded-xl border border-red-900/50 bg-red-950/20 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-white">{t('settings.dangerZoneTitle')}</h3>
                  <p className="text-sm text-zinc-300">{t('settings.dangerZoneDescription')}</p>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setIsDeleteAccountModalOpen(true)}
                    disabled={isLoading || isDeletingAccount}
                  >
                    {t('settings.deleteAccountButton')}
                  </Button>
                </div>
              </div>
            </section>
          </Card>
        )}

        {activeTab === 'preferences' && (
          <Card className="p-6">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-white mb-4">
                  {t('settings.languageSectionTitle')}
                </h2>
                <Select
                  label={t('settings.interfaceLanguageLabel')}
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  options={[
                    { value: 'fr', label: t('settings.languageFrench') },
                    { value: 'en', label: t('settings.languageEnglish') },
                    { value: 'de', label: t('settings.languageGerman') },
                  ]}
                />
              </div>
            </div>
          </Card>
        )}

        <Modal
          isOpen={isDeleteAccountModalOpen}
          onClose={closeDeleteAccountModal}
          title={t('settings.deleteAccountModalTitle')}
          description={t('settings.deleteAccountModalDescription')}
          size="md"
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-amber-200">
                    {t('settings.deleteAccountCreditsWarning')}
                  </p>
                  <p className="text-sm text-zinc-200">
                    {isCreditBalanceLoading
                      ? t('settings.deleteAccountCreditsValueLoading')
                      : t('settings.deleteAccountCreditsValue', {
                          credits: typeof creditBalance === 'number' ? creditBalance : 0,
                          value: formatPrice(creditValueCents ?? 0),
                        })}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {t('settings.deleteAccountLegalNote')}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                {t('settings.deleteAccountReasonLabel')}
              </label>
              <textarea
                value={deleteAccountReason}
                onChange={(e) => setDeleteAccountReason(e.target.value)}
                rows={3}
                maxLength={500}
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                placeholder={t('settings.deleteAccountReasonPlaceholder')}
                disabled={isDeletingAccount}
              />
            </div>

            <Input
              type="text"
              label={t('settings.deleteAccountConfirmLabel')}
              value={deleteAccountConfirmInput}
              onChange={(e) => setDeleteAccountConfirmInput(e.target.value)}
              placeholder={t('settings.deleteAccountConfirmPlaceholder')}
              disabled={isDeletingAccount}
              required
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeDeleteAccountModal}
                disabled={isDeletingAccount}
              >
                {t('settings.deleteAccountCancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void handleDeleteMyAccount()}
                isLoading={isDeletingAccount}
                disabled={isDeletingAccount || deleteAccountConfirmInput.trim().toUpperCase() !== 'SUPPRIMER'}
              >
                {t('settings.deleteAccountConfirmFinal')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
