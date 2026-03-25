/*
  # Stripe Payout Failures Tracking

  Goals:
  - Track payout failures from Stripe Connect accounts
  - Provide audit trail for producer debugging
  - Enable support team to identify issues with producer accounts

  Table: stripe_payout_failures
  - Logs when Stripe fails to send money to a producer's account
  - Captures failure code and message from Stripe
  - Links to user_profiles via user_id and stripe_account_id
  - RLS ensures producers can only view their own failures
*/

BEGIN;

-- Create stripe_payout_failures table
CREATE TABLE IF NOT EXISTS stripe_payout_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  payout_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  failure_code TEXT NOT NULL DEFAULT 'unknown',
  failure_message TEXT,
  arrival_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payout_failures_user_id
  ON stripe_payout_failures(user_id);

CREATE INDEX IF NOT EXISTS idx_payout_failures_stripe_account
  ON stripe_payout_failures(stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_payout_failures_created_at
  ON stripe_payout_failures(created_at DESC);

-- Enable Row Level Security
ALTER TABLE stripe_payout_failures ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own payout failures
CREATE POLICY "Users can view own payout failures"
  ON stripe_payout_failures FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can insert payout failures (via webhook)
CREATE POLICY "Service role can insert payout failures"
  ON stripe_payout_failures FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policy: Service role can select all (for admin operations)
CREATE POLICY "Service role can select all payout failures"
  ON stripe_payout_failures FOR SELECT
  USING (auth.role() = 'service_role');

COMMIT;
