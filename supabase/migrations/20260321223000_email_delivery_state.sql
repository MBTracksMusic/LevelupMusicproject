BEGIN;

ALTER TABLE public.notification_email_log
  ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'claimed',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS send_state_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_email_log_send_state_check'
      AND conrelid = 'public.notification_email_log'::regclass
  ) THEN
    ALTER TABLE public.notification_email_log
      ADD CONSTRAINT notification_email_log_send_state_check
      CHECK (send_state IN ('pending', 'claimed', 'sending', 'sent', 'failed_retryable', 'failed_final', 'provider_accepted_db_persist_failed'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_queue_send_state_check'
      AND conrelid = 'public.email_queue'::regclass
  ) THEN
    ALTER TABLE public.email_queue
      ADD CONSTRAINT email_queue_send_state_check
      CHECK (send_state IN ('pending', 'claimed', 'sending', 'sent', 'failed_retryable', 'failed_final', 'provider_accepted_db_persist_failed'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_notification_email_log_provider_message_id
  ON public.notification_email_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_queue_provider_message_id
  ON public.email_queue (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_email_log_send_state
  ON public.notification_email_log (send_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_queue_send_state
  ON public.email_queue (send_state, send_state_updated_at DESC);

CREATE OR REPLACE FUNCTION public.claim_notification_email_delivery(
  p_category text,
  p_recipient_email text,
  p_dedupe_key text,
  p_rate_limit_seconds integer DEFAULT 900,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text := trim(coalesce(p_category, ''));
  v_recipient_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_dedupe_key text := trim(coalesce(p_dedupe_key, ''));
  v_rate_limit_seconds integer := GREATEST(coalesce(p_rate_limit_seconds, 0), 0);
  v_existing_state text;
BEGIN
  IF v_category = '' OR v_recipient_email = '' OR v_dedupe_key = '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_params');
  END IF;

  IF v_rate_limit_seconds <= 0 THEN
    v_rate_limit_seconds := 900;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_category || ':' || v_recipient_email || ':' || v_dedupe_key, 0));

  SELECT send_state
  INTO v_existing_state
  FROM public.notification_email_log
  WHERE dedupe_key = v_dedupe_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_state = 'failed_retryable' THEN
      UPDATE public.notification_email_log
      SET send_state = 'claimed',
          updated_at = now(),
          last_error = null,
          metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb)
      WHERE dedupe_key = v_dedupe_key;

      RETURN jsonb_build_object('allowed', true, 'reason', 'retry_claimed', 'dedupe_key', v_dedupe_key);
    END IF;

    RETURN jsonb_build_object('allowed', false, 'reason', coalesce(v_existing_state, 'duplicate_dedupe'), 'dedupe_key', v_dedupe_key);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notification_email_log nel
    WHERE nel.category = v_category
      AND nel.recipient_email = v_recipient_email
      AND nel.send_state IN ('claimed', 'sending', 'sent', 'provider_accepted_db_persist_failed')
      AND nel.created_at >= (now() - make_interval(secs => v_rate_limit_seconds))
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.notification_email_log (
    category,
    recipient_email,
    dedupe_key,
    metadata,
    send_state,
    updated_at
  )
  VALUES (
    v_category,
    v_recipient_email,
    v_dedupe_key,
    COALESCE(p_metadata, '{}'::jsonb),
    'claimed',
    now()
  );

  RETURN jsonb_build_object('allowed', true, 'reason', 'claimed', 'dedupe_key', v_dedupe_key);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notification_email_delivery(text, text, text, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_email_delivery(text, text, text, integer, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_email_delivery(text, text, text, integer, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_delivery(text, text, text, integer, jsonb) TO service_role;

CREATE OR REPLACE VIEW public.email_delivery_debug_v1 AS
SELECT
  'email_queue'::text AS source_table,
  eq.id::text AS source_id,
  eq.template AS flow_key,
  eq.email AS recipient_email,
  eq.status AS queue_status,
  eq.send_state,
  eq.provider_message_id,
  eq.last_error,
  eq.created_at,
  eq.last_attempted_at,
  eq.sent_at,
  eq.provider_accepted_at
FROM public.email_queue eq
UNION ALL
SELECT
  'notification_email_log'::text AS source_table,
  nel.id::text AS source_id,
  nel.dedupe_key AS flow_key,
  nel.recipient_email,
  null::text AS queue_status,
  nel.send_state,
  nel.provider_message_id,
  nel.last_error,
  nel.created_at,
  nel.last_attempted_at,
  nel.sent_at,
  nel.provider_accepted_at
FROM public.notification_email_log nel;

GRANT SELECT ON public.email_delivery_debug_v1 TO service_role;

COMMIT;
