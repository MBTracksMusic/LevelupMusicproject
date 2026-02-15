/*
  # Track contract notification email delivery

  - Adds `purchases.contract_email_sent_at` to make contract email sending idempotent.
  - Allows contract-service to resend missing notifications safely for old purchases.
*/

BEGIN;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS contract_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_purchases_contract_email_sent_at
  ON public.purchases (contract_email_sent_at)
  WHERE contract_email_sent_at IS NOT NULL;

COMMIT;
