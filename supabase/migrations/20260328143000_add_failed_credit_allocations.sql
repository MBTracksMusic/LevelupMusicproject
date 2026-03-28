BEGIN;

CREATE TABLE IF NOT EXISTS public.failed_credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_invoice_id text CHECK (stripe_invoice_id IS NULL OR btrim(stripe_invoice_id) <> ''),
  stripe_subscription_id text CHECK (stripe_subscription_id IS NULL OR btrim(stripe_subscription_id) <> ''),
  stripe_event_id text NOT NULL CHECK (btrim(stripe_event_id) <> ''),
  error_message text NOT NULL CHECK (btrim(error_message) <> ''),
  error_code text CHECK (error_code IS NULL OR btrim(error_code) <> ''),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_failed_credit_allocations_stripe_event UNIQUE (stripe_event_id)
);

CREATE INDEX IF NOT EXISTS idx_failed_credit_allocations_invoice
  ON public.failed_credit_allocations (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_failed_credit_allocations_next_retry_at
  ON public.failed_credit_allocations (next_retry_at);

CREATE INDEX IF NOT EXISTS idx_failed_credit_allocations_created_at
  ON public.failed_credit_allocations (created_at DESC);

ALTER TABLE public.failed_credit_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can insert failed credit allocations" ON public.failed_credit_allocations;
CREATE POLICY "Service role can insert failed credit allocations"
  ON public.failed_credit_allocations
  FOR INSERT
  TO service_role
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update failed credit allocations" ON public.failed_credit_allocations;
CREATE POLICY "Service role can update failed credit allocations"
  ON public.failed_credit_allocations
  FOR UPDATE
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can select failed credit allocations" ON public.failed_credit_allocations;
CREATE POLICY "Service role can select failed credit allocations"
  ON public.failed_credit_allocations
  FOR SELECT
  TO service_role
  USING (auth.role() = 'service_role');

COMMIT;
