-- Add avatars bucket and per-user storage policies
-- Creates `avatars` bucket if missing.
-- Public read access for avatar rendering.
-- Authenticated users can insert/update/delete only inside `avatars/{auth.uid()}/...`.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping avatars bucket creation.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'avatars',
      'User avatars (public)',
      true,
      2097152, -- 2 MB
      '{image/jpeg,image/png,image/webp,image/gif}'
    );
  ELSE
    UPDATE storage.buckets
    SET
      public = true,
      file_size_limit = 2097152,
      allowed_mime_types = '{image/jpeg,image/png,image/webp,image/gif}'
    WHERE id = 'avatars';
  END IF;
END
$$;

DO $$
DECLARE
  objects_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage'
      AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping avatars policies.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
  DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;

  CREATE POLICY "Users can upload avatars"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'avatars'
      AND auth.uid() = owner
      AND name LIKE auth.uid()::text || '/%'
    );

  DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
  CREATE POLICY "Users can update own avatars"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND auth.uid() = owner
      AND name LIKE auth.uid()::text || '/%'
    )
    WITH CHECK (
      bucket_id = 'avatars'
      AND auth.uid() = owner
      AND name LIKE auth.uid()::text || '/%'
    );

  DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
  CREATE POLICY "Users can delete own avatars"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND auth.uid() = owner
      AND name LIKE auth.uid()::text || '/%'
    );

  DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
  CREATE POLICY "Anyone can view avatars"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'avatars');
END
$$;

COMMIT;
