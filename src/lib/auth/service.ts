import { supabase } from '../supabase/client';

export interface SignUpData {
  email: string;
  password: string;
  username?: string;
  fullName?: string;
}

export interface SignInData {
  email: string;
  password: string;
}

export async function signUp({ email, password, username, fullName }: SignUpData) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = (username ?? cleanEmail.split('@')[0]).trim();
  const cleanFullName = fullName?.trim() || undefined;

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/email-confirmation`,
      data: {
        username: cleanUsername,
        full_name: cleanFullName,
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function signIn({ email, password }: SignInData) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
}

export async function updateProfile(updates: {
  username?: string;
  full_name?: string;
  avatar_url?: string;
  bio?: string;
  website_url?: string;
  language?: 'fr' | 'en' | 'de';
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: currentProfile, error: fetchError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!currentProfile) throw new Error('Profile not found');

  const { error } = await supabase
    .from('user_profiles')
    .update({
      ...currentProfile,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) throw error;
}
