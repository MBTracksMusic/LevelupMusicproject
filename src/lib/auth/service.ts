import { supabase } from '@/lib/supabase/client';
import { getAuthRedirectUrl } from './redirects';

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

export async function signUp({ email, password, username, fullName, captchaToken }: SignUpData & { captchaToken: string }) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = (username ?? cleanEmail.split('@')[0]).trim();
  const cleanFullName = fullName?.trim() || undefined;

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl('/email-confirmation'),
      data: {
        username: cleanUsername,
        full_name: cleanFullName,
      },
      captchaToken,
    },
  });

  if (error) throw error;
  return data;
}

export async function signIn({ email, password, captchaToken }: SignInData & { captchaToken: string }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string, captchaToken: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl('/reset-password'),
    captchaToken,
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

  const sanitizedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );
  const updatePayload = {
    ...sanitizedUpdates,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_profiles')
    .update(updatePayload as never)
    .eq('id', user.id);

  if (error) throw error;
}
