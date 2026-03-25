/*
  # Stripe Webhook Event Log for Idempotence & Audit

  Goals:
  - Track all Stripe webhook events processed
  - Prevent duplicate processing
  - Provide audit trail for troubleshooting

  Table: stripe_webhook_events
  - Logs each webhook event from Stripe
  - Tracks processing status (pending, processed, failed)
  - Links to affected records (user, purchase, etc.)
*/

BEGIN;

-- Create stripe_webhook_events table
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  account_id TEXT,  -- For Connect webhooks
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processed', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_stripe_event_id
  ON stripe_webhook_events(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_type
  ON stripe_webhook_events(event_type);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status
  ON stripe_webhook_events(status);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_user_id
  ON stripe_webhook_events(user_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created_at
  ON stripe_webhook_events(created_at DESC);

-- Enable Row Level Security
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Service role can read/write all
CREATE POLICY "Service role can manage webhook events"
  ON stripe_webhook_events FOR ALL
  USING (auth.role() = 'service_role');

-- RLS Policy: Users can view their own events (optional transparency)
CREATE POLICY "Users can view own webhook events"
  ON stripe_webhook_events FOR SELECT
  USING (auth.uid() = user_id);

COMMIT;
