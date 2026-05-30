/*
  # Battle genre selection and public filtering

  - Adds an optional genre_id to battles so newly created battles can be
    filtered without deriving metadata from product rows at read time.
  - Keeps the column nullable so existing battles remain valid.
  - Backfills existing battles from product1.genre_id, then product2.genre_id.
  - Extends rpc_create_battle with p_genre_id while keeping defaults compatible
    with callers that do not pass it yet.
*/

BEGIN;

ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS genre_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'battles_genre_id_fkey'
      AND conrelid = 'public.battles'::regclass
  ) THEN
    ALTER TABLE public.battles
      ADD CONSTRAINT battles_genre_id_fkey
      FOREIGN KEY (genre_id)
      REFERENCES public.genres(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_battles_status_genre_created
  ON public.battles (status, genre_id, created_at DESC)
  WHERE genre_id IS NOT NULL;

WITH inferred AS (
  SELECT
    b.id,
    COALESCE(p1.genre_id, p2.genre_id) AS genre_id
  FROM public.battles b
  LEFT JOIN public.products p1 ON p1.id = b.product1_id
  LEFT JOIN public.products p2 ON p2.id = b.product2_id
  WHERE b.genre_id IS NULL
)
UPDATE public.battles b
SET genre_id = inferred.genre_id
FROM inferred
WHERE b.id = inferred.id
  AND inferred.genre_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_battle_genre_eligible(p_genre_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_genre_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.genres g
      WHERE g.id = p_genre_id
        AND COALESCE(g.is_active, false) = true
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_battle_genre_eligible(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_battle_genre_eligible(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_battle_genre_eligible(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_battle_genre_eligible(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text);

CREATE FUNCTION public.rpc_create_battle(
  p_title         text,
  p_slug          text,
  p_producer2_id  uuid,
  p_description   text DEFAULT NULL,
  p_product1_id   uuid DEFAULT NULL,
  p_product2_id   uuid DEFAULT NULL,
  p_battle_type   text DEFAULT 'user',
  p_genre_id      uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_title          text := NULLIF(trim(COALESCE(p_title, '')), '');
  v_slug           text := NULLIF(trim(COALESCE(p_slug, '')), '');
  v_description    text := NULLIF(trim(COALESCE(p_description, '')), '');
  v_cooldown_days  integer;
  v_cooldown_end   timestamptz;
  v_new_battle_id  uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_battle_type IS NULL OR p_battle_type NOT IN ('user') THEN
    RAISE EXCEPTION 'unsupported_battle_type' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_battle_genre_eligible(p_genre_id) THEN
    RAISE EXCEPTION 'BATTLE_GENRE_INVALID'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('genre_id', p_genre_id)::text;
  END IF;

  PERFORM public.assert_battle_create_validations(
    v_actor,
    p_producer2_id,
    p_product1_id,
    p_product2_id,
    false,
    400
  );

  PERFORM public.assert_battle_product_monthly_caps(
    p_product1_id,
    p_product2_id,
    NULL
  );

  v_cooldown_days := public.get_battle_pair_cooldown_days(p_battle_type);

  IF NOT public.can_create_battle(v_actor) THEN
    RAISE EXCEPTION 'BATTLE_QUOTA_REACHED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_create_active_battle(v_actor) THEN
    RAISE EXCEPTION 'BATTLE_ACTIVE_CAP_REACHED' USING ERRCODE = 'P0001';
  END IF;

  IF public.check_battle_pair_active(v_actor, p_producer2_id) THEN
    RAISE EXCEPTION 'BATTLE_PAIR_ALREADY_ACTIVE' USING ERRCODE = 'P0002';
  END IF;

  v_cooldown_end := public.get_battle_pair_cooldown_end(
    v_actor,
    p_producer2_id
  );

  IF v_cooldown_end IS NOT NULL THEN
    RAISE EXCEPTION 'BATTLE_PAIR_COOLDOWN'
      USING ERRCODE = 'P0003',
            DETAIL = jsonb_build_object(
              'cooldown_end_at', to_char(v_cooldown_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              'cooldown_days',   v_cooldown_days,
              'opponent_id',     p_producer2_id
            )::text;
  END IF;

  INSERT INTO public.battles (
    title,
    slug,
    description,
    producer1_id,
    producer2_id,
    product1_id,
    product2_id,
    genre_id,
    status,
    winner_id,
    votes_producer1,
    votes_producer2
  )
  VALUES (
    v_title,
    v_slug,
    v_description,
    v_actor,
    p_producer2_id,
    p_product1_id,
    p_product2_id,
    p_genre_id,
    'pending_acceptance',
    NULL,
    0,
    0
  )
  RETURNING id INTO v_new_battle_id;

  RETURN v_new_battle_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, uuid) TO service_role;

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
  v_genre_id uuid;
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

  IF v_campaign.submission_deadline <= now() THEN
    RAISE EXCEPTION 'submission_deadline_in_past';
  END IF;

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

  SELECT COALESCE(p1.genre_id, p2.genre_id)
  INTO v_genre_id
  FROM (SELECT 1) seed
  LEFT JOIN public.products p1 ON p1.id = v_product1_id
  LEFT JOIN public.products p2 ON p2.id = v_product2_id;

  PERFORM public.assert_battle_create_validations(
    v_campaign.selected_producer1_id,
    v_campaign.selected_producer2_id,
    v_product1_id,
    v_product2_id,
    true,
    400
  );

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
    genre_id,
    status,
    submission_deadline,
    voting_ends_at,
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
    v_genre_id,
    'awaiting_admin',
    v_campaign.submission_deadline,
    v_campaign.submission_deadline,
    now(),
    NULL,
    0,
    0,
    'admin'
  )
  RETURNING id INTO v_battle_id;

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
