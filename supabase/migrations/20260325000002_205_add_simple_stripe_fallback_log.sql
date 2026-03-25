/*
  # Log Simple Stripe Fallback Payments

  Goals:
  - Track purchases that fall back to simple Stripe (no Connect)
  - Enable support team to manually process producer payouts
  - Identify producers who need to activate Stripe Connect
  - Audit trail for payment reconciliation

  Table: simple_stripe_payments
  - Records purchases where producer doesn't have Stripe Connect activated
  - Tracks whether producer has been paid (manual process or pending)
  - RLS allows admins and service role to manage, producers to view
*/

BEGIN;

-- Create simple_stripe_payments table
CREATE TABLE IF NOT EXISTS simple_stripe_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  producer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,  -- Amount in cents (what platform received)
  producer_amount INTEGER NOT NULL,  -- Amount producer should receive (80%)
  platform_fee INTEGER NOT NULL,  -- Amount platform keeps (20%)
  currency TEXT NOT NULL DEFAULT 'eur',
  payment_status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'needs_connect', 'paid', 'refunded'
  notes TEXT,  -- Support notes about payout status
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_simple_stripe_purchase_id
  ON simple_stripe_payments(purchase_id);

CREATE INDEX IF NOT EXISTS idx_simple_stripe_producer_id
  ON simple_stripe_payments(producer_id);

CREATE INDEX IF NOT EXISTS idx_simple_stripe_payment_status
  ON simple_stripe_payments(payment_status);

CREATE INDEX IF NOT EXISTS idx_simple_stripe_created_at
  ON simple_stripe_payments(created_at DESC);

-- Enable Row Level Security
ALTER TABLE simple_stripe_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Producers can view their own pending payments
CREATE POLICY "Producers can view own pending payouts"
  ON simple_stripe_payments FOR SELECT
  USING (auth.uid() = producer_id);

-- RLS Policy: Service role and admins can manage
CREATE POLICY "Service role can manage simple stripe payments"
  ON simple_stripe_payments FOR ALL
  USING (auth.role() = 'service_role');

COMMIT;
