import { useState } from 'react';
import { useAuth } from '../lib/auth/hooks';
import { useTranslation } from '../lib/i18n';
import { updateProfile, updatePassword } from '../lib/auth/service';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { User, Lock, Globe, Save } from 'lucide-react';
import toast from 'react-hot-toast';

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { language, setLanguage } = useTranslation();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'preferences'>('profile');

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

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await updateProfile({
        username: profileData.username,
        full_name: profileData.full_name,
        bio: profileData.bio,
        website_url: profileData.website_url,
      });
      await refreshProfile();
      toast.success('Profil mis à jour avec succès');
    } catch (error) {
      console.error('Error updating profile', error);
      toast.error('Erreur lors de la mise à jour du profil');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setIsLoading(true);

    try {
      await updatePassword(passwordData.newPassword);
      toast.success('Mot de passe mis à jour avec succès');
      setPasswordData({ newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error updating password', error);
      toast.error('Erreur lors de la mise à jour du mot de passe');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLanguageChange = async (newLanguage: string) => {
    setLanguage(newLanguage as 'fr' | 'en' | 'de');
    try {
      await updateProfile({ language: newLanguage as 'fr' | 'en' | 'de' });
      toast.success('Langue mise à jour');
    } catch (error) {
      console.error('Error updating language', error);
      toast.error('Erreur lors de la mise à jour de la langue');
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profil', icon: User },
    { id: 'security', label: 'Sécurité', icon: Lock },
    { id: 'preferences', label: 'Préférences', icon: Globe },
  ];

  return (
    <div className="pt-20 pb-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Paramètres</h1>
          <p className="text-zinc-400">Gérez vos informations et préférences</p>
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
                  Informations du profil
                </h2>
                <div className="space-y-4">
                  <Input
                    type="text"
                    label="Nom d'utilisateur"
                    value={profileData.username}
                    onChange={(e) =>
                      setProfileData({ ...profileData, username: e.target.value })
                    }
                    leftIcon={<User className="w-5 h-5" />}
                    required
                  />
                  <Input
                    type="text"
                    label="Nom complet"
                    value={profileData.full_name}
                    onChange={(e) =>
                      setProfileData({ ...profileData, full_name: e.target.value })
                    }
                  />
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Bio
                    </label>
                    <textarea
                      value={profileData.bio}
                      onChange={(e) =>
                        setProfileData({ ...profileData, bio: e.target.value })
                      }
                      rows={4}
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
                      placeholder="Parlez-nous de vous..."
                    />
                  </div>
                  <Input
                    type="url"
                    label="Site web"
                    value={profileData.website_url}
                    onChange={(e) =>
                      setProfileData({ ...profileData, website_url: e.target.value })
                    }
                    placeholder="https://example.com"
                  />
                </div>
              </div>

              <Button type="submit" isLoading={isLoading} className="flex items-center gap-2">
                <Save className="w-4 h-4" />
                Enregistrer les modifications
              </Button>
            </form>
          </Card>
        )}

        {activeTab === 'security' && (
          <Card className="p-6">
            <form onSubmit={handlePasswordUpdate} className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-white mb-4">
                  Changer le mot de passe
                </h2>
                <div className="space-y-4">
                  <Input
                    type="password"
                    label="Nouveau mot de passe"
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
                    label="Confirmer le mot de passe"
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
                Mettre à jour le mot de passe
              </Button>
            </form>
          </Card>
        )}

        {activeTab === 'preferences' && (
          <Card className="p-6">
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-white mb-4">
                  Préférences de langue
                </h2>
                <Select
                  label="Langue de l'interface"
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  options={[
                    { value: 'fr', label: 'Français' },
                    { value: 'en', label: 'English' },
                    { value: 'de', label: 'Deutsch' },
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
