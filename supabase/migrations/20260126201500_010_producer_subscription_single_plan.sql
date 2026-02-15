/*
  # Producer subscription (unique, monthly, server-side)

  This migration creates the single source of truth for producer subscriptions,
  enforces one active subscription per user, and keeps user_profiles.is_producer_active
  in sync based on Stripe webhook updates.
*/

-- 1) Main table: one subscription per user
CREATE TABLE IF NOT EXISTS producer_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL,
  subscription_status text NOT NULL CHECK (
    subscription_status IN ('active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired')
  ),
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  is_producer_active boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_producer_subscription_user UNIQUE (user_id),
  CONSTRAINT uq_producer_subscription_stripe UNIQUE (stripe_subscription_id)
);

-- 2) Trigger to keep timestamps and compute is_producer_active
CREATE OR REPLACE FUNCTION set_producer_subscription_flags()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.is_producer_active :=
    (NEW.subscription_status IN ('active','trialing'))
    AND (NEW.current_period_end > now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_producer_subscriptions_flags ON producer_subscriptions;
CREATE TRIGGER trg_producer_subscriptions_flags
  BEFORE INSERT OR UPDATE ON producer_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_producer_subscription_flags();

-- 3) Keep user_profiles.is_producer_active in sync (used by existing front)
CREATE OR REPLACE FUNCTION sync_user_profile_producer_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.user_profiles
    SET is_producer_active = NEW.is_producer_active,
        updated_at = now()
    WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_profile_producer ON producer_subscriptions;
CREATE TRIGGER trg_sync_user_profile_producer
  AFTER INSERT OR UPDATE ON producer_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_profile_producer_flag();

-- 4) RLS: only owners can read; writes are meant to be done with service role (webhook)
ALTER TABLE producer_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Producer subscriptions: owner can read" ON producer_subscriptions;
CREATE POLICY "Producer subscriptions: owner can read"
  ON producer_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated users (must be done server-side with service role key)

-- 5) Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_producer_subscriptions_user ON producer_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_producer_subscriptions_subscription ON producer_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_producer_subscriptions_active_until ON producer_subscriptions(current_period_end);

-- 6) Config table to store the single Stripe price id (no hardcode in client)
CREATE TABLE IF NOT EXISTS producer_plan_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  stripe_price_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  interval text NOT NULL CHECK (interval = 'month'),
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Ensure only one row exists; use upsert to set it
INSERT INTO producer_plan_config (id, stripe_price_id, amount_cents, currency, interval)
VALUES (true, 'price_REPLACE_ME', 0, 'eur', 'month')
ON CONFLICT (id) DO UPDATE
SET stripe_price_id = EXCLUDED.stripe_price_id,
    amount_cents = EXCLUDED.amount_cents,
    currency = EXCLUDED.currency,
    updated_at = now();
