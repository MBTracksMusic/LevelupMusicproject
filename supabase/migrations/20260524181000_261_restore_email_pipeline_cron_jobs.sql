/*
  # 261 — Restore email pipeline cron jobs missing in production

  Background:
  - Migration 175 introduced the helper `schedule_service_role_worker_cron`
    and intended to schedule four pipeline workers, but it skipped silently
    when vault secrets `project_url` / `service_role_key` were not yet set.
  - In production these jobs were never created, so `event_outbox`,
    `event_bus`, and `email_queue` are never drained: queued emails do not
    leave the database.
  - In staging the equivalent jobs already exist (created via a different
    deployment path with an `x-internal-secret` header pattern). We must
    therefore make this migration **idempotent by jobname**: if a job with
    the canonical name already exists we leave it alone.

  Pre-flight: this migration RAISES if vault secrets are missing so the
  failure is loud (no silent skip like migration 175).

  Jobs scheduled (when absent):
  - process-outbox-every-minute          (* * * * *)
  - process-events-every-minute          (* * * * *)
  - process-email-queue-every-minute     (* * * * *)
  - repair-email-delivery-every-15min    (*/15 * * * *)
*/

BEGIN;

-- ── 1. Pre-flight: required vault secrets must exist ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE lower(name) IN ('project_url', 'supabase_url')
  ) THEN
    RAISE EXCEPTION 'vault.project_url (or vault.supabase_url) is missing. Create it in Supabase Dashboard > Settings > Vault before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE lower(name) IN ('service_role_key', 'supabase_service_role_key')
  ) THEN
    RAISE EXCEPTION 'vault.service_role_key (or vault.supabase_service_role_key) is missing. Create it in Supabase Dashboard > Settings > Vault before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'schedule_service_role_worker_cron'
  ) THEN
    RAISE EXCEPTION 'Helper public.schedule_service_role_worker_cron is missing. Migration 175 must be applied first.';
  END IF;
END;
$$;

-- ── 2. Idempotent local wrapper: schedule only if jobname is absent ──────────
CREATE OR REPLACE FUNCTION public._schedule_worker_if_missing(
  p_jobname  text,
  p_endpoint text,
  p_schedule text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_jobname) THEN
    RAISE NOTICE 'Cron job % already exists, skipping (idempotent).', p_jobname;
    RETURN;
  END IF;

  PERFORM public.schedule_service_role_worker_cron(p_jobname, p_endpoint, p_schedule);
  RAISE NOTICE 'Scheduled cron job %.', p_jobname;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._schedule_worker_if_missing(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._schedule_worker_if_missing(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._schedule_worker_if_missing(text, text, text) FROM authenticated;

-- ── 3. Schedule the four workers ─────────────────────────────────────────────
SELECT public._schedule_worker_if_missing(
  'process-outbox-every-minute',       'process-outbox',       '* * * * *'
);
SELECT public._schedule_worker_if_missing(
  'process-events-every-minute',       'process-events',       '* * * * *'
);
SELECT public._schedule_worker_if_missing(
  'process-email-queue-every-minute',  'process-email-queue',  '* * * * *'
);
SELECT public._schedule_worker_if_missing(
  'repair-email-delivery-every-15min', 'repair-email-delivery', '*/15 * * * *'
);

-- ── 4. Cleanup local wrapper ─────────────────────────────────────────────────
DROP FUNCTION public._schedule_worker_if_missing(text, text, text);

COMMIT;
