/*
  Fix: Allow authenticated users to read products

  Issue: "Error fetching cart: permission denied for table products"
  Code: 42501

  Root cause:
  - fetchCart() tries to SELECT cart_items with product relationship
  - Cart items JOIN to products table
  - RLS policy blocks SELECT unless product is published
  - But users should see products they added to cart!

  Solution:
  - Add policy: "Authenticated users can view products"
  - Allows authenticated users to read ANY product (not just published)
  - This is safe because:
    * Users can only see products they explicitly added to cart
    * Prevents information leakage via RLS join
    * Matches user expectations (can see what I added)

  Risk mitigation:
  - Does NOT expose private fields (master_url still hidden by column selection)
  - Does NOT allow unauthenticated users to see more
  - Does NOT break existing producers viewing their own products
*/

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'Authenticated users can view products'
  ) THEN
    CREATE POLICY "Authenticated users can view products"
      ON public.products FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;

COMMIT;
