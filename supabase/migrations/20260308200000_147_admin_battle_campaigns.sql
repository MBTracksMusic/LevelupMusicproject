/*
  # Admin battle campaigns (official battles)

  Goals:
  - Keep `public.battles` as the core battle engine.
  - Introduce campaign-based official battles managed by admins.
  - Allow active producers to apply, then admins pick two producers.
  - Launch a normal battle row with `battle_type = 'admin'`.
  - Add public share metadata + image bucket support.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Extend battles with battle_type (default user)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.battle_type AS ENUM ('user', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS battle_type public.battle_type NOT NULL DEFAULT 'user';

UPDATE public.battles
SET battle_type = 'user'
WHERE battle_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_battles_battle_type
  ON public.battles (battle_type);

CREATE INDEX IF NOT EXISTS idx_battles_battle_type_status_created
  ON public.battles (battle_type, status, created_at DESC);

-- Keep existing producer battle creation flow strict: producers can only create user battles.
DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;
CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND producer1_id = auth.uid()
    AND producer2_id IS NOT NULL
    AND producer1_id != producer2_id
    AND status = 'pending_acceptance'
    AND battle_type = 'user'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
    AND public.can_create_battle(auth.uid()) = true
    AND public.can_create_active_battle(auth.uid()) = true
    AND public.assert_battle_skill_gap(auth.uid(), producer2_id, 400) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up2
      WHERE up2.id = producer2_id
        AND up2.id <> auth.uid()
        AND up2.role IN ('producer', 'admin')
        AND up2.is_producer_active = true
        AND COALESCE(up2.is_deleted, false) = false
        AND up2.deleted_at IS NULL
    )
    AND (
      product1_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p1
        WHERE p1.id = product1_id
          AND p1.producer_id = auth.uid()
          AND p1.deleted_at IS NULL
      )
    )
    AND (
      product2_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p2
        WHERE p2.id = product2_id
          AND p2.producer_id = producer2_id
          AND p2.deleted_at IS NULL
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Campaign tables
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.admin_battle_campaign_status AS ENUM (
    'applications_open',
    'selection_locked',
    'launched',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.admin_battle_application_status AS ENUM (
    'pending',
    'selected',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.admin_battle_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  social_description text,
  cover_image_url text,
  share_slug text,
  status public.admin_battle_campaign_status NOT NULL DEFAULT 'applications_open',
  participation_deadline timestamptz NOT NULL,
  submission_deadline timestamptz NOT NULL,
  selected_producer1_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  selected_producer2_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  battle_id uuid REFERENCES public.battles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_battle_campaigns_deadline_order CHECK (submission_deadline >= participation_deadline),
  CONSTRAINT admin_battle_campaigns_distinct_selected CHECK (
    selected_producer1_id IS NULL
    OR selected_producer2_id IS NULL
    OR selected_producer1_id <> selected_producer2_id
  )
);

-- Step 1 requested explicit additive columns for sharing/promotion.
ALTER TABLE public.admin_battle_campaigns
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS share_slug text,
  ADD COLUMN IF NOT EXISTS social_description text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_battle_campaigns_share_slug_unique
  ON public.admin_battle_campaigns (share_slug)
  WHERE share_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_battle_campaigns_status_created
  ON public.admin_battle_campaigns (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_battle_campaigns_participation_deadline
  ON public.admin_battle_campaigns (participation_deadline);

CREATE TABLE IF NOT EXISTS public.admin_battle_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.admin_battle_campaigns(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  message text,
  proposed_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  status public.admin_battle_application_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_battle_applications_campaign_producer_unique UNIQUE (campaign_id, producer_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_battle_applications_campaign_created
  ON public.admin_battle_applications (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_battle_applications_producer
  ON public.admin_battle_applications (producer_id);

CREATE INDEX IF NOT EXISTS idx_admin_battle_applications_status
  ON public.admin_battle_applications (status);

DROP TRIGGER IF EXISTS update_admin_battle_campaigns_updated_at ON public.admin_battle_campaigns;
CREATE TRIGGER update_admin_battle_campaigns_updated_at
  BEFORE UPDATE ON public.admin_battle_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_admin_battle_applications_updated_at ON public.admin_battle_applications;
CREATE TRIGGER update_admin_battle_applications_updated_at
  BEFORE UPDATE ON public.admin_battle_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.admin_battle_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_battle_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read admin battle campaigns" ON public.admin_battle_campaigns;
CREATE POLICY "Anyone can read admin battle campaigns"
  ON public.admin_battle_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage admin battle campaigns" ON public.admin_battle_campaigns;
CREATE POLICY "Admins can manage admin battle campaigns"
  ON public.admin_battle_campaigns
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Producers can read own admin battle applications" ON public.admin_battle_applications;
CREATE POLICY "Producers can read own admin battle applications"
  ON public.admin_battle_applications
  FOR SELECT
  TO authenticated
  USING (producer_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage admin battle applications" ON public.admin_battle_applications;
CREATE POLICY "Admins can manage admin battle applications"
  ON public.admin_battle_applications
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Campaign RPCs
-- ---------------------------------------------------------------------------
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
    status
  )
  VALUES (
    p_campaign_id,
    v_actor,
    NULLIF(btrim(COALESCE(p_message, '')), ''),
    p_proposed_product_id,
    'pending'
  )
  ON CONFLICT (campaign_id, producer_id)
  DO UPDATE SET
    message = EXCLUDED.message,
    proposed_product_id = EXCLUDED.proposed_product_id,
    status = 'pending',
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
      WHEN producer_id IN (p_producer1_id, p_producer2_id) THEN 'selected'
      ELSE 'rejected'
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

  PERFORM 1
  FROM public.user_profiles up
  WHERE up.id IN (v_campaign.selected_producer1_id, v_campaign.selected_producer2_id)
    AND up.role IN ('producer', 'admin')
    AND up.is_producer_active = true
    AND COALESCE(up.is_deleted, false) = false
    AND up.deleted_at IS NULL
  GROUP BY up.id;

  IF (SELECT count(*) FROM public.user_profiles up
      WHERE up.id IN (v_campaign.selected_producer1_id, v_campaign.selected_producer2_id)
        AND up.role IN ('producer', 'admin')
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL) < 2 THEN
    RAISE EXCEPTION 'selected_producers_not_active';
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
    'awaiting_admin',
    v_campaign.submission_deadline,
    now(),
    NULL,
    0,
    0,
    'admin'
  )
  RETURNING id INTO v_battle_id;

  UPDATE public.admin_battle_campaigns
  SET battle_id = v_battle_id,
      status = 'launched',
      launched_at = now(),
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN QUERY
  SELECT true, 'launched'::text, 'Battle launched from campaign.'::text, v_battle_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_launch_battle_campaign(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Storage bucket for campaign images (public)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping battle-campaign-images bucket creation.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'battle-campaign-images') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'battle-campaign-images',
      'Official battle campaign cover images',
      true,
      10485760,
      '{image/jpeg,image/png,image/webp}'
    );
  ELSE
    UPDATE storage.buckets
    SET public = true,
        file_size_limit = 10485760,
        allowed_mime_types = '{image/jpeg,image/png,image/webp}'
    WHERE id = 'battle-campaign-images';
  END IF;
END
$$;

DO $$
DECLARE
  objects_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage'
      AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects not found; skipping battle-campaign-images storage policies.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Anyone can view battle campaign images" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can upload battle campaign images" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can update battle campaign images" ON storage.objects;
  DROP POLICY IF EXISTS "Admins can delete battle campaign images" ON storage.objects;

  CREATE POLICY "Anyone can view battle campaign images"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'battle-campaign-images');

  CREATE POLICY "Admins can upload battle campaign images"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'battle-campaign-images'
      AND name LIKE 'campaigns/%'
      AND public.is_admin(auth.uid())
    );

  CREATE POLICY "Admins can update battle campaign images"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'battle-campaign-images'
      AND name LIKE 'campaigns/%'
      AND public.is_admin(auth.uid())
    )
    WITH CHECK (
      bucket_id = 'battle-campaign-images'
      AND name LIKE 'campaigns/%'
      AND public.is_admin(auth.uid())
    );

  CREATE POLICY "Admins can delete battle campaign images"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'battle-campaign-images'
      AND name LIKE 'campaigns/%'
      AND public.is_admin(auth.uid())
    );
END
$$;

COMMIT;
