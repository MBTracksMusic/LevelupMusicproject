/*
  # Allow authenticated playback from private beats-audio bucket

  - Keeps `beats-audio` private at bucket level.
  - Grants authenticated users SELECT on storage objects in that bucket.
  - This is required for client-side `createSignedUrl(...)` to work for non-owner listeners.
*/

BEGIN;

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
    RAISE NOTICE 'storage.objects table not found; skipping audio read policy.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can read beats audio'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can read beats audio"
        ON storage.objects
        FOR SELECT
        TO authenticated
        USING (bucket_id = 'beats-audio');
    $policy$;
  END IF;
END
$$;

COMMIT;
