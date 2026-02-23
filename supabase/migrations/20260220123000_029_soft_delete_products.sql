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
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'products'
    AND policyname = 'Anyone can view published products'
  ) THEN
    CREATE POLICY "Anyone can view published products"
  ON public.products
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND is_published = true
    AND (is_exclusive = false OR (is_exclusive = true AND is_sold = false))
  );
  END IF;
END $$;

DROP POLICY IF EXISTS "Producers can view own products" ON public.products;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'products'
    AND policyname = 'Producers can view own products'
  ) THEN
    CREATE POLICY "Producers can view own products"
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND producer_id = auth.uid()
  );
  END IF;
END $$;

COMMIT;
