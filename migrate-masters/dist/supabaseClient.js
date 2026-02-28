"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseAdminClient = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const fetchWithTimeout = (timeoutMs) => {
    return async (input, init) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error(`request_timeout_after_${timeoutMs}ms`)), timeoutMs);
        const upstreamSignal = init?.signal;
        const abortUpstream = () => controller.abort(new Error("request_aborted"));
        if (upstreamSignal) {
            if (upstreamSignal.aborted) {
                abortUpstream();
            }
            else {
                upstreamSignal.addEventListener("abort", abortUpstream, { once: true });
            }
        }
        try {
            return await fetch(input, {
                ...init,
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timeout);
            upstreamSignal?.removeEventListener("abort", abortUpstream);
        }
    };
};
const createSupabaseAdminClient = ({ supabaseUrl, serviceRoleKey, requestTimeoutMs, }) => {
    return (0, supabase_js_1.createClient)(supabaseUrl, serviceRoleKey, {
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
exports.createSupabaseAdminClient = createSupabaseAdminClient;
