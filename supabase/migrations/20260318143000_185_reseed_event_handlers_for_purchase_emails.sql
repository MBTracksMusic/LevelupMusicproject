/*
  # Reseed core event handlers for transactional emails

  Why:
  - The email pipeline can process events successfully while emitting no purchase
    emails when `public.event_handlers` is empty.
  - This migration restores required handlers idempotently.

  What:
  - Upsert core email handlers used by process-events/process-outbox.
*/

BEGIN;

INSERT INTO public.event_handlers (event_type, handler_type, handler_key, config, is_active)
VALUES
  ('USER_CONFIRMED', 'email', 'welcome_user', '{}'::jsonb, true),
  ('PRODUCER_ACTIVATED', 'email', 'producer_activation', '{}'::jsonb, true),
  ('BEAT_PURCHASED', 'email', 'purchase_receipt', '{}'::jsonb, true),
  ('LICENSE_GENERATED', 'email', 'license_ready', '{}'::jsonb, true),
  ('BATTLE_WON', 'email', 'battle_won', '{}'::jsonb, true),
  ('COMMENT_RECEIVED', 'email', 'comment_received', '{}'::jsonb, true)
ON CONFLICT (event_type, handler_type, handler_key) DO UPDATE
SET
  is_active = EXCLUDED.is_active,
  config = EXCLUDED.config,
  updated_at = now();

COMMIT;
