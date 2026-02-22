/*
  # Enforce pending_acceptance on battle creation (producer flow)

  Producer1 can create only with:
  - status = pending_acceptance
  - zero votes
  - winner null
  - producer2 distinct
*/

BEGIN;

DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;

CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    producer1_id = auth.uid()
    AND producer2_id IS NOT NULL
    AND producer1_id != producer2_id
    AND status = 'pending_acceptance'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up2
      WHERE up2.id = producer2_id
        AND up2.is_producer_active = true
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

COMMIT;
