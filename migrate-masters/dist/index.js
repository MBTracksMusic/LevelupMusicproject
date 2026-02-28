"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const supabaseClient_1 = require("./supabaseClient");
const migrate_1 = require("./migrate");
const readRequiredEnv = (name) => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`missing_env:${name}`);
    }
    return value;
};
const readNumberEnv = (name, fallback) => {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) {
        return fallback;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid_number_env:${name}`);
    }
    return parsed;
};
const main = async () => {
    const supabaseUrl = readRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const config = {
        legacyBucket: readRequiredEnv("LEGACY_BUCKET"),
        canonicalBucket: readRequiredEnv("CANONICAL_BUCKET"),
        pageSize: readNumberEnv("PAGE_SIZE", 200),
        signedUrlTtlSeconds: readNumberEnv("SIGNED_URL_TTL_SECONDS", 600),
    };
    const requestTimeoutMs = readNumberEnv("REQUEST_TIMEOUT_MS", 60000);
    const supabase = (0, supabaseClient_1.createSupabaseAdminClient)({
        supabaseUrl,
        serviceRoleKey,
        requestTimeoutMs,
    });
    const counters = await (0, migrate_1.runMigration)(supabase, config, requestTimeoutMs);
    if (counters.failed > 0) {
        process.exitCode = 1;
    }
};
main().catch((error) => {
    console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "fatal",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
});
