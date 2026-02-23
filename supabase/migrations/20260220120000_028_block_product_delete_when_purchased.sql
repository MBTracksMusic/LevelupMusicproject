/*
  # Block product deletion when purchases exist

  - Keeps existing delete constraints on products (owner + unsold)
  - Adds a guard to refuse delete if at least one purchase exists for the product
  - Does not change FKs or cascade behavior
*/

BEGIN;

DROP POLICY IF EXISTS "Producers can delete own unsold products" ON public.products;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'products'
    AND policyname = 'Producers can delete own unsold products'
  ) THEN
    CREATE POLICY "Producers can delete own unsold products"
  ON public.products
  FOR DELETE
  TO authenticated
  USING (
    producer_id = auth.uid()
    AND is_sold = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchases
      WHERE purchases.product_id = products.id
    )
  );
  END IF;
END $$;

COMMIT;
