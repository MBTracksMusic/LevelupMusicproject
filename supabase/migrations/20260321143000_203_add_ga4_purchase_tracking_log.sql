/*
  # Add server-side GA4 purchase tracking idempotency log

  - Stores authoritative transaction ids already sent to GA4
  - Prevents duplicate purchase tracking across Stripe webhook retries/events
  - Keeps the table private to service_role only
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.ga4_tracked_purchases (
  transaction_id text PRIMARY KEY,
  stripe_event_id text,
  event_name text NOT NULL,
  tracked_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ga4_tracked_purchases_stripe_event_id
  ON public.ga4_tracked_purchases (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

ALTER TABLE public.ga4_tracked_purchases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ga4_tracked_purchases FROM PUBLIC;
REVOKE ALL ON TABLE public.ga4_tracked_purchases FROM anon;
REVOKE ALL ON TABLE public.ga4_tracked_purchases FROM authenticated;

DROP POLICY IF EXISTS "GA4 tracked purchases deny clients" ON public.ga4_tracked_purchases;
CREATE POLICY "GA4 tracked purchases deny clients"
ON public.ga4_tracked_purchases
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

GRANT ALL ON TABLE public.ga4_tracked_purchases TO service_role;

COMMIT;
