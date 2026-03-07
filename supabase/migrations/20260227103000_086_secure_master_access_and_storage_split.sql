/*
  # Secure master access + storage split (P0)

  - Stops client-side reads of `products.master_path` / `products.master_url`.
  - Replaces table-level SELECT with explicit safe-column SELECT grants.
  - Adds `public.public_products` as a read-safe view.
  - Enforces bucket split:
      * beats-masters (private)
      * beats-watermarked (public)
  - Removes client read policies on beats-masters and keeps public read on beats-watermarked.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Products: remove master exposure at SQL grant level
-- ---------------------------------------------------------------------------

-- Explicitly remove direct master column visibility for client roles.
REVOKE SELECT(master_path) ON TABLE public.products FROM PUBLIC;
REVOKE SELECT(master_path) ON TABLE public.products FROM anon;
REVOKE SELECT(master_path) ON TABLE public.products FROM authenticated;

REVOKE SELECT(master_url) ON TABLE public.products FROM PUBLIC;
REVOKE SELECT(master_url) ON TABLE public.products FROM anon;
REVOKE SELECT(master_url) ON TABLE public.products FROM authenticated;

-- Remove broad table-level SELECT and restore only safe columns.
REVOKE SELECT ON TABLE public.products FROM PUBLIC;
REVOKE SELECT ON TABLE public.products FROM anon;
REVOKE SELECT ON TABLE public.products FROM authenticated;

DO $$
DECLARE
  safe_columns text;
BEGIN
  SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO safe_columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'products'
    AND c.column_name = ANY (ARRAY[
      'id',
      'producer_id',
      'title',
      'slug',
      'description',
      'product_type',
      'genre_id',
      'mood_id',
      'bpm',
      'key_signature',
      'price',
      'watermarked_path',
      'preview_url',
      'exclusive_preview_url',
      'cover_image_url',
      'is_exclusive',
      'is_sold',
      'sold_at',
      'sold_to_user_id',
      'is_published',
      'play_count',
      'tags',
      'duration_seconds',
      'file_format',
      'license_terms',
      'watermark_profile_id',
      'created_at',
      'updated_at',
      'deleted_at'
    ]);

  IF safe_columns IS NULL THEN
    RAISE EXCEPTION 'No safe columns found for public.products';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON TABLE public.products TO PUBLIC', safe_columns);
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.products TO anon', safe_columns);
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.products TO authenticated', safe_columns);
END
$$;

-- Optional safe projection for future public reads.
CREATE OR REPLACE VIEW public.public_products
WITH (security_invoker = true)
AS
SELECT
  id,
  producer_id,
  title,
  slug,
  description,
  product_type,
  genre_id,
  mood_id,
  bpm,
  key_signature,
  price,
  watermarked_path,
  preview_url,
  exclusive_preview_url,
  cover_image_url,
  is_exclusive,
  is_sold,
  sold_at,
  sold_to_user_id,
  is_published,
  play_count,
  tags,
  duration_seconds,
  file_format,
  license_terms,
  watermark_profile_id,
  created_at,
  updated_at,
  deleted_at
FROM public.products;

GRANT SELECT ON TABLE public.public_products TO PUBLIC;
GRANT SELECT ON TABLE public.public_products TO anon;
GRANT SELECT ON TABLE public.public_products TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Storage buckets: enforce masters/private and watermarked/public
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping bucket hardening.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'beats-masters') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'beats-masters',
      'Beat masters (private)',
      false,
      52428800,
      '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    );
  ELSE
    UPDATE storage.buckets
    SET
      public = false,
      file_size_limit = 52428800,
      allowed_mime_types = '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    WHERE id = 'beats-masters';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'beats-watermarked') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'beats-watermarked',
      'Beat previews (watermarked)',
      true,
      52428800,
      '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    );
  ELSE
    UPDATE storage.buckets
    SET
      public = true,
      file_size_limit = 52428800,
      allowed_mime_types = '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    WHERE id = 'beats-watermarked';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Storage policies: no client read on masters, public read on watermarked
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  objects_exists boolean;
  policy_row record;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping policy hardening.';
    RETURN;
  END IF;

  -- Drop all existing policies that target beats-masters or beats-watermarked,
  -- then recreate the expected minimal set.
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') ILIKE '%beats-masters%'
        OR coalesce(with_check, '') ILIKE '%beats-masters%'
        OR coalesce(qual, '') ILIKE '%beats-watermarked%'
        OR coalesce(with_check, '') ILIKE '%beats-watermarked%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_row.policyname);
  END LOOP;

  DROP POLICY IF EXISTS "Producers can upload masters" ON storage.objects;
  CREATE POLICY "Producers can upload masters"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'beats-masters'
      AND auth.uid() = owner
      AND public.is_active_producer(auth.uid())
      AND name LIKE auth.uid()::text || '/%'
    );

  DROP POLICY IF EXISTS "Producers can update own masters" ON storage.objects;
  CREATE POLICY "Producers can update own masters"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'beats-masters'
      AND auth.uid() = owner
      AND public.is_active_producer(auth.uid())
      AND name LIKE auth.uid()::text || '/%'
    )
    WITH CHECK (
      bucket_id = 'beats-masters'
      AND auth.uid() = owner
      AND public.is_active_producer(auth.uid())
      AND name LIKE auth.uid()::text || '/%'
    );

  DROP POLICY IF EXISTS "Producers can delete own masters" ON storage.objects;
  CREATE POLICY "Producers can delete own masters"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'beats-masters'
      AND auth.uid() = owner
      AND public.is_active_producer(auth.uid())
      AND name LIKE auth.uid()::text || '/%'
    );

  DROP POLICY IF EXISTS "Public can read watermarked audio" ON storage.objects;
  CREATE POLICY "Public can read watermarked audio"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'beats-watermarked');
END
$$;

COMMIT;
