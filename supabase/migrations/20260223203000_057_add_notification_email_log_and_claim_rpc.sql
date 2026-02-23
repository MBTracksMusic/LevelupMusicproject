/*
  # Add idempotent + rate-limited email claim guard for webhook notifications

  Why:
  - Prevent duplicate emails for the same business event (idempotency key)
  - Prevent email bursts to the same recipient/category (rate limit window)
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  recipient_email text NOT NULL,
  dedupe_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_email_log_dedupe_key
  ON public.notification_email_log (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notification_email_log_rate_lookup
  ON public.notification_email_log (category, recipient_email, created_at DESC);

ALTER TABLE public.notification_email_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notification_email_log FROM anon;
REVOKE ALL ON TABLE public.notification_email_log FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_email_log TO service_role;

DROP POLICY IF EXISTS "Service role can manage notification email log" ON public.notification_email_log;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'notification_email_log'
    AND policyname = 'Service role can manage notification email log'
  ) THEN
    CREATE POLICY "Service role can manage notification email log"
  ON public.notification_email_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_notification_email_send(
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
  v_recent_exists boolean := false;
BEGIN
  IF v_category = '' OR v_recipient_email = '' OR v_dedupe_key = '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_params');
  END IF;

  IF v_rate_limit_seconds <= 0 THEN
    v_rate_limit_seconds := 900;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_category || ':' || v_recipient_email, 0));

  IF EXISTS (
    SELECT 1
    FROM public.notification_email_log nel
    WHERE nel.dedupe_key = v_dedupe_key
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_dedupe');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.notification_email_log nel
    WHERE nel.category = v_category
      AND nel.recipient_email = v_recipient_email
      AND nel.created_at >= (now() - make_interval(secs => v_rate_limit_seconds))
  ) INTO v_recent_exists;

  IF v_recent_exists THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.notification_email_log (
    category,
    recipient_email,
    dedupe_key,
    metadata
  )
  VALUES (
    v_category,
    v_recipient_email,
    v_dedupe_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_dedupe');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'claimed');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notification_email_send(text, text, text, integer, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_email_send(text, text, text, integer, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_email_send(text, text, text, integer, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_send(text, text, text, integer, jsonb) TO service_role;

COMMIT;
