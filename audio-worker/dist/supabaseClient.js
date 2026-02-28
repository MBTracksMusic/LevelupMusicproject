import { createClient } from "@supabase/supabase-js";
export const createSupabaseAdminClient = (config) => createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
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
