/*
  # 262 — Fix auth header on email pipeline cron jobs

  Background:
  - Migration 261 scheduled process-outbox / process-events /
    process-email-queue via the helper introduced in migration 175.
    The helper sends `Authorization: Bearer <service_role_key>`, but the
    edge functions actually check `req.headers.get('x-internal-secret')`
    against `Deno.env.get('INTERNAL_PIPELINE_SECRET')`. The cron jobs
    therefore receive 401 Unauthorized on every tick — the email pipeline
    is not drained.
  - Migration 175's helper is a latent bug: any environment that relied
    on it without additionally hardcoding the right header would be broken.
    Staging works only because its jobs were created with hardcoded
    `x-internal-secret` outside the migration system.

  Fix:
  - Unschedule the three workers created by migration 261.
  - Re-schedule them with the canonical header pattern read from
    `vault.internal_pipeline_secret`, matching the value of the edge
    function env var `INTERNAL_PIPELINE_SECRET`.

  Pre-flight: RAISES if vault.internal_pipeline_secret is missing.

  Out of scope:
  - repair-email-delivery uses a different secret (EMAIL_REPAIR_SECRET +
    header `x-email-repair-secret`); will be fixed in a separate migration
    once `vault.email_repair_secret` is provisioned.
*/

BEGIN;

-- ── 1. Pre-flight: required vault secret must exist ──────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'internal_pipeline_secret'
  ) THEN
    RAISE EXCEPTION 'vault.internal_pipeline_secret is missing. Copy the value of the Edge Function env var INTERNAL_PIPELINE_SECRET into vault (Supabase Dashboard > Settings > Vault > New Secret named internal_pipeline_secret) before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE lower(name) IN ('project_url', 'supabase_url')
  ) THEN
    RAISE EXCEPTION 'vault.project_url is missing.';
  END IF;
END;
$$;

-- ── 2. Local helper: idempotent reschedule of one worker ─────────────────────
CREATE OR REPLACE FUNCTION public._reschedule_pipeline_worker(
  p_jobname  text,
  p_endpoint text,
  p_schedule text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_job_id bigint;
BEGIN
  SELECT jobid INTO v_existing_job_id FROM cron.job WHERE jobname = p_jobname LIMIT 1;

  IF v_existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_job_id);
    RAISE NOTICE 'Unscheduled existing job % (id %).', p_jobname, v_existing_job_id;
  END IF;

  PERFORM cron.schedule(
    p_jobname,
    p_schedule,
    format(
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
  ) || '/functions/v1/%s',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'internal_pipeline_secret'
      LIMIT 1
    )
  ),
  body := '{}'::jsonb
);
$cron$,
      p_endpoint
    )
  );

  RAISE NOTICE 'Scheduled job % targeting %.', p_jobname, p_endpoint;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._reschedule_pipeline_worker(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._reschedule_pipeline_worker(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._reschedule_pipeline_worker(text, text, text) FROM authenticated;

-- ── 3. Reschedule the three pipeline workers with the right header ───────────
SELECT public._reschedule_pipeline_worker(
  'process-outbox-every-minute',      'process-outbox',      '* * * * *'
);
SELECT public._reschedule_pipeline_worker(
  'process-events-every-minute',      'process-events',      '* * * * *'
);
SELECT public._reschedule_pipeline_worker(
  'process-email-queue-every-minute', 'process-email-queue', '* * * * *'
);

-- ── 4. Cleanup local helper ──────────────────────────────────────────────────
DROP FUNCTION public._reschedule_pipeline_worker(text, text, text);

COMMIT;
