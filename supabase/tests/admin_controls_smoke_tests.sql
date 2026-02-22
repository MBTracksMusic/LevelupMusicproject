/*
  Admin controls smoke tests (audit log + rate limit + monitoring)

  Notes:
  - Run as project owner/service role in Supabase SQL Editor.
  - All mutating tests are wrapped in BEGIN/ROLLBACK (dry-run style).
  - Existing RPC signatures are unchanged; tests validate additive controls.
*/

-- ---------------------------------------------------------------------------
-- 0) Object sanity
-- ---------------------------------------------------------------------------
SELECT to_regclass('public.admin_action_audit_log') AS admin_action_audit_log_exists;
SELECT to_regclass('public.rpc_rate_limit_rules') AS rpc_rate_limit_rules_exists;
SELECT to_regclass('public.rpc_rate_limit_counters') AS rpc_rate_limit_counters_exists;
SELECT to_regclass('public.rpc_rate_limit_hits') AS rpc_rate_limit_hits_exists;
SELECT to_regclass('public.monitoring_alert_events') AS monitoring_alert_events_exists;

-- ---------------------------------------------------------------------------
-- 1) Deterministic rate-limit check + hit creation + monitoring alert
-- ---------------------------------------------------------------------------
BEGIN;

INSERT INTO public.rpc_rate_limit_rules (rpc_name, scope, allowed_per_minute, is_enabled)
VALUES ('__smoke_rpc__', 'per_admin', 1, true)
ON CONFLICT (rpc_name) DO UPDATE
SET scope = EXCLUDED.scope,
    allowed_per_minute = EXCLUDED.allowed_per_minute,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now();

SELECT public.check_rpc_rate_limit(NULL::uuid, '__smoke_rpc__') AS first_call_should_be_true;
SELECT public.check_rpc_rate_limit(NULL::uuid, '__smoke_rpc__') AS second_call_should_be_false;

SELECT
  rpc_name,
  scope_key,
  allowed_per_minute,
  observed_count,
  created_at
FROM public.rpc_rate_limit_hits
WHERE rpc_name = '__smoke_rpc__'
ORDER BY created_at DESC
LIMIT 1;

SELECT
  event_type,
  severity,
  source,
  details,
  created_at
FROM public.monitoring_alert_events
WHERE event_type = 'rpc_rate_limit_exceeded'
ORDER BY created_at DESC
LIMIT 1;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 2) AI executed action sync -> centralized admin_action_audit_log
-- ---------------------------------------------------------------------------
BEGIN;

WITH inserted_ai AS (
  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  )
  VALUES (
    'battle_finalize',
    'other',
    gen_random_uuid(),
    jsonb_build_object('source', 'smoke_test'),
    1.0,
    'smoke_test_sync',
    'executed',
    false,
    true,
    now(),
    NULL,
    NULL
  )
  RETURNING id
)
SELECT
  aal.id,
  aal.action_type,
  aal.source,
  aal.source_action_id,
  aal.success,
  aal.created_at
FROM public.admin_action_audit_log aal
JOIN inserted_ai ia ON ia.id = aal.source_action_id;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 3) Failed centralized audit event should emit monitoring alert
-- ---------------------------------------------------------------------------
BEGIN;

INSERT INTO public.admin_action_audit_log (
  admin_user_id,
  action_type,
  entity_type,
  entity_id,
  source,
  context,
  extra_details,
  success,
  error
)
VALUES (
  NULL,
  '__smoke_failed_action__',
  'other',
  gen_random_uuid(),
  'smoke_test',
  '{}'::jsonb,
  jsonb_build_object('note', 'smoke_failed_event'),
  false,
  'smoke_failure'
);

SELECT
  event_type,
  severity,
  source,
  details,
  created_at
FROM public.monitoring_alert_events
WHERE event_type = 'admin_action_failed'
ORDER BY created_at DESC
LIMIT 1;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 4) Sensitive RPC smoke (dry-run)
--    finalize_expired_battles is used because it is parameter-safe and idempotent.
-- ---------------------------------------------------------------------------
BEGIN;

SELECT public.finalize_expired_battles(1) AS finalized_count_dry_run;

SELECT
  action_type,
  source,
  success,
  error,
  created_at
FROM public.admin_action_audit_log
WHERE action_type = 'finalize_expired_battles'
ORDER BY created_at DESC
LIMIT 3;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 5) Optional anomaly scan
-- ---------------------------------------------------------------------------
SELECT public.detect_admin_action_anomalies(15) AS anomaly_events_inserted;
