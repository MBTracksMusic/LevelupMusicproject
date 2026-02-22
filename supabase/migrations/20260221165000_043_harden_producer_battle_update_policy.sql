/*
  # Harden producer battle updates (status lock)

  Objective:
  - Prevent producer-side direct status transitions after creation.
  - Keep backward-compatible handling for legacy `pending` rows only.
  - Admin update policy remains unchanged.
*/

BEGIN;

DROP POLICY IF EXISTS "Producers can update own pending battles" ON public.battles;

CREATE POLICY "Producers can update own pending battles"
  ON public.battles
  FOR UPDATE
  TO authenticated
  USING (
    (producer1_id = auth.uid() OR producer2_id = auth.uid())
    AND status = 'pending'
  )
  WITH CHECK (
    (producer1_id = auth.uid() OR producer2_id = auth.uid())
    AND status = 'pending'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
  );

COMMIT;
