/*
  # Fix enum cast in admin_set_campaign_selection

  Problem:
  - admin_battle_applications.status is enum admin_battle_application_status
  - CASE expression in admin_set_campaign_selection was inferred as text
  - runtime error: "column status is of type admin_battle_application_status but expression is of type text"

  Fix:
  - Explicitly cast CASE branches to public.admin_battle_application_status
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_campaign_selection(
  p_campaign_id uuid,
  p_producer1_id uuid,
  p_producer2_id uuid
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
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_producer1_id IS NULL OR p_producer2_id IS NULL THEN
    RAISE EXCEPTION 'selected_producers_required';
  END IF;

  IF p_producer1_id = p_producer2_id THEN
    RAISE EXCEPTION 'selected_producers_must_be_distinct';
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
    RETURN QUERY SELECT true, 'already_launched'::text, 'Campaign already launched.'::text;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.admin_battle_applications a
  WHERE a.campaign_id = p_campaign_id
    AND a.producer_id = p_producer1_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'producer1_not_applied';
  END IF;

  PERFORM 1
  FROM public.admin_battle_applications a
  WHERE a.campaign_id = p_campaign_id
    AND a.producer_id = p_producer2_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'producer2_not_applied';
  END IF;

  UPDATE public.admin_battle_campaigns
  SET selected_producer1_id = p_producer1_id,
      selected_producer2_id = p_producer2_id,
      status = 'selection_locked',
      updated_at = now()
  WHERE id = p_campaign_id;

  UPDATE public.admin_battle_applications
  SET status = CASE
      WHEN producer_id IN (p_producer1_id, p_producer2_id)
        THEN 'selected'::public.admin_battle_application_status
      ELSE 'rejected'::public.admin_battle_application_status
    END,
    updated_at = now()
  WHERE campaign_id = p_campaign_id;

  RETURN QUERY SELECT true, 'selection_locked'::text, 'Campaign selection saved.'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_campaign_selection(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_campaign_selection(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_campaign_selection(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_campaign_selection(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_campaign_selection(uuid, uuid, uuid) TO service_role;

COMMIT;
