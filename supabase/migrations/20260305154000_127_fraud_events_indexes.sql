/*
  # Add targeted fraud_events indexes for admin analytics
*/

BEGIN;

CREATE INDEX IF NOT EXISTS idx_fraud_events_battle_id
ON public.fraud_events (battle_id);

CREATE INDEX IF NOT EXISTS idx_fraud_events_user_id
ON public.fraud_events (user_id);

CREATE INDEX IF NOT EXISTS idx_fraud_events_ip_hash
ON public.fraud_events (ip_hash);

CREATE INDEX IF NOT EXISTS idx_fraud_events_event_type_created_at
ON public.fraud_events (event_type, created_at DESC);

COMMIT;
