/*
  # Add processing lock column for Stripe webhook idempotency

  - Adds `processing_started_at` on `public.stripe_events` if missing.
  - Adds index on `(processed, processing_started_at)` for claim-lock lookups.
*/

BEGIN;

ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_processing_started_at
  ON public.stripe_events (processed, processing_started_at);

COMMIT;
