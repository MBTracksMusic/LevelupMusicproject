/*
  # Rollback to pre-023/024 audio model (legacy master_url + beats-audio playback)

  This migration restores the legacy behavior used before migrations 023/024:
  - beats-audio as public playback bucket
  - authenticated read policy on beats-audio
  - producers can read their own audio in beats-audio
  - products.master_url restored and backfilled
  - column-level access to products.master_path restored (to avoid SELECT * failures)
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Buckets: restore legacy beats-audio behavior
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping bucket rollback.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'beats-audio') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'beats-audio',
      'Producer audio (public previews)',
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
    WHERE id = 'beats-audio';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) storage.objects policies: restore legacy read access
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  objects_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping policy rollback.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can read beats audio'
  ) THEN
    CREATE POLICY "Authenticated users can read beats audio"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'beats-audio');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can read their audio'
  ) THEN
    CREATE POLICY "Producers can read their audio"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'beats-audio'
        AND auth.uid() = owner
        AND public.is_active_producer(auth.uid())
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Products: restore legacy master_url and compatibility with SELECT *
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS master_url text;

UPDATE public.products
SET master_url = COALESCE(master_url, master_path, watermarked_path, preview_url, exclusive_preview_url)
WHERE master_url IS NULL;

UPDATE public.products
SET preview_url = COALESCE(preview_url, watermarked_path, master_url)
WHERE preview_url IS NULL;

-- If master_path exists and was revoked in 023/024, restore visibility for client roles
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'master_path'
  ) THEN
    GRANT SELECT(master_path) ON TABLE public.products TO PUBLIC;
    GRANT SELECT(master_path) ON TABLE public.products TO anon;
    GRANT SELECT(master_path) ON TABLE public.products TO authenticated;
  END IF;
END
$$;

GRANT SELECT(master_url) ON TABLE public.products TO PUBLIC;
GRANT SELECT(master_url) ON TABLE public.products TO anon;
GRANT SELECT(master_url) ON TABLE public.products TO authenticated;

COMMIT;
