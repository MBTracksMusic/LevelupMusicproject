import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AUTH_STORAGE_KEY = 'sb-levelupmusic-auth';

function isServiceRole(key: string) {
  try {
    const base64 = key.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    const json = base64 ? JSON.parse(atob(base64)) : null;
    return json?.role === 'service_role';
  } catch {
    return false;
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

if (isServiceRole(supabaseAnonKey)) {
  throw new Error('Do not use the service_role key in the frontend. Provide the anon public key.');
}

function getDefaultAuthStorageKey(url: string) {
  try {
    const host = new URL(url).hostname;
    const projectRef = host.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function migrateAuthStorage(url: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const defaultStorageKey = getDefaultAuthStorageKey(url);
  if (!defaultStorageKey || defaultStorageKey === AUTH_STORAGE_KEY) {
    return;
  }

  const dedicatedSession = window.localStorage.getItem(AUTH_STORAGE_KEY);
  const defaultSession = window.localStorage.getItem(defaultStorageKey);

  if (!dedicatedSession && defaultSession) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, defaultSession);
  }
}

migrateAuthStorage(supabaseUrl);

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // CRITICAL: this app manually handles auth callback URLs in ResetPassword.tsx
      // and EmailConfirmation.tsx. The installed Supabase client defaults this
      // option to true, so it must be disabled explicitly to avoid consuming the
      // URL before those pages run their own token bootstrap logic.
    },
  },
);
