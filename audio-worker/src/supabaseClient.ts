import { createClient } from "@supabase/supabase-js";
import type { WorkerConfig, SupabaseAdminClient } from "./types.js";

export const createSupabaseAdminClient = (config: WorkerConfig): SupabaseAdminClient =>
  createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        "X-Client-Info": "levelup-audio-worker/1.0.0",
      },
    },
  });
