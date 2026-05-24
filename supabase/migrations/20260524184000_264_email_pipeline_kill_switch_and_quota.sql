/*
  # 264 — Email pipeline kill-switch + per-hour quota

  Background:
  - Migration 262 unblocked the email pipeline in production. The first
    successful tick immediately drained a ~25-message backlog that had
    accumulated since 2026-04-04 because no email cron ever ran in prod.
  - That drain went fine (legitimate transactional welcome / activation
    emails) but exposed a missing safeguard: a future incident or a real
    surge could trigger a much larger burst with no human-controllable
    brake.

  This migration introduces two safeguards consumed by
  process-email-queue at request time:

  - `enabled` (boolean) — global kill-switch. When false, the worker
    returns HTTP 200 with `{ skipped: true, reason: "kill_switch_off" }`
    and processes nothing.
  - `max_per_hour` (integer) — rolling hourly cap. The worker counts
    rows in `email_queue` with `send_state = 'sent'` AND
    `sent_at > now() - interval '1 hour'`. If that count reaches
    `max_per_hour`, the worker returns
    `{ skipped: true, reason: "hourly_quota_reached" }`.
  - `max_per_batch` (integer) — ceiling applied on top of the existing
    MAX_BATCH_SIZE constant in the edge function.

  Default values are chosen to allow normal traffic and only kick in
  during anti-burst situations:
  - enabled = true (no behavior change at apply time)
  - max_per_hour = 200
  - max_per_batch = 50

  Applying this migration without deploying the patched edge function is
  safe: the row sits unused until the function is updated. The function
  patch is shipped in the same PR (commit on feedback/phase0-prereq).

  Idempotent: ON CONFLICT (key) DO NOTHING so re-applying the migration
  does not overwrite operator changes to the setting.
*/

BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES (
  'email_pipeline_settings',
  jsonb_build_object(
    'enabled',       true,
    'max_per_hour',  200,
    'max_per_batch', 50
  )
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
