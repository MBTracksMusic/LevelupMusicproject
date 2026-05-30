/*
  # Battle user status notifications

  Adds producer-facing in-app notifications and transactional emails for the
  missing battle workflow transitions:
  - invited producer accepts: notify the requester
  - invited producer refuses: notify the requester
  - admin validates: notify both producers
  - admin cancels/refuses: notify both producers
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_battle_users_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_battle_title text := COALESCE(NULLIF(trim(NEW.title), ''), 'Battle');
  v_battle_slug text := COALESCE(NEW.slug, '');
  v_producer1_name text;
  v_producer2_name text;
  v_type text;
  v_title text;
  v_message text;
  v_template text;
  v_payload jsonb;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text NOT IN ('awaiting_admin', 'rejected', 'active', 'cancelled') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(up.full_name), ''), up.username, 'Le demandeur')
  INTO v_producer1_name
  FROM public.user_profiles up
  WHERE up.id = NEW.producer1_id;

  SELECT COALESCE(NULLIF(trim(up.full_name), ''), up.username, 'Le producteur invite')
  INTO v_producer2_name
  FROM public.user_profiles up
  WHERE up.id = NEW.producer2_id;

  v_producer1_name := COALESCE(v_producer1_name, 'Le demandeur');
  v_producer2_name := COALESCE(v_producer2_name, 'Le producteur invite');

  IF OLD.status::text = 'pending_acceptance' AND NEW.status::text = 'awaiting_admin' THEN
    v_type := 'battle_invitation_accepted';
    v_title := 'Invitation battle acceptee';
    v_message := format(
      '%s a accepte la battle "%s". Elle attend maintenant la validation admin.',
      v_producer2_name,
      v_battle_title
    );
    v_template := 'battle_request_accepted';
  ELSIF OLD.status::text = 'pending_acceptance' AND NEW.status::text = 'rejected' THEN
    v_type := 'battle_invitation_rejected';
    v_title := 'Invitation battle refusee';
    v_message := format(
      '%s a refuse la battle "%s"%s',
      v_producer2_name,
      v_battle_title,
      CASE
        WHEN NULLIF(trim(COALESCE(NEW.rejection_reason, '')), '') IS NOT NULL
          THEN format(' : %s', NEW.rejection_reason)
        ELSE '.'
      END
    );
    v_template := 'battle_request_rejected';
  ELSIF NEW.status::text = 'active' THEN
    v_type := 'battle_admin_approved';
    v_title := 'Battle validee';
    v_message := format(
      'La battle "%s" a ete validee par l admin et est maintenant ouverte au vote.',
      v_battle_title
    );
    v_template := 'battle_admin_approved';
  ELSIF NEW.status::text = 'cancelled' THEN
    v_type := 'battle_admin_rejected';
    v_title := 'Battle non validee';
    v_message := format(
      'La battle "%s" a ete refusee ou annulee par l admin.',
      v_battle_title
    );
    v_template := 'battle_admin_rejected';
  END IF;

  IF v_type IS NULL OR v_template IS NULL THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'battle_id', NEW.id,
    'battle_title', v_battle_title,
    'battle_slug', v_battle_slug,
    'status_before', OLD.status::text,
    'status_after', NEW.status::text,
    'producer1_id', NEW.producer1_id,
    'producer1_name', v_producer1_name,
    'producer2_id', NEW.producer2_id,
    'producer2_name', v_producer2_name,
    'rejection_reason', NEW.rejection_reason,
    'admin_validated_at', NEW.admin_validated_at,
    'voting_ends_at', NEW.voting_ends_at,
    'source', 'battle_status_user_notification_trigger'
  );

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message)
    SELECT DISTINCT r.user_id, v_type, v_title, v_message
    FROM (
      SELECT NEW.producer1_id AS user_id
      WHERE v_type IN ('battle_invitation_accepted', 'battle_invitation_rejected', 'battle_admin_approved', 'battle_admin_rejected')
      UNION ALL
      SELECT NEW.producer2_id AS user_id
      WHERE v_type IN ('battle_admin_approved', 'battle_admin_rejected')
        AND NEW.producer2_id IS NOT NULL
    ) r
    WHERE r.user_id IS NOT NULL;
  EXCEPTION
    WHEN others THEN
      RAISE NOTICE 'battle user in-app notification failed for battle %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.email_queue (user_id, email, template, payload, status)
    SELECT
      NULL::uuid,
      lower(trim(up.email)),
      v_template,
      v_payload || jsonb_build_object(
        'recipient_id', up.id,
        'recipient_name', COALESCE(NULLIF(trim(up.full_name), ''), up.username, '')
      ),
      'pending'
    FROM (
      SELECT NEW.producer1_id AS user_id
      WHERE v_type IN ('battle_invitation_accepted', 'battle_invitation_rejected', 'battle_admin_approved', 'battle_admin_rejected')
      UNION ALL
      SELECT NEW.producer2_id AS user_id
      WHERE v_type IN ('battle_admin_approved', 'battle_admin_rejected')
        AND NEW.producer2_id IS NOT NULL
    ) r
    JOIN public.user_profiles up ON up.id = r.user_id
    WHERE up.email IS NOT NULL
      AND length(trim(up.email)) > 0;
  EXCEPTION
    WHEN others THEN
      RAISE NOTICE 'battle user email notification failed for battle %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_battle_status_notify_users ON public.battles;
CREATE TRIGGER on_battle_status_notify_users
  AFTER UPDATE OF status ON public.battles
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status::text IN ('awaiting_admin', 'rejected', 'active', 'cancelled')
  )
  EXECUTE FUNCTION public.notify_battle_users_on_status_change();

COMMIT;
