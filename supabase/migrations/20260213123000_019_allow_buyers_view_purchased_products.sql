/*
  # Allow buyers to view products they purchased

  - Adds an RLS SELECT policy on `products` for authenticated users
    when they hold an active entitlement for that product.
  - Ensures purchased tracks remain visible in user account pages,
    including sold exclusives that are no longer publicly listed.
*/

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'Buyers can view purchased products'
  ) THEN
    CREATE POLICY "Buyers can view purchased products"
      ON public.products
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.entitlements e
          WHERE e.product_id = products.id
            AND e.user_id = auth.uid()
            AND e.is_active = true
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
      );
  END IF;
END
$$;

COMMIT;
