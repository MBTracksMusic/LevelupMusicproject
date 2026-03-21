BEGIN;

ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE TABLE IF NOT EXISTS public.waitlist_rate_limit (
  scope text NOT NULL CHECK (scope IN ('ip', 'email')),
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  counter integer NOT NULL DEFAULT 0 CHECK (counter >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_rate_limit_window_start
  ON public.waitlist_rate_limit (window_start DESC);

ALTER TABLE public.waitlist_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage waitlist rate limit" ON public.waitlist_rate_limit;
CREATE POLICY "Service role can manage waitlist rate limit"
ON public.waitlist_rate_limit
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON TABLE public.waitlist_rate_limit FROM anon;
REVOKE ALL ON TABLE public.waitlist_rate_limit FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.waitlist_rate_limit TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_waitlist_rate_limit(
  p_ip_hash text,
  p_email_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip_hash text := btrim(COALESCE(p_ip_hash, ''));
  v_email_hash text := btrim(COALESCE(p_email_hash, ''));
  v_ip_window timestamptz;
  v_email_window timestamptz;
  v_ip_counter integer := 0;
  v_email_counter integer := 0;
BEGIN
  IF v_ip_hash = '' OR v_email_hash = '' THEN
    RAISE EXCEPTION 'invalid_rate_limit_key';
  END IF;

  v_ip_window := date_trunc('hour', now())
    + floor(extract(minute from now()) / 10)::int * interval '10 minutes';
  v_email_window := date_trunc('day', now());

  INSERT INTO public.waitlist_rate_limit (scope, key_hash, window_start, counter, updated_at)
  VALUES ('ip', v_ip_hash, v_ip_window, 1, now())
  ON CONFLICT (scope, key_hash, window_start)
  DO UPDATE
    SET counter = public.waitlist_rate_limit.counter + 1,
        updated_at = now()
  RETURNING counter INTO v_ip_counter;

  INSERT INTO public.waitlist_rate_limit (scope, key_hash, window_start, counter, updated_at)
  VALUES ('email', v_email_hash, v_email_window, 1, now())
  ON CONFLICT (scope, key_hash, window_start)
  DO UPDATE
    SET counter = public.waitlist_rate_limit.counter + 1,
        updated_at = now()
  RETURNING counter INTO v_email_counter;

  IF v_ip_counter > 5 OR v_email_counter > 3 THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  DELETE FROM public.waitlist_rate_limit
  WHERE window_start < now() - interval '7 days';

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_waitlist_rate_limit(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_waitlist_rate_limit(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_waitlist_rate_limit(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_waitlist_rate_limit(text, text) TO service_role;

COMMIT;
