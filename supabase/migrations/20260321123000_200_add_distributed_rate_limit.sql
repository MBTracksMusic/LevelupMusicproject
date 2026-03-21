/*
  # Add distributed rate limiting primitives

  - Adds a shared public.rate_limits table
  - Adds a check_rate_limit RPC for edge functions
  - Locks down direct client access with fail-closed RLS
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at
  ON public.rate_limits (updated_at DESC);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.rate_limits FROM anon;
REVOKE ALL ON TABLE public.rate_limits FROM authenticated;

DROP POLICY IF EXISTS "Rate limits deny clients" ON public.rate_limits;
CREATE POLICY "Rate limits deny clients"
ON public.rate_limits
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_limit int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count int;
BEGIN
  INSERT INTO public.rate_limits(key, count, updated_at)
  VALUES (p_key, 1, now())
  ON CONFLICT (key)
  DO UPDATE SET count = public.rate_limits.count + 1,
                updated_at = now()
  RETURNING count INTO current_count;

  RETURN current_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, int) FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, int) TO service_role;

COMMIT;
