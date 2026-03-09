/*
  # Admin campaign launch: attach beats and auto-activate battle

  Goals:
  - Launch from campaign creates a battle with product1_id/product2_id filled
  - Avoid empty audio state in battle detail
  - Admin launch should not require a second manual validation step

  Strategy:
  - Resolve products from selected producers' campaign applications (proposed_product_id)
  - Fallback to latest active published beat for each producer
  - Validate ownership/eligibility of selected products
  - Insert battle in awaiting_admin state, then call admin_validate_battle() in same transaction
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_launch_battle_campaign(
  p_campaign_id uuid
)
RETURNS TABLE (
  success boolean,
  status text,
  message text,
  battle_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_campaign public.admin_battle_campaigns%ROWTYPE;
  v_slug_base text;
  v_slug text;
  v_counter integer := 0;
  v_battle_id uuid;
  v_product1_id uuid;
  v_product2_id uuid;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.admin_battle_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_campaign.status = 'launched' AND v_campaign.battle_id IS NOT NULL THEN
    RETURN QUERY
    SELECT true, 'already_launched'::text, 'Campaign already launched.'::text, v_campaign.battle_id;
    RETURN;
  END IF;

  IF v_campaign.selected_producer1_id IS NULL OR v_campaign.selected_producer2_id IS NULL THEN
    RAISE EXCEPTION 'campaign_selection_missing';
  END IF;

  IF v_campaign.selected_producer1_id = v_campaign.selected_producer2_id THEN
    RAISE EXCEPTION 'campaign_selection_invalid';
  END IF;

  IF v_campaign.status <> 'selection_locked' THEN
    RAISE EXCEPTION 'campaign_selection_not_locked';
  END IF;

  IF (
    SELECT count(*)
    FROM public.user_profiles up
    WHERE up.id IN (v_campaign.selected_producer1_id, v_campaign.selected_producer2_id)
      AND up.role IN ('producer', 'admin')
      AND up.is_producer_active = true
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  ) < 2 THEN
    RAISE EXCEPTION 'selected_producers_not_active';
  END IF;

  -- Resolve product for producer 1 from application, fallback to latest active published beat.
  SELECT a.proposed_product_id
  INTO v_product1_id
  FROM public.admin_battle_applications a
  WHERE a.campaign_id = p_campaign_id
    AND a.producer_id = v_campaign.selected_producer1_id
  LIMIT 1;

  IF v_product1_id IS NULL THEN
    SELECT p.id
    INTO v_product1_id
    FROM public.products p
    WHERE p.producer_id = v_campaign.selected_producer1_id
      AND p.product_type = 'beat'
      AND p.status = 'active'
      AND p.deleted_at IS NULL
      AND p.is_published = true
    ORDER BY p.created_at DESC
    LIMIT 1;
  END IF;

  -- Resolve product for producer 2 from application, fallback to latest active published beat.
  SELECT a.proposed_product_id
  INTO v_product2_id
  FROM public.admin_battle_applications a
  WHERE a.campaign_id = p_campaign_id
    AND a.producer_id = v_campaign.selected_producer2_id
  LIMIT 1;

  IF v_product2_id IS NULL THEN
    SELECT p.id
    INTO v_product2_id
    FROM public.products p
    WHERE p.producer_id = v_campaign.selected_producer2_id
      AND p.product_type = 'beat'
      AND p.status = 'active'
      AND p.deleted_at IS NULL
      AND p.is_published = true
    ORDER BY p.created_at DESC
    LIMIT 1;
  END IF;

  IF v_product1_id IS NULL THEN
    RAISE EXCEPTION 'producer1_product_required';
  END IF;

  IF v_product2_id IS NULL THEN
    RAISE EXCEPTION 'producer2_product_required';
  END IF;

  PERFORM 1
  FROM public.products p
  WHERE p.id = v_product1_id
    AND p.producer_id = v_campaign.selected_producer1_id
    AND p.product_type = 'beat'
    AND p.status = 'active'
    AND p.deleted_at IS NULL
    AND p.is_published = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'producer1_product_invalid';
  END IF;

  PERFORM 1
  FROM public.products p
  WHERE p.id = v_product2_id
    AND p.producer_id = v_campaign.selected_producer2_id
    AND p.product_type = 'beat'
    AND p.status = 'active'
    AND p.deleted_at IS NULL
    AND p.is_published = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'producer2_product_invalid';
  END IF;

  v_slug_base := lower(regexp_replace(COALESCE(v_campaign.share_slug, v_campaign.title, 'official-battle'), '[^a-z0-9]+', '-', 'g'));
  v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');

  IF v_slug_base IS NULL OR v_slug_base = '' THEN
    v_slug_base := 'official-battle';
  END IF;

  v_slug := v_slug_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.battles b WHERE b.slug = v_slug);
    v_counter := v_counter + 1;
    v_slug := v_slug_base || '-' || v_counter::text;
    IF v_counter > 1000 THEN
      RAISE EXCEPTION 'unable_to_generate_battle_slug';
    END IF;
  END LOOP;

  INSERT INTO public.battles (
    title,
    slug,
    description,
    producer1_id,
    producer2_id,
    product1_id,
    product2_id,
    status,
    submission_deadline,
    accepted_at,
    winner_id,
    votes_producer1,
    votes_producer2,
    battle_type
  )
  VALUES (
    COALESCE(NULLIF(btrim(v_campaign.title), ''), 'Official Battle'),
    v_slug,
    NULLIF(btrim(COALESCE(v_campaign.description, v_campaign.social_description, '')), ''),
    v_campaign.selected_producer1_id,
    v_campaign.selected_producer2_id,
    v_product1_id,
    v_product2_id,
    'awaiting_admin',
    v_campaign.submission_deadline,
    now(),
    NULL,
    0,
    0,
    'admin'
  )
  RETURNING id INTO v_battle_id;

  -- Auto-activate immediately on launch (same admin actor).
  PERFORM public.admin_validate_battle(v_battle_id);

  UPDATE public.admin_battle_campaigns
  SET battle_id = v_battle_id,
      status = 'launched',
      launched_at = now(),
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN QUERY
  SELECT true, 'launched'::text, 'Battle launched and activated from campaign.'::text, v_battle_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) TO service_role;

COMMIT;
