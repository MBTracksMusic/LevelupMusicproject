/*
  # Require active producer status for product UPDATE

  Tightens UPDATE policy so inactive producers cannot modify products.
  INSERT quota policy is intentionally unchanged.
*/

BEGIN;

DROP POLICY IF EXISTS "Producers can update own unsold products" ON public.products;

CREATE POLICY "Producers can update own unsold products"
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    producer_id = auth.uid()
    AND is_sold = false
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
    )
  )
  WITH CHECK (
    producer_id = auth.uid()
    AND is_sold = false
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
    )
    AND (
      NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL)
      OR public.can_publish_beat(auth.uid(), id)
    )
  );

COMMIT;
