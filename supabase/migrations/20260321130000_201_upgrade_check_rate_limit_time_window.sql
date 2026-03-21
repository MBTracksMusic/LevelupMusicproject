/*
  # Upgrade distributed rate limit RPC with a 60-second rolling window

  - Keeps the same public.check_rate_limit(p_key text, p_limit int) signature
  - Resets the counter automatically when the last update is older than 60 seconds
  - Preserves SECURITY DEFINER and existing table/policy model
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_limit int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count int;
  last_updated timestamptz;
BEGIN
  SELECT count, updated_at
  INTO current_count, last_updated
  FROM public.rate_limits
  WHERE key = p_key;

  IF NOT FOUND THEN
    INSERT INTO public.rate_limits(key, count, updated_at)
    VALUES (p_key, 1, now());
    RETURN true;
  END IF;

  IF now() - last_updated > interval '60 seconds' THEN
    UPDATE public.rate_limits
    SET count = 1,
        updated_at = now()
    WHERE key = p_key;
    RETURN true;
  END IF;

  UPDATE public.rate_limits
  SET count = count + 1,
      updated_at = now()
  WHERE key = p_key
  RETURNING count INTO current_count;

  RETURN current_count <= p_limit;
END;
$$;

COMMIT;
