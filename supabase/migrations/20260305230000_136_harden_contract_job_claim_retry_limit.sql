/*
  # Harden contract generation queue retries

  Goals:
  - Add explicit max_attempts to avoid infinite retry loops.
  - Keep claim logic race-safe with FOR UPDATE SKIP LOCKED.
  - Ensure only retry-eligible jobs are claimed.
*/

BEGIN;

ALTER TABLE public.contract_generation_jobs
  ADD COLUMN IF NOT EXISTS max_attempts integer;

UPDATE public.contract_generation_jobs
SET max_attempts = COALESCE(max_attempts, 8)
WHERE max_attempts IS NULL;

ALTER TABLE public.contract_generation_jobs
  ALTER COLUMN max_attempts SET DEFAULT 8;

ALTER TABLE public.contract_generation_jobs
  ALTER COLUMN max_attempts SET NOT NULL;

ALTER TABLE public.contract_generation_jobs
  DROP CONSTRAINT IF EXISTS contract_generation_jobs_max_attempts_check;

ALTER TABLE public.contract_generation_jobs
  ADD CONSTRAINT contract_generation_jobs_max_attempts_check
  CHECK (max_attempts >= 1);

CREATE OR REPLACE FUNCTION public.claim_contract_generation_jobs(
  p_limit integer DEFAULT 10,
  p_worker text DEFAULT NULL
)
RETURNS SETOF public.contract_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_worker text := COALESCE(NULLIF(btrim(COALESCE(p_worker, '')), ''), 'contract-worker');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_or_service_role_required';
  END IF;

  RETURN QUERY
  WITH reclaimed AS (
    UPDATE public.contract_generation_jobs j
    SET
      status = 'failed',
      last_error = COALESCE(j.last_error, 'stale_processing_lock'),
      locked_at = NULL,
      locked_by = NULL,
      next_run_at = now(),
      updated_at = now()
    WHERE j.status = 'processing'
      AND j.locked_at IS NOT NULL
      AND j.locked_at < now() - interval '10 minutes'
    RETURNING j.id
  ),
  candidates AS (
    SELECT j.id
    FROM public.contract_generation_jobs j
    WHERE j.status IN ('pending', 'failed')
      AND j.next_run_at <= now()
      AND j.attempts < j.max_attempts
    ORDER BY j.next_run_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.contract_generation_jobs j
    SET
      status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = v_worker,
      updated_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * FROM claimed;
END;
$$;

COMMIT;
