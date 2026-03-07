/*
  # Contract URL anti-amplification rate limits

  Adds durable counters for per-purchase throttling and configures per-user rules
  so /get-contract-url cannot be abused to trigger repeated PDF generation.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.contract_url_rate_limit_counters (
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purchase_id, user_id, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_contract_url_rate_limit_counters_purchase_window
  ON public.contract_url_rate_limit_counters (purchase_id, window_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_url_rate_limit_counters_user_window
  ON public.contract_url_rate_limit_counters (user_id, window_started_at DESC);

ALTER TABLE public.contract_url_rate_limit_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read contract url rate limit counters" ON public.contract_url_rate_limit_counters;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contract_url_rate_limit_counters'
      AND policyname = 'Admins can read contract url rate limit counters'
  ) THEN
    CREATE POLICY "Admins can read contract url rate limit counters"
    ON public.contract_url_rate_limit_counters
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_check_contract_url_rate_limit(
  p_purchase_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, auth.uid());
  v_window_start timestamptz := date_trunc('minute', now());
  v_rule public.rpc_rate_limit_rules%ROWTYPE;
  v_allowed integer := 2;
  v_request_count integer := 0;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'purchase_required';
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_rule
  FROM public.rpc_rate_limit_rules
  WHERE rpc_name = 'get_contract_url_purchase';

  IF FOUND THEN
    IF COALESCE(v_rule.is_enabled, true) = false THEN
      RETURN true;
    END IF;

    v_allowed := GREATEST(1, COALESCE(v_rule.allowed_per_minute, v_allowed));
  END IF;

  INSERT INTO public.contract_url_rate_limit_counters (
    purchase_id,
    user_id,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_purchase_id,
    v_user_id,
    v_window_start,
    1,
    now()
  )
  ON CONFLICT (purchase_id, user_id, window_started_at)
  DO UPDATE
    SET request_count = public.contract_url_rate_limit_counters.request_count + 1,
        updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > v_allowed THEN
    INSERT INTO public.rpc_rate_limit_hits (
      rpc_name,
      user_id,
      scope_key,
      allowed_per_minute,
      observed_count,
      context
    )
    VALUES (
      'get_contract_url_purchase',
      v_user_id,
      concat_ws(':', p_purchase_id::text, v_user_id::text),
      v_allowed,
      v_request_count,
      jsonb_build_object(
        'purchase_id', p_purchase_id,
        'source', 'rpc_check_contract_url_rate_limit'
      )
    );

    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_check_contract_url_rate_limit(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_check_contract_url_rate_limit(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_check_contract_url_rate_limit(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_check_contract_url_rate_limit(uuid, uuid) TO service_role;

INSERT INTO public.rpc_rate_limit_rules (rpc_name, scope, allowed_per_minute, is_enabled)
VALUES
  ('get_contract_url_user', 'per_user', 10, true),
  ('get_contract_url_purchase', 'per_user', 2, true)
ON CONFLICT (rpc_name)
DO UPDATE SET
  scope = EXCLUDED.scope,
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

COMMIT;
