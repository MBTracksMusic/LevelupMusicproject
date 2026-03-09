/*
  # Backfill missing battle products for already launched admin campaigns

  Problem:
  - Some admin battles were launched before product assignment logic was added.
  - Those battles have NULL product1_id/product2_id, so battle page shows no title/audio.

  Fix:
  - For each launched campaign battle with missing products:
    1) try proposed_product_id from admin_battle_applications for each selected producer
    2) fallback to latest active + published beat for that producer
    3) update battles.product1_id/product2_id when found

  Notes:
  - Existing trigger trg_capture_battle_product_snapshots will capture snapshots on UPDATE.
*/

BEGIN;

DO $$
DECLARE
  v_row record;
  v_product1_id uuid;
  v_product2_id uuid;
BEGIN
  FOR v_row IN
    SELECT
      b.id AS battle_id,
      c.id AS campaign_id,
      c.selected_producer1_id AS producer1_id,
      c.selected_producer2_id AS producer2_id
    FROM public.admin_battle_campaigns c
    JOIN public.battles b ON b.id = c.battle_id
    WHERE b.battle_type = 'admin'
      AND (b.product1_id IS NULL OR b.product2_id IS NULL)
      AND c.selected_producer1_id IS NOT NULL
      AND c.selected_producer2_id IS NOT NULL
  LOOP
    v_product1_id := NULL;
    v_product2_id := NULL;

    -- Producer 1: prefer proposed beat from campaign application.
    SELECT a.proposed_product_id
    INTO v_product1_id
    FROM public.admin_battle_applications a
    WHERE a.campaign_id = v_row.campaign_id
      AND a.producer_id = v_row.producer1_id
      AND a.proposed_product_id IS NOT NULL
    ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC
    LIMIT 1;

    -- Fallback producer 1: latest active published beat.
    IF v_product1_id IS NULL THEN
      SELECT p.id
      INTO v_product1_id
      FROM public.products p
      WHERE p.producer_id = v_row.producer1_id
        AND p.product_type = 'beat'
        AND p.status = 'active'
        AND p.deleted_at IS NULL
        AND p.is_published = true
      ORDER BY p.created_at DESC
      LIMIT 1;
    END IF;

    -- Producer 2: prefer proposed beat from campaign application.
    SELECT a.proposed_product_id
    INTO v_product2_id
    FROM public.admin_battle_applications a
    WHERE a.campaign_id = v_row.campaign_id
      AND a.producer_id = v_row.producer2_id
      AND a.proposed_product_id IS NOT NULL
    ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC
    LIMIT 1;

    -- Fallback producer 2: latest active published beat.
    IF v_product2_id IS NULL THEN
      SELECT p.id
      INTO v_product2_id
      FROM public.products p
      WHERE p.producer_id = v_row.producer2_id
        AND p.product_type = 'beat'
        AND p.status = 'active'
        AND p.deleted_at IS NULL
        AND p.is_published = true
      ORDER BY p.created_at DESC
      LIMIT 1;
    END IF;

    UPDATE public.battles b
    SET product1_id = COALESCE(b.product1_id, v_product1_id),
        product2_id = COALESCE(b.product2_id, v_product2_id),
        updated_at = now()
    WHERE b.id = v_row.battle_id
      AND (
        (b.product1_id IS NULL AND v_product1_id IS NOT NULL)
        OR (b.product2_id IS NULL AND v_product2_id IS NOT NULL)
      );
  END LOOP;
END
$$;

COMMIT;
