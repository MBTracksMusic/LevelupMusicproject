/*
  # Durable rate limit for contact-submit

  Adds DB-backed throttling keyed by anonymized IP hash.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_submit_rate_limit (
  ip_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  counter integer NOT NULL DEFAULT 0 CHECK (counter >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_contact_submit_rate_limit_window_start
  ON public.contact_submit_rate_limit (window_start DESC);

ALTER TABLE public.contact_submit_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read contact submit rate limit" ON public.contact_submit_rate_limit;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contact_submit_rate_limit'
      AND policyname = 'Admins can read contact submit rate limit'
  ) THEN
    CREATE POLICY "Admins can read contact submit rate limit"
    ON public.contact_submit_rate_limit
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_contact_submit_rate_limit(p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip_hash text := btrim(COALESCE(p_ip_hash, ''));
  v_window_start timestamptz;
  v_counter integer := 0;
BEGIN
  IF v_ip_hash = '' THEN
    RAISE EXCEPTION 'invalid_ip_hash';
  END IF;

  v_window_start := date_trunc('hour', now())
    + floor(extract(minute from now()) / 10)::int * interval '10 minutes';

  INSERT INTO public.contact_submit_rate_limit (
    ip_hash,
    window_start,
    counter,
    updated_at
  )
  VALUES (
    v_ip_hash,
    v_window_start,
    1,
    now()
  )
  ON CONFLICT (ip_hash, window_start)
  DO UPDATE
    SET counter = public.contact_submit_rate_limit.counter + 1,
        updated_at = now()
  RETURNING counter INTO v_counter;

  IF v_counter > 5 THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  DELETE FROM public.contact_submit_rate_limit
  WHERE window_start < now() - interval '2 days';

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_contact_submit_rate_limit(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_contact_submit_rate_limit(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_contact_submit_rate_limit(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_contact_submit_rate_limit(text) TO service_role;

COMMIT;
