import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  requestTimeoutMs: number;
}

const fetchWithTimeout = (timeoutMs: number): typeof fetch => {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`request_timeout_after_${timeoutMs}ms`)), timeoutMs);

    const upstreamSignal = init?.signal;
    const abortUpstream = () => controller.abort(new Error("request_aborted"));

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        abortUpstream();
      } else {
        upstreamSignal.addEventListener("abort", abortUpstream, { once: true });
      }
    }

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortUpstream);
    }
  };
};

export const createSupabaseAdminClient = ({
  supabaseUrl,
  serviceRoleKey,
  requestTimeoutMs,
}: SupabaseEnv): SupabaseClient => {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchWithTimeout(requestTimeoutMs),
      headers: {
        "x-client-info": "levelupmusic-migrate-masters/1.0.0",
      },
    },
  });
};
