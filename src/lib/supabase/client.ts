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

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
