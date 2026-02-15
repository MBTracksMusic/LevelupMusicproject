-- Set the single producer plan price and amount (monthly)
INSERT INTO producer_plan_config (id, stripe_price_id, amount_cents, currency, interval, updated_at)
VALUES (
  true,
  'price_1Sity3EDvdPqljdSgleT4DDu', -- update if price_id changes
  2999,
  'eur',
  'month',
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  stripe_price_id = EXCLUDED.stripe_price_id,
  amount_cents = EXCLUDED.amount_cents,
  currency = EXCLUDED.currency,
  interval = EXCLUDED.interval,
  updated_at = now();
