/*
  # Admin campaign: request producer to submit another beat

  Goal:
  - Let admins request a replacement beat directly from campaign UI.
  - Re-open campaign applications safely so producer can update submission.
*/

BEGIN;

ALTER TABLE public.admin_battle_applications
ADD COLUMN IF NOT EXISTS admin_feedback text,
ADD COLUMN IF NOT EXISTS admin_feedback_at timestamptz;

COMMENT ON COLUMN public.admin_battle_applications.admin_feedback IS
  'Optional admin request shown to producer when a new beat submission is required.';

COMMENT ON COLUMN public.admin_battle_applications.admin_feedback_at IS
  'Timestamp of the latest admin replacement request.';

CREATE OR REPLACE FUNCTION public.admin_request_campaign_application_update(
  p_campaign_id uuid,
  p_producer_id uuid,
  p_feedback text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  status text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_campaign public.admin_battle_campaigns%ROWTYPE;
  v_feedback text;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_campaign_id IS NULL OR p_producer_id IS NULL THEN
    RAISE EXCEPTION 'campaign_and_producer_required';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.admin_battle_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_campaign.status = 'launched' THEN
    RAISE EXCEPTION 'campaign_already_launched';
  END IF;

  v_feedback := NULLIF(btrim(COALESCE(p_feedback, '')), '');
  IF v_feedback IS NULL THEN
    v_feedback := 'Admin requested a new beat. Please submit another active published beat.';
  END IF;

  UPDATE public.admin_battle_applications a
  SET status = 'pending'::public.admin_battle_application_status,
      proposed_product_id = NULL,
      admin_feedback = v_feedback,
      admin_feedback_at = now(),
      updated_at = now()
  WHERE a.campaign_id = p_campaign_id
    AND a.producer_id = p_producer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  UPDATE public.admin_battle_campaigns c
  SET status = 'applications_open'::public.admin_battle_campaign_status,
      selected_producer1_id = CASE
        WHEN c.selected_producer1_id = p_producer_id THEN NULL
        ELSE c.selected_producer1_id
      END,
      selected_producer2_id = CASE
        WHEN c.selected_producer2_id = p_producer_id THEN NULL
        ELSE c.selected_producer2_id
      END,
      updated_at = now()
  WHERE c.id = p_campaign_id
    AND c.status <> 'launched';

  RETURN QUERY
  SELECT true, 'resubmission_requested'::text, 'Producer can now submit another beat.'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_request_campaign_application_update(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_request_campaign_application_update(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_request_campaign_application_update(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_campaign_application_update(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_campaign_application_update(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_to_admin_battle_campaign(
  p_campaign_id uuid,
  p_message text DEFAULT NULL,
  p_proposed_product_id uuid DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  status text,
  message text,
  application_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_campaign public.admin_battle_campaigns%ROWTYPE;
  v_application_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT public.is_current_user_active(v_actor) THEN
    RAISE EXCEPTION 'account_deleted_or_inactive';
  END IF;

  PERFORM 1
  FROM public.user_profiles up
  WHERE up.id = v_actor
    AND up.role IN ('producer', 'admin')
    AND up.is_producer_active = true
    AND COALESCE(up.is_deleted, false) = false
    AND up.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'producer_active_required';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.admin_battle_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_campaign.status <> 'applications_open' THEN
    RAISE EXCEPTION 'campaign_not_open';
  END IF;

  IF v_campaign.participation_deadline < now() THEN
    RAISE EXCEPTION 'campaign_participation_closed';
  END IF;

  IF p_proposed_product_id IS NOT NULL THEN
    PERFORM 1
    FROM public.products p
    WHERE p.id = p_proposed_product_id
      AND p.producer_id = v_actor
      AND p.product_type = 'beat'
      AND p.status = 'active'
      AND p.is_published = true
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_proposed_product';
    END IF;
  END IF;

  INSERT INTO public.admin_battle_applications (
    campaign_id,
    producer_id,
    message,
    proposed_product_id,
    admin_feedback,
    admin_feedback_at,
    status
  )
  VALUES (
    p_campaign_id,
    v_actor,
    NULLIF(btrim(COALESCE(p_message, '')), ''),
    p_proposed_product_id,
    NULL,
    NULL,
    'pending'
  )
  ON CONFLICT (campaign_id, producer_id)
  DO UPDATE SET
    message = EXCLUDED.message,
    proposed_product_id = EXCLUDED.proposed_product_id,
    admin_feedback = NULL,
    admin_feedback_at = NULL,
    status = 'pending'::public.admin_battle_application_status,
    updated_at = now()
  RETURNING id INTO v_application_id;

  RETURN QUERY
  SELECT true, 'applied'::text, 'Application submitted.'::text, v_application_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_to_admin_battle_campaign(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_to_admin_battle_campaign(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_to_admin_battle_campaign(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_admin_battle_campaign(uuid, text, uuid) TO service_role;

COMMIT;
