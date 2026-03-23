/*
  Fix missing UPDATE RLS policy on cart_items table

  Issue: UPSERT operations fail with "new row violates row-level security policy"

  Root cause:
  - INSERT policy exists: "Users can add to cart" ✓
  - UPDATE policy missing: ❌
  - When INSERT ... ON CONFLICT ... DO UPDATE is executed:
    1. INSERT part works (WITH CHECK passes)
    2. UPDATE part fails (no UPDATE policy defined)

  Solution:
  - Add UPDATE policy to allow users to update their own cart items
  - Required for UPSERT operations to succeed
*/

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cart_items'
      AND policyname = 'Users can update their cart'
  ) THEN
    CREATE POLICY "Users can update their cart"
      ON public.cart_items FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

COMMIT;
