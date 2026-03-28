import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // detectSessionInUrl: false (default)
      // CRITICAL: Password reset flow in ResetPassword.tsx manually handles URL recovery tokens.
      // With detectSessionInUrl: true, Supabase processes the URL before the component mounts,
      // causing the auth event to be emitted before the listener is registered, resulting in
      // "Link invalid or expired" error after clicking password reset email link.
      // Disabling detectSessionInUrl is safe because ResetPassword.tsx has full bootstrap logic.
    },
  },
);
