/*
  # Seed producer plan row if missing (idempotent)

  Scope:
  - Only touches public.producer_plan_config.
  - Inserts the single plan row when absent.
  - Does nothing if the row already exists.
*/

BEGIN;

INSERT INTO public.producer_plan_config (
  id,
  stripe_price_id,
  amount_cents,
  currency,
  interval,
  updated_at
)
VALUES (
  true,
  'price_1Sity3EDvdPqljdSgleT4DDu',
  2999,
  'eur',
  'month',
  now()
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
