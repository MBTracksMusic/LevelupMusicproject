/*
  # Fix battle invitation event pipeline

  Migration 20260521175500 added BATTLE_INVITATION to event_bus/event_handlers,
  but event_outbox kept the older event_type CHECK. publish_event writes to
  event_outbox first and swallows errors, so battle creation succeeded while the
  invitation notification was silently dropped.

  This migration aligns all pipeline constraints and republishes recent
  pending_acceptance user battle invitations that have no existing event.
*/

BEGIN;

ALTER TABLE public.event_bus
  DROP CONSTRAINT IF EXISTS event_bus_event_type_check;

ALTER TABLE public.event_bus
  ADD CONSTRAINT event_bus_event_type_check
  CHECK (
    event_type IN (
      'USER_SIGNUP',
      'USER_CONFIRMED',
      'PRODUCER_ACTIVATED',
      'BEAT_PURCHASED',
      'LICENSE_GENERATED',
      'BATTLE_WON',
      'BATTLE_INVITATION',
      'COMMENT_RECEIVED'
    )
  );

ALTER TABLE public.event_handlers
  DROP CONSTRAINT IF EXISTS event_handlers_event_type_check;

ALTER TABLE public.event_handlers
  ADD CONSTRAINT event_handlers_event_type_check
  CHECK (
    event_type IN (
      'USER_SIGNUP',
      'USER_CONFIRMED',
      'PRODUCER_ACTIVATED',
      'BEAT_PURCHASED',
      'LICENSE_GENERATED',
      'BATTLE_WON',
      'BATTLE_INVITATION',
      'COMMENT_RECEIVED'
    )
  );

ALTER TABLE public.event_outbox
  DROP CONSTRAINT IF EXISTS event_outbox_event_type_check;

ALTER TABLE public.event_outbox
  ADD CONSTRAINT event_outbox_event_type_check
  CHECK (
    event_type IN (
      'USER_SIGNUP',
      'USER_CONFIRMED',
      'PRODUCER_ACTIVATED',
      'BEAT_PURCHASED',
      'LICENSE_GENERATED',
      'BATTLE_WON',
      'BATTLE_INVITATION',
      'COMMENT_RECEIVED'
    )
  );

INSERT INTO public.event_handlers (event_type, handler_type, handler_key, config, is_active)
VALUES
  ('BATTLE_INVITATION', 'email', 'battle_invitation', '{}'::jsonb, true)
ON CONFLICT (event_type, handler_type, handler_key) DO UPDATE
SET
  is_active = EXCLUDED.is_active,
  config = EXCLUDED.config,
  updated_at = now();

WITH missing_invitations AS (
  SELECT
    b.id,
    b.title,
    b.slug,
    b.producer1_id,
    b.producer2_id,
    b.response_deadline,
    lower(trim(invitee.email)) AS invitee_email,
    COALESCE(NULLIF(trim(inviter.full_name), ''), inviter.username, '') AS inviter_name
  FROM public.battles b
  LEFT JOIN public.user_profiles invitee ON invitee.id = b.producer2_id
  LEFT JOIN public.user_profiles inviter ON inviter.id = b.producer1_id
  WHERE b.status = 'pending_acceptance'::public.battle_status
    AND COALESCE(b.battle_type::text, 'user') = 'user'
    AND b.producer2_id IS NOT NULL
    AND b.created_at >= '2026-05-21 17:55:00+00'::timestamptz
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_outbox eo
      WHERE eo.event_type = 'BATTLE_INVITATION'
        AND eo.aggregate_id = b.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_bus eb
      WHERE eb.event_type = 'BATTLE_INVITATION'
        AND eb.aggregate_id = b.id
    )
)
SELECT public.publish_event(
  'BATTLE_INVITATION',
  producer2_id,
  jsonb_build_object(
    'aggregate_type', 'battle',
    'aggregate_id', id,
    'battle_id', id,
    'battle_title', COALESCE(title, ''),
    'battle_slug', COALESCE(slug, ''),
    'inviter_id', producer1_id,
    'inviter_name', inviter_name,
    'invitee_id', producer2_id,
    'response_deadline', response_deadline,
    'email', COALESCE(invitee_email, '')
  )
)
FROM missing_invitations;

COMMIT;
