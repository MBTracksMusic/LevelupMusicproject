/*
  # Stripe Connect Transfers Tracking

  Goals:
  - Track each transfer to producer accounts
  - Enable payment reconciliation
  - Audit trail for support/investigations
  - Link purchases to actual Stripe transfers

  Table: stripe_transfers
  - Records each transfer_created/transfer_updated event from Stripe
  - Tracks transfer status and amounts
  - RLS ensures producers see only their transfers
*/

BEGIN;

-- Create stripe_transfers table
CREATE TABLE IF NOT EXISTS stripe_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  stripe_account_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,  -- Amount in cents
  currency TEXT NOT NULL DEFAULT 'eur',
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'in_transit', 'paid', 'failed'
  failure_code TEXT,
  failure_message TEXT,
  arrival_date TIMESTAMPTZ,  -- When money arrives in destination account
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_stripe_transfers_user_id
  ON stripe_transfers(user_id);

CREATE INDEX IF NOT EXISTS idx_stripe_transfers_stripe_account
  ON stripe_transfers(stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_stripe_transfers_status
  ON stripe_transfers(status);

CREATE INDEX IF NOT EXISTS idx_stripe_transfers_purchase_id
  ON stripe_transfers(purchase_id);

CREATE INDEX IF NOT EXISTS idx_stripe_transfers_created_at
  ON stripe_transfers(created_at DESC);

-- Enable Row Level Security
ALTER TABLE stripe_transfers ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own transfers
CREATE POLICY "Users can view own transfers"
  ON stripe_transfers FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can insert/update transfers (via webhook)
CREATE POLICY "Service role can manage transfers"
  ON stripe_transfers FOR ALL
  USING (auth.role() = 'service_role');

COMMIT;
