/*
  # Battle notifications: invitation email + admin validation alerts

  Adds two missing notification flows:

  1. BATTLE_INVITATION (event bus path)
     - When producer A creates a battle (status = 'pending_acceptance'),
       producer B receives a transactional email inviting them to accept/reject.

  2. Admin validation alert (direct email_queue + admin_notifications path)
     - When the battle status transitions to 'awaiting_admin'
       (i.e. producer B accepted), every admin gets:
         a) an in-app notification (admin_notifications, already wired to AdminBattles UI)
         b) a transactional email to their personal address
     - We fan out per admin directly into email_queue to avoid the event_bus
       unique (event_type, aggregate_id) constraint, matching the pattern used
       by contact_admin_notification.
*/

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Extend event_bus + event_handlers to accept BATTLE_INVITATION
-- -----------------------------------------------------------------------------

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

INSERT INTO public.event_handlers (event_type, handler_type, handler_key, config, is_active)
VALUES
  ('BATTLE_INVITATION', 'email', 'battle_invitation', '{}'::jsonb, true)
ON CONFLICT (event_type, handler_type, handler_key) DO UPDATE
SET
  is_active = EXCLUDED.is_active,
  config = EXCLUDED.config,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 2) Trigger: publish BATTLE_INVITATION when a battle is created
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.publish_battle_invitation_on_battle_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitee_email text;
  v_inviter_name text;
  v_battle_title text;
  v_battle_slug text;
BEGIN
  -- Only fire for invitations awaiting the second producer's response.
  IF NEW.status::text != 'pending_acceptance' THEN
    RETURN NEW;
  END IF;

  -- Safety: must have an invitee to notify.
  IF NEW.producer2_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(trim(up.email))
  INTO v_invitee_email
  FROM public.user_profiles up
  WHERE up.id = NEW.producer2_id;

  SELECT COALESCE(NULLIF(trim(up.full_name), ''), up.username, '')
  INTO v_inviter_name
  FROM public.user_profiles up
  WHERE up.id = NEW.producer1_id;

  v_battle_title := COALESCE(NEW.title, '');
  v_battle_slug := COALESCE(NEW.slug, '');

  PERFORM public.publish_event(
    'BATTLE_INVITATION',
    NEW.producer2_id,
    jsonb_build_object(
      'aggregate_type', 'battle',
      'aggregate_id', NEW.id,
      'battle_id', NEW.id,
      'battle_title', v_battle_title,
      'battle_slug', v_battle_slug,
      'inviter_id', NEW.producer1_id,
      'inviter_name', v_inviter_name,
      'invitee_id', NEW.producer2_id,
      'response_deadline', NEW.response_deadline,
      'email', COALESCE(v_invitee_email, '')
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_battle_created_publish_invitation ON public.battles;
CREATE TRIGGER on_battle_created_publish_invitation
  AFTER INSERT ON public.battles
  FOR EACH ROW
  EXECUTE FUNCTION public.publish_battle_invitation_on_battle_insert();

-- -----------------------------------------------------------------------------
-- 3) Trigger: notify all admins when a battle reaches 'awaiting_admin'
--    - inserts one admin_notifications row per admin (in-app)
--    - inserts one email_queue row per admin with valid email (transactional)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_admins_on_battle_awaiting_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_status text := COALESCE(OLD.status::text, '');
  v_new_status text := COALESCE(NEW.status::text, '');
  v_battle_title text := COALESCE(NEW.title, '');
  v_producer1_name text;
  v_producer2_name text;
  v_accepted_at text := COALESCE(to_char(NEW.accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '');
  v_payload jsonb;
BEGIN
  -- Only fire on the actual transition into awaiting_admin.
  IF v_old_status = v_new_status OR v_new_status != 'awaiting_admin' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(up.full_name), ''), up.username, '')
  INTO v_producer1_name
  FROM public.user_profiles up
  WHERE up.id = NEW.producer1_id;

  SELECT COALESCE(NULLIF(trim(up.full_name), ''), up.username, '')
  INTO v_producer2_name
  FROM public.user_profiles up
  WHERE up.id = NEW.producer2_id;

  v_payload := jsonb_build_object(
    'battle_id', NEW.id,
    'battle_title', v_battle_title,
    'battle_slug', COALESCE(NEW.slug, ''),
    'producer1_id', NEW.producer1_id,
    'producer1_name', v_producer1_name,
    'producer2_id', NEW.producer2_id,
    'producer2_name', v_producer2_name,
    'accepted_at', v_accepted_at,
    'source', 'battle_awaiting_admin_trigger'
  );

  -- 3a) In-app admin notifications: one row per admin user.
  INSERT INTO public.admin_notifications (user_id, type, payload)
  SELECT up.id, 'battle_awaiting_validation', v_payload
  FROM public.user_profiles up
  WHERE up.role = 'admin'::public.user_role
    AND COALESCE(up.is_deleted, false) = false
    AND up.deleted_at IS NULL;

  -- 3b) Transactional emails: one queue row per admin with a valid email.
  INSERT INTO public.email_queue (user_id, email, template, payload, status)
  SELECT
    up.id,
    lower(trim(up.email)),
    'battle_awaiting_admin',
    v_payload,
    'pending'
  FROM public.user_profiles up
  WHERE up.role = 'admin'::public.user_role
    AND COALESCE(up.is_deleted, false) = false
    AND up.deleted_at IS NULL
    AND up.email IS NOT NULL
    AND length(trim(up.email)) > 0;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_battle_awaiting_admin_notify_admins ON public.battles;
CREATE TRIGGER on_battle_awaiting_admin_notify_admins
  AFTER UPDATE OF status ON public.battles
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status::text = 'awaiting_admin')
  EXECUTE FUNCTION public.notify_admins_on_battle_awaiting_admin();

COMMIT;
