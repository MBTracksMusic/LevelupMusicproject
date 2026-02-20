/*
  # Soft delete products

  - Add `deleted_at` marker to products
  - Hide soft-deleted products from public and producer listings via SELECT RLS
  - Keep purchases/entitlements/download_logs untouched
*/

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_products_not_deleted
  ON public.products (deleted_at)
  WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS "Anyone can view published products" ON public.products;
CREATE POLICY "Anyone can view published products"
  ON public.products
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND is_published = true
    AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false))
  );

DROP POLICY IF EXISTS "Producers can view own products" ON public.products;
CREATE POLICY "Producers can view own products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND producer_id = auth.uid()
  );

COMMIT;
