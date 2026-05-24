/*
  # 263 — Fix auth header on repair-email-delivery cron job

  Background:
  - Migration 261 also scheduled `repair-email-delivery-every-15min` via
    the helper from migration 175, which sends `Authorization: Bearer
    <service_role_key>`. The repair-email-delivery edge function actually
    checks `req.headers.get('x-email-repair-secret')` against
    `Deno.env.get('EMAIL_REPAIR_SECRET')`. The cron therefore receives 401
    Unauthorized on every tick.
  - This is the same family of bug as migration 262 (different secret,
    different header).

  Fix:
  - Unschedule the broken `repair-email-delivery-every-15min` job.
  - Re-schedule with header `x-email-repair-secret` sourced from
    `vault.email_repair_secret` (which mirrors the edge function env var
    EMAIL_REPAIR_SECRET).

  Pre-flight: RAISES if `vault.email_repair_secret` is missing.
*/

BEGIN;

-- ── 1. Pre-flight ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_repair_secret'
  ) THEN
    RAISE EXCEPTION 'vault.email_repair_secret is missing. Copy the value of EMAIL_REPAIR_SECRET (Edge Function env var) into vault (Supabase Dashboard > Settings > Vault > New Secret named email_repair_secret) before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE lower(name) IN ('project_url', 'supabase_url')
  ) THEN
    RAISE EXCEPTION 'vault.project_url is missing.';
  END IF;
END;
$$;

-- ── 2. Unschedule the broken job (idempotent) ────────────────────────────────
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'repair-email-delivery-every-15min'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
    RAISE NOTICE 'Unscheduled existing repair-email-delivery-every-15min (id %).', v_jobid;
  END IF;
END;
$$;

-- ── 3. Re-schedule with correct header ───────────────────────────────────────
SELECT cron.schedule(
  'repair-email-delivery-every-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (
      SELECT rtrim(decrypted_secret, '/')
      FROM vault.decrypted_secrets
      WHERE lower(name) IN ('project_url', 'supabase_url')
      ORDER BY CASE
        WHEN lower(name) = 'project_url' THEN 0
        WHEN lower(name) = 'supabase_url' THEN 1
        ELSE 9
      END
      LIMIT 1
    ) || '/functions/v1/repair-email-delivery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-repair-secret', (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_repair_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

COMMIT;
