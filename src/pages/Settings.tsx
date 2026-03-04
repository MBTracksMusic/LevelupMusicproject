import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation } from '../lib/i18n';
import { updateProfile, updatePassword } from '../lib/auth/service';
import { supabase } from '../lib/supabase/client';
import { extractStoragePathFromCandidate } from '../lib/utils/storage';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { User, Lock, Globe, Save, Camera, Instagram, Youtube, Cloud, Music2, Disc3 } from 'lucide-react';
import toast from 'react-hot-toast';

const AVATAR_BUCKET = import.meta.env.VITE_SUPABASE_AVATAR_BUCKET || 'avatars';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_SOCIAL_LINK_LENGTH = 255;

type SocialLinkKey = 'instagram' | 'youtube' | 'soundcloud' | 'tiktok' | 'spotify';

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { t, language, updateLanguage } = useTranslation();
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
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(profile?.avatar_url || '');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [localAvatarObjectUrl, setLocalAvatarObjectUrl] = useState<string | null>(null);
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

      return publicData.publicUrl;
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

  const tabs = [
    { id: 'profile', label: t('user.profile'), icon: User },
    { id: 'security', label: t('settings.tabSecurity'), icon: Lock },
    { id: 'preferences', label: t('settings.tabPreferences'), icon: Globe },
  ];

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
        )}

        {activeTab === 'security' && (
          <Card className="p-6">
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
      </div>
    </div>
  );
}
