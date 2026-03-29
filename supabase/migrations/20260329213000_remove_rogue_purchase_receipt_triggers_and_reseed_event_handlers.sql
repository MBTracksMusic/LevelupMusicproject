/*
  # Remove rogue purchase receipt triggers and reseed event email handlers

  Why:
  - Production contains ad-hoc triggers on `public.purchases` that write
    directly to `public.email_queue`.
  - Those triggers bypass the event-driven email pipeline and can break
    purchase completion because `email_queue.source_event_id` must reference
    `public.event_bus(id)`.
  - `public.event_handlers` may also be empty in production, which disables
    purchase receipt emails even when events are published correctly.

  What:
  - Drop the rogue purchase receipt triggers and their trigger function if they
    exist.
  - Reseed the core transactional email handlers idempotently.
*/

BEGIN;

DROP TRIGGER IF EXISTS trg_purchase_receipt_on_insert ON public.purchases;
DROP TRIGGER IF EXISTS trg_purchase_receipt_on_update ON public.purchases;
DROP FUNCTION IF EXISTS public.enqueue_purchase_receipt_email();

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
