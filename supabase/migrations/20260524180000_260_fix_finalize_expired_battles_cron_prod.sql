/*
  # 260 — Fix corrupted agent-finalize-expired-battles cron job

  Background:
  - Migration 234 hardcoded the production project URL when scheduling the
    cron job. A stale sed/replace left the production prod cron command
    syntactically corrupted (the literal keyword `url` was replaced by the
    URL itself, and the body still contains an unsubstituted
    `<STAGING_PROJECT_REF>` placeholder).
  - Staging suffered a symmetric bug: jobid 15 in staging targets the
    production URL instead of the staging URL.
  - Result: no battle has ever auto-completed in production via this cron.

  Fix:
  - Unschedule the broken job (idempotent).
  - Re-schedule it using `vault.project_url` so the same migration is
    portable between staging and production.
  - Use `vault.agent_cron_secret` for auth, matching the existing
    convention (already used by agent-auto-execute-ai-actions).

  Pre-flight: this migration RAISES if vault secrets are missing, so a
  silent skip cannot leave the cron half-configured.
*/

BEGIN;

-- ── 1. Pre-flight: required vault secrets must exist ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'agent_cron_secret'
  ) THEN
    RAISE EXCEPTION 'vault.agent_cron_secret is missing. Create it in Supabase Dashboard > Settings > Vault before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE lower(name) IN ('project_url', 'supabase_url')
  ) THEN
    RAISE EXCEPTION 'vault.project_url (or vault.supabase_url) is missing. Create it in Supabase Dashboard > Settings > Vault before applying this migration.';
  END IF;
END;
$$;

-- ── 2. Unschedule the broken job (idempotent) ────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('agent-finalize-expired-battles');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- ── 3. Re-schedule with portable vault-based URL ─────────────────────────────
SELECT cron.schedule(
  'agent-finalize-expired-battles',
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
    ) || '/functions/v1/agent-finalize-expired-battles',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'agent_cron_secret'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

COMMIT;
