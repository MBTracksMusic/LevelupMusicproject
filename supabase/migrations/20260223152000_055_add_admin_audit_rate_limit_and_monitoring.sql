/*
  # Admin controls pack: centralized audit logging + RPC rate limits + monitoring alerts

  Additive only:
  - Central audit table for critical admin actions.
  - DB-level rate limiting for sensitive RPCs.
  - Monitoring event table + anomaly triggers.
  - No RPC signature changes.
  - Existing business logic preserved (adds guards/logging only).
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Centralized admin action audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_action_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  entity_type text NOT NULL DEFAULT 'other',
  entity_id uuid,
  source text NOT NULL DEFAULT 'rpc',
  source_action_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL DEFAULT true,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_action_audit_log_source_action_id_key'
      AND conrelid = 'public.admin_action_audit_log'::regclass
  ) THEN
    ALTER TABLE public.admin_action_audit_log
    ADD CONSTRAINT admin_action_audit_log_source_action_id_key
    UNIQUE (source_action_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_created
  ON public.admin_action_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_actor_created
  ON public.admin_action_audit_log (admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_action_created
  ON public.admin_action_audit_log (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_entity_created
  ON public.admin_action_audit_log (entity_type, entity_id, created_at DESC);

ALTER TABLE public.admin_action_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read centralized admin action audit log" ON public.admin_action_audit_log;

CREATE POLICY "Admins can read centralized admin action audit log"
  ON public.admin_action_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) RPC rate limit storage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rpc_rate_limit_rules (
  rpc_name text PRIMARY KEY,
  scope text NOT NULL DEFAULT 'per_admin' CHECK (scope IN ('per_admin', 'global')),
  allowed_per_minute integer NOT NULL CHECK (allowed_per_minute > 0),
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rpc_rate_limit_counters (
  rpc_name text NOT NULL REFERENCES public.rpc_rate_limit_rules(rpc_name) ON DELETE CASCADE,
  scope_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rpc_name, scope_key, window_started_at)
);

CREATE TABLE IF NOT EXISTS public.rpc_rate_limit_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rpc_name text NOT NULL,
  user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  scope_key text NOT NULL,
  allowed_per_minute integer NOT NULL,
  observed_count integer NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rpc_rate_limit_hits_rpc_created
  ON public.rpc_rate_limit_hits (rpc_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rpc_rate_limit_hits_user_created
  ON public.rpc_rate_limit_hits (user_id, created_at DESC);

ALTER TABLE public.rpc_rate_limit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpc_rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpc_rate_limit_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read rpc rate limit rules" ON public.rpc_rate_limit_rules;
DROP POLICY IF EXISTS "Admins can insert rpc rate limit rules" ON public.rpc_rate_limit_rules;
DROP POLICY IF EXISTS "Admins can update rpc rate limit rules" ON public.rpc_rate_limit_rules;
DROP POLICY IF EXISTS "Admins can read rpc rate limit counters" ON public.rpc_rate_limit_counters;
DROP POLICY IF EXISTS "Admins can read rpc rate limit hits" ON public.rpc_rate_limit_hits;

CREATE POLICY "Admins can read rpc rate limit rules"
  ON public.rpc_rate_limit_rules
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert rpc rate limit rules"
  ON public.rpc_rate_limit_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update rpc rate limit rules"
  ON public.rpc_rate_limit_rules
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can read rpc rate limit counters"
  ON public.rpc_rate_limit_counters
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can read rpc rate limit hits"
  ON public.rpc_rate_limit_hits
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

INSERT INTO public.rpc_rate_limit_rules (rpc_name, scope, allowed_per_minute, is_enabled)
VALUES
  ('admin_validate_battle', 'per_admin', 20, true),
  ('admin_cancel_battle', 'per_admin', 20, true),
  ('admin_extend_battle_duration', 'per_admin', 12, true),
  ('finalize_battle', 'per_admin', 30, true),
  ('finalize_expired_battles', 'global', 24, true),
  ('agent_finalize_expired_battles', 'global', 24, true)
ON CONFLICT (rpc_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Monitoring / alerting table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monitoring_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_monitoring_alert_events_created
  ON public.monitoring_alert_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_monitoring_alert_events_unresolved
  ON public.monitoring_alert_events (severity, created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.monitoring_alert_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read monitoring alert events" ON public.monitoring_alert_events;
DROP POLICY IF EXISTS "Admins can update monitoring alert events" ON public.monitoring_alert_events;

CREATE POLICY "Admins can read monitoring alert events"
  ON public.monitoring_alert_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update monitoring alert events"
  ON public.monitoring_alert_events
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4) Helper functions (request context, audit logging, rate limiting, alerts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_request_headers_jsonb()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_headers_raw text;
BEGIN
  v_headers_raw := current_setting('request.headers', true);
  IF v_headers_raw IS NULL OR btrim(v_headers_raw) = '' THEN
    RETURN '{}'::jsonb;
  END IF;

  BEGIN
    RETURN v_headers_raw::jsonb;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN '{}'::jsonb;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_admin_action_audit(
  p_admin_user_id uuid DEFAULT NULL,
  p_action_type text DEFAULT 'unknown_admin_action',
  p_entity_type text DEFAULT 'other',
  p_entity_id uuid DEFAULT NULL,
  p_source text DEFAULT 'rpc',
  p_source_action_id uuid DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_extra_details jsonb DEFAULT '{}'::jsonb,
  p_success boolean DEFAULT true,
  p_error text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log_id uuid;
  v_headers jsonb := public.get_request_headers_jsonb();
  v_forwarded_for text;
  v_ip text;
  v_runtime_context jsonb;
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  v_forwarded_for := COALESCE(v_headers->>'x-forwarded-for', v_headers->>'X-Forwarded-For');
  v_ip := NULLIF(
    split_part(
      COALESCE(v_forwarded_for, v_headers->>'x-real-ip', v_headers->>'X-Real-Ip', ''),
      ',',
      1
    ),
    ''
  );

  v_runtime_context := jsonb_build_object(
    'jwt_role', v_jwt_role,
    'auth_uid', v_actor,
    'jwt_sub', current_setting('request.jwt.claim.sub', true),
    'session_id', COALESCE(auth.jwt()->>'session_id', current_setting('request.jwt.claim.session_id', true)),
    'request_id', COALESCE(v_headers->>'x-request-id', v_headers->>'X-Request-Id'),
    'ip', v_ip,
    'user_agent', COALESCE(v_headers->>'user-agent', v_headers->>'User-Agent')
  );

  INSERT INTO public.admin_action_audit_log (
    admin_user_id,
    action_type,
    entity_type,
    entity_id,
    source,
    source_action_id,
    context,
    extra_details,
    success,
    error,
    created_at
  )
  VALUES (
    COALESCE(p_admin_user_id, v_actor),
    COALESCE(NULLIF(btrim(p_action_type), ''), 'unknown_admin_action'),
    COALESCE(NULLIF(btrim(p_entity_type), ''), 'other'),
    p_entity_id,
    COALESCE(NULLIF(btrim(p_source), ''), 'rpc'),
    p_source_action_id,
    jsonb_build_object(
      'runtime', v_runtime_context,
      'custom', COALESCE(p_context, '{}'::jsonb)
    ),
    COALESCE(p_extra_details, '{}'::jsonb),
    COALESCE(p_success, true),
    p_error,
    now()
  )
  ON CONFLICT (source_action_id) DO UPDATE
  SET context = EXCLUDED.context,
      extra_details = EXCLUDED.extra_details,
      success = EXCLUDED.success,
      error = EXCLUDED.error,
      created_at = EXCLUDED.created_at
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_monitoring_alert(
  p_event_type text,
  p_severity text DEFAULT 'warning',
  p_source text DEFAULT 'system',
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.monitoring_alert_events (
    event_type,
    severity,
    source,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown_monitoring_event'),
    CASE
      WHEN p_severity IN ('info', 'warning', 'critical') THEN p_severity
      ELSE 'warning'
    END,
    COALESCE(NULLIF(btrim(p_source), ''), 'system'),
    p_entity_type,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rpc_rate_limit(
  p_user_id uuid,
  p_rpc_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule public.rpc_rate_limit_rules%ROWTYPE;
  v_scope_key text;
  v_window_start timestamptz := date_trunc('minute', now());
  v_request_count integer := 0;
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_headers jsonb := public.get_request_headers_jsonb();
BEGIN
  IF p_rpc_name IS NULL OR btrim(p_rpc_name) = '' THEN
    RETURN true;
  END IF;

  SELECT *
  INTO v_rule
  FROM public.rpc_rate_limit_rules
  WHERE rpc_name = p_rpc_name;

  IF NOT FOUND OR COALESCE(v_rule.is_enabled, true) = false THEN
    RETURN true;
  END IF;

  v_scope_key := CASE
    WHEN v_rule.scope = 'global' THEN 'global'
    ELSE COALESCE(p_user_id::text, v_actor::text, 'anonymous')
  END;

  INSERT INTO public.rpc_rate_limit_counters (
    rpc_name,
    scope_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_rpc_name,
    v_scope_key,
    v_window_start,
    1,
    now()
  )
  ON CONFLICT (rpc_name, scope_key, window_started_at)
  DO UPDATE
    SET request_count = public.rpc_rate_limit_counters.request_count + 1,
        updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > v_rule.allowed_per_minute THEN
    INSERT INTO public.rpc_rate_limit_hits (
      rpc_name,
      user_id,
      scope_key,
      allowed_per_minute,
      observed_count,
      context
    )
    VALUES (
      p_rpc_name,
      COALESCE(p_user_id, v_actor),
      v_scope_key,
      v_rule.allowed_per_minute,
      v_request_count,
      jsonb_build_object(
        'jwt_role', v_jwt_role,
        'auth_uid', v_actor,
        'request_sub', current_setting('request.jwt.claim.sub', true),
        'session_id', COALESCE(auth.jwt()->>'session_id', current_setting('request.jwt.claim.session_id', true)),
        'request_id', COALESCE(v_headers->>'x-request-id', v_headers->>'X-Request-Id'),
        'source', 'check_rpc_rate_limit'
      )
    );

    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_rpc_rate_limit_counters(
  p_keep_hours integer DEFAULT 48
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
  v_keep_hours integer := GREATEST(1, COALESCE(p_keep_hours, 48));
BEGIN
  DELETE FROM public.rpc_rate_limit_counters
  WHERE window_started_at < now() - make_interval(hours => v_keep_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_admin_action_anomalies(
  p_lookback_minutes integer DEFAULT 15
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lookback integer := GREATEST(1, COALESCE(p_lookback_minutes, 15));
  v_row record;
  v_inserted integer := 0;
BEGIN
  FOR v_row IN
    SELECT
      aal.action_type,
      COUNT(*)::integer AS action_count
    FROM public.admin_action_audit_log aal
    WHERE aal.created_at >= now() - make_interval(mins => v_lookback)
    GROUP BY aal.action_type
    HAVING COUNT(*) >= 50
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.monitoring_alert_events mae
      WHERE mae.event_type = 'admin_action_spike_scan'
        AND mae.details->>'action_type' = v_row.action_type
        AND mae.created_at >= now() - make_interval(mins => v_lookback)
    ) THEN
      PERFORM public.log_monitoring_alert(
        p_event_type => 'admin_action_spike_scan',
        p_severity => 'critical',
        p_source => 'detect_admin_action_anomalies',
        p_entity_type => 'other',
        p_entity_id => NULL,
        p_details => jsonb_build_object(
          'action_type', v_row.action_type,
          'action_count', v_row.action_count,
          'lookback_minutes', v_lookback,
          'threshold', 50
        )
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Trigger-based synchronization and anomaly signals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_executed_ai_actions_to_admin_action_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'executed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'executed' THEN
    RETURN NEW;
  END IF;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => NEW.executed_by,
    p_action_type => NEW.action_type,
    p_entity_type => NEW.entity_type,
    p_entity_id => NEW.entity_id,
    p_source => 'ai_admin_actions',
    p_source_action_id => NEW.id,
    p_context => jsonb_build_object(
      'trigger_operation', TG_OP,
      'executed_at', NEW.executed_at,
      'confidence_score', NEW.confidence_score,
      'human_override', NEW.human_override,
      'reversible', NEW.reversible
    ),
    p_extra_details => COALESCE(NEW.ai_decision, '{}'::jsonb) || jsonb_build_object(
      'reason', NEW.reason
    ),
    p_success => true,
    p_error => NEW.error
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_executed_ai_actions_to_admin_action_audit_log ON public.ai_admin_actions;

CREATE TRIGGER trg_sync_executed_ai_actions_to_admin_action_audit_log
  AFTER INSERT OR UPDATE OF status, executed_at
  ON public.ai_admin_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_executed_ai_actions_to_admin_action_audit_log();

CREATE OR REPLACE FUNCTION public.on_rpc_rate_limit_hit_create_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.log_monitoring_alert(
    p_event_type => 'rpc_rate_limit_exceeded',
    p_severity => CASE
      WHEN NEW.observed_count >= (NEW.allowed_per_minute * 2) THEN 'critical'
      ELSE 'warning'
    END,
    p_source => 'rpc_rate_limit_hits',
    p_entity_type => 'rpc',
    p_entity_id => NULL,
    p_details => jsonb_build_object(
      'rpc_name', NEW.rpc_name,
      'user_id', NEW.user_id,
      'scope_key', NEW.scope_key,
      'allowed_per_minute', NEW.allowed_per_minute,
      'observed_count', NEW.observed_count,
      'hit_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rpc_rate_limit_hit_create_alert ON public.rpc_rate_limit_hits;

CREATE TRIGGER trg_rpc_rate_limit_hit_create_alert
  AFTER INSERT
  ON public.rpc_rate_limit_hits
  FOR EACH ROW
  EXECUTE FUNCTION public.on_rpc_rate_limit_hit_create_alert();

CREATE OR REPLACE FUNCTION public.on_admin_action_audit_monitoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent_count integer;
BEGIN
  IF NEW.success = false THEN
    PERFORM public.log_monitoring_alert(
      p_event_type => 'admin_action_failed',
      p_severity => 'warning',
      p_source => 'admin_action_audit_log',
      p_entity_type => NEW.entity_type,
      p_entity_id => NEW.entity_id,
      p_details => jsonb_build_object(
        'action_type', NEW.action_type,
        'admin_user_id', NEW.admin_user_id,
        'error', NEW.error,
        'audit_log_id', NEW.id
      )
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_recent_count
  FROM public.admin_action_audit_log aal
  WHERE aal.action_type = NEW.action_type
    AND aal.created_at >= now() - interval '5 minutes';

  IF v_recent_count >= 25 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.monitoring_alert_events mae
      WHERE mae.event_type = 'admin_action_spike'
        AND mae.details->>'action_type' = NEW.action_type
        AND mae.created_at >= now() - interval '5 minutes'
    ) THEN
      PERFORM public.log_monitoring_alert(
        p_event_type => 'admin_action_spike',
        p_severity => 'critical',
        p_source => 'admin_action_audit_log',
        p_entity_type => NEW.entity_type,
        p_entity_id => NEW.entity_id,
        p_details => jsonb_build_object(
          'action_type', NEW.action_type,
          'count_5m', v_recent_count,
          'threshold', 25
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_action_audit_monitoring ON public.admin_action_audit_log;

CREATE TRIGGER trg_admin_action_audit_monitoring
  AFTER INSERT
  ON public.admin_action_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.on_admin_action_audit_monitoring();

-- ---------------------------------------------------------------------------
-- 6) Sensitive RPC hardening (rate limit + centralized audit; signatures unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_validate_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_new_voting_ends_at timestamptz;
  v_effective_days integer;
  v_duration_source text := 'already_defined';
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'admin_validate_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'admin_validate_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object('guard', 'rate_limit'),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'awaiting_admin' THEN
    RAISE EXCEPTION 'battle_not_waiting_admin_validation';
  END IF;

  v_new_voting_ends_at := v_battle.voting_ends_at;

  IF v_battle.voting_ends_at IS NULL THEN
    IF v_battle.custom_duration_days IS NOT NULL THEN
      v_effective_days := v_battle.custom_duration_days;
      v_duration_source := 'custom';
    ELSE
      SELECT COALESCE((value->>'days')::int, 5)
      INTO v_effective_days
      FROM public.app_settings
      WHERE key = 'battle_default_duration_days'
      LIMIT 1;

      v_effective_days := COALESCE(v_effective_days, 5);
      v_duration_source := 'app_settings';
    END IF;

    v_new_voting_ends_at := now() + (v_effective_days || ' days')::interval;
  END IF;

  UPDATE public.battles
  SET status = 'active',
      admin_validated_at = now(),
      starts_at = COALESCE(starts_at, now()),
      voting_ends_at = CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE voting_ends_at
      END,
      updated_at = now()
  WHERE id = p_battle_id;

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
    'battle_validate_admin',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'source', 'admin_validate_battle',
      'status_before', v_battle.status,
      'status_after', 'active',
      'voting_ends_at_before', v_battle.voting_ends_at,
      'voting_ends_at_after', CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE v_battle.voting_ends_at
      END,
      'duration_source', v_duration_source,
      'effective_days', v_effective_days,
      'actor', v_actor
    ),
    1.0,
    'Battle validated by admin',
    'executed',
    false,
    true,
    now(),
    v_actor,
    NULL
  );

  IF v_battle.voting_ends_at IS NULL THEN
    INSERT INTO public.ai_admin_actions (
      action_type,
      entity_type,
      entity_id,
      ai_decision,
      confidence_score,
      reason,
      status,
      executed_at
    )
    VALUES (
      'battle_duration_set',
      'battle',
      p_battle_id,
      jsonb_build_object(
        'effective_days', v_effective_days,
        'custom_duration', v_battle.custom_duration_days,
        'source', CASE
          WHEN v_battle.custom_duration_days IS NOT NULL THEN 'custom'
          ELSE 'app_settings'
        END
      ),
      1.0,
      'Battle duration determined during admin validation',
      'executed',
      now()
    );
  END IF;

  UPDATE public.user_profiles
  SET battles_participated = COALESCE(battles_participated, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_validate_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'active',
      'duration_source', v_duration_source
    ),
    p_extra_details => jsonb_build_object(
      'effective_days', v_effective_days,
      'voting_ends_at_before', v_battle.voting_ends_at,
      'voting_ends_at_after', CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE v_battle.voting_ends_at
      END
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'admin_cancel_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'admin_cancel_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object('guard', 'rate_limit'),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status = 'completed' THEN
    RAISE EXCEPTION 'cannot_cancel_completed_battle';
  END IF;

  UPDATE public.battles
  SET status = 'cancelled',
      winner_id = NULL,
      updated_at = now()
  WHERE id = p_battle_id;

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
    'battle_cancel_admin',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'source', 'admin_cancel_battle',
      'status_before', v_battle.status,
      'status_after', 'cancelled',
      'actor', v_actor
    ),
    1.0,
    'Battle cancelled by admin',
    'executed',
    false,
    true,
    now(),
    v_actor,
    NULL
  );

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_cancel_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'cancelled'
    ),
    p_extra_details => '{}'::jsonb,
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_battle(p_battle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin_actor boolean := public.is_admin(v_actor);
  v_battle public.battles%ROWTYPE;
  v_winner_id uuid;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR v_is_admin_actor
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'finalize_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role,
        'is_admin_actor', v_is_admin_actor
      ),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status = 'cancelled' THEN
    RAISE EXCEPTION 'battle_cancelled';
  END IF;

  IF v_battle.status = 'completed' THEN
    IF v_is_admin_actor THEN
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
        'battle_finalize_admin',
        'battle',
        p_battle_id,
        jsonb_build_object(
          'source', 'finalize_battle',
          'noop', true,
          'already_completed', true,
          'winner_id', v_battle.winner_id,
          'actor', v_actor
        ),
        1.0,
        'Battle already completed (admin finalize noop)',
        'executed',
        false,
        true,
        now(),
        v_actor,
        NULL
      );
    END IF;

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'status_before', v_battle.status,
        'status_after', v_battle.status,
        'jwt_role', v_jwt_role,
        'is_admin_actor', v_is_admin_actor,
        'noop', true
      ),
      p_extra_details => jsonb_build_object('winner_id', v_battle.winner_id),
      p_success => true,
      p_error => NULL
    );

    RETURN v_battle.winner_id;
  END IF;

  IF v_battle.status NOT IN ('active', 'voting') THEN
    RAISE EXCEPTION 'battle_not_open_for_finalization';
  END IF;

  IF v_battle.votes_producer1 > v_battle.votes_producer2 THEN
    v_winner_id := v_battle.producer1_id;
  ELSIF v_battle.votes_producer2 > v_battle.votes_producer1 THEN
    v_winner_id := v_battle.producer2_id;
  ELSE
    v_winner_id := NULL;
  END IF;

  UPDATE public.battles
  SET status = 'completed',
      winner_id = v_winner_id,
      voting_ends_at = COALESCE(voting_ends_at, now()),
      updated_at = now()
  WHERE id = p_battle_id;

  UPDATE public.user_profiles
  SET battles_completed = COALESCE(battles_completed, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  IF v_is_admin_actor THEN
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
      'battle_finalize_admin',
      'battle',
      p_battle_id,
      jsonb_build_object(
        'source', 'finalize_battle',
        'noop', false,
        'status_before', v_battle.status,
        'status_after', 'completed',
        'winner_id', v_winner_id,
        'votes_producer1', v_battle.votes_producer1,
        'votes_producer2', v_battle.votes_producer2,
        'actor', v_actor
      ),
      1.0,
      'Battle finalized by admin',
      'executed',
      false,
      true,
      now(),
      v_actor,
      NULL
    );
  END IF;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'finalize_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'completed',
      'jwt_role', v_jwt_role,
      'is_admin_actor', v_is_admin_actor,
      'noop', false
    ),
    p_extra_details => jsonb_build_object(
      'winner_id', v_winner_id,
      'votes_producer1', v_battle.votes_producer1,
      'votes_producer2', v_battle.votes_producer2
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_winner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_extend_battle_duration(
  p_battle_id uuid,
  p_days integer,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_before_voting_ends_at timestamptz;
  v_after_voting_ends_at timestamptz;
  v_reason_text text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_extension_count integer := 0;
  v_extension_count_after integer := 0;
  v_limit_anchor timestamptz;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'admin_extend_battle_duration') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'admin_extend_battle_duration',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object('guard', 'rate_limit'),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'invalid_extension_days';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status NOT IN ('active', 'voting') THEN
    RAISE EXCEPTION 'battle_not_open_for_extension';
  END IF;

  IF v_battle.voting_ends_at IS NULL THEN
    RAISE EXCEPTION 'battle_has_no_voting_end';
  END IF;

  IF v_battle.voting_ends_at <= now() THEN
    RAISE EXCEPTION 'battle_already_expired';
  END IF;

  v_extension_count := COALESCE(v_battle.extension_count, 0);
  IF v_extension_count >= 5 THEN
    RAISE EXCEPTION 'maximum_extensions_reached';
  END IF;

  v_before_voting_ends_at := v_battle.voting_ends_at;
  v_after_voting_ends_at := v_before_voting_ends_at + (p_days || ' days')::interval;

  v_limit_anchor := COALESCE(v_battle.starts_at, now());
  IF v_after_voting_ends_at > (v_limit_anchor + interval '60 days') THEN
    RAISE EXCEPTION 'battle_extension_limit_exceeded';
  END IF;

  UPDATE public.battles
  SET voting_ends_at = v_after_voting_ends_at,
      extension_count = COALESCE(extension_count, 0) + 1,
      updated_at = now()
  WHERE id = p_battle_id
  RETURNING extension_count INTO v_extension_count_after;

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    executed_at,
    executed_by
  )
  VALUES (
    'battle_duration_extended',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'before_voting_ends_at', v_before_voting_ends_at,
      'after_voting_ends_at', v_after_voting_ends_at,
      'days_added', p_days,
      'extension_count_after', v_extension_count_after,
      'actor', v_actor,
      'reason_text', v_reason_text
    ),
    1.0,
    'Battle duration extended by admin',
    'executed',
    now(),
    v_actor
  );

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_extend_battle_duration',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status', v_battle.status,
      'reason_text', v_reason_text
    ),
    p_extra_details => jsonb_build_object(
      'before_voting_ends_at', v_before_voting_ends_at,
      'after_voting_ends_at', v_after_voting_ends_at,
      'days_added', p_days,
      'extension_count_before', v_extension_count,
      'extension_count_after', v_extension_count_after
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'finalize_expired_battles') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_expired_battles',
      p_entity_type => 'other',
      p_entity_id => NULL,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role
      ),
      p_extra_details => jsonb_build_object(
        'limit', v_limit,
        'message', 'rate_limit_exceeded'
      ),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  FOR v_row IN
    SELECT b.id
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    PERFORM public.finalize_battle(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'finalize_expired_battles',
    p_entity_type => 'other',
    p_entity_id => NULL,
    p_source => 'rpc',
    p_context => jsonb_build_object('jwt_role', v_jwt_role),
    p_extra_details => jsonb_build_object(
      'limit', v_limit,
      'finalized_count', v_count
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_candidate_id uuid;
  v_status public.battle_status;
  v_winner_id uuid;
  v_finalize_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'agent_finalize_expired_battles') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'agent_finalize_expired_battles',
      p_entity_type => 'other',
      p_entity_id => NULL,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role
      ),
      p_extra_details => jsonb_build_object(
        'limit', v_limit,
        'message', 'rate_limit_exceeded'
      ),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  FOR v_row IN
    SELECT b.id, b.status, b.voting_ends_at
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    v_candidate_ids := array_append(v_candidate_ids, v_row.id);
  END LOOP;

  BEGIN
    v_finalize_count := public.finalize_expired_battles(v_limit);
  EXCEPTION
    WHEN OTHERS THEN
      FOREACH v_candidate_id IN ARRAY v_candidate_ids
      LOOP
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
        ) VALUES (
          'battle_finalize',
          'battle',
          v_candidate_id,
          jsonb_build_object(
            'model', 'rule-based',
            'source', 'agent_finalize_expired_battles',
            'battle_id', v_candidate_id
          ),
          1,
          'Battle finalization failed in finalize_expired_battles wrapper.',
          'failed',
          false,
          true,
          now(),
          NULL,
          SQLERRM
        );
      END LOOP;

      PERFORM public.log_admin_action_audit(
        p_admin_user_id => v_actor,
        p_action_type => 'agent_finalize_expired_battles',
        p_entity_type => 'other',
        p_entity_id => NULL,
        p_source => 'rpc',
        p_context => jsonb_build_object('jwt_role', v_jwt_role),
        p_extra_details => jsonb_build_object(
          'limit', v_limit,
          'candidate_count', COALESCE(array_length(v_candidate_ids, 1), 0)
        ),
        p_success => false,
        p_error => SQLERRM
      );
      RAISE;
  END;

  FOREACH v_candidate_id IN ARRAY v_candidate_ids
  LOOP
    SELECT b.status, b.winner_id
    INTO v_status, v_winner_id
    FROM public.battles b
    WHERE b.id = v_candidate_id;

    IF v_status = 'completed' THEN
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
      ) VALUES (
        'battle_finalize',
        'battle',
        v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'winner_id', v_winner_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle auto-finalized by finalize_expired_battles().',
        'executed',
        false,
        true,
        now(),
        NULL,
        NULL
      );
      v_count := v_count + 1;
    ELSE
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
      ) VALUES (
        'battle_finalize',
        'battle',
        v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle not finalized by finalize_expired_battles().',
        'failed',
        false,
        true,
        now(),
        NULL,
        'battle_not_completed_after_finalize_call'
      );
    END IF;
  END LOOP;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'agent_finalize_expired_battles',
    p_entity_type => 'other',
    p_entity_id => NULL,
    p_source => 'rpc',
    p_context => jsonb_build_object('jwt_role', v_jwt_role),
    p_extra_details => jsonb_build_object(
      'limit', v_limit,
      'candidate_count', COALESCE(array_length(v_candidate_ids, 1), 0),
      'finalized_count', v_count,
      'finalize_expired_battles_count', v_finalize_count
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Grants / execute permissions
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.log_admin_action_audit(uuid, text, text, uuid, text, uuid, jsonb, jsonb, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_admin_action_audit(uuid, text, text, uuid, text, uuid, jsonb, jsonb, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_admin_action_audit(uuid, text, text, uuid, text, uuid, jsonb, jsonb, boolean, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.log_monitoring_alert(text, text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_monitoring_alert(text, text, text, text, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_monitoring_alert(text, text, text, text, uuid, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.get_request_headers_jsonb() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_request_headers_jsonb() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_request_headers_jsonb() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.check_rpc_rate_limit(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rpc_rate_limit(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_rpc_rate_limit(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rpc_rate_limit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rpc_rate_limit(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_battle(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_battle(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_battles(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_battles(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) TO service_role;

COMMIT;
