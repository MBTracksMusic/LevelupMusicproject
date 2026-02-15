/*
  # Create storage buckets for beat uploads

  - Adds two buckets: beats-audio (public previews) and beats-covers (public).
  - Enforces MIME/size limits aligned with the frontend (50 MB audio, 5 MB covers).
  - Adds RLS policies so active producers can manage only their own files.
  - Allows public read access to cover images; audio objects readable by owner (bucket is public for previews).
*/

BEGIN;

-- Create buckets idempotently
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping bucket creation.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'beats-audio') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'beats-audio',
      'Producer audio (public previews)',
      true,
      52428800, -- 50 MB
      '{audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave}'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'beats-covers') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'beats-covers',
      'Beat cover images (public)',
      true,
      5242880, -- 5 MB
      '{image/jpeg,image/png}'
    );
  END IF;
END
$$;

-- Helper used by policies to check producer status
CREATE OR REPLACE FUNCTION public.is_active_producer(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := COALESCE(p_user, auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND up.is_producer_active = true
  );
END;
$$;

-- Policies for beats-audio (private)
DO $$
DECLARE
  objects_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping audio policies.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can upload audio'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can upload audio"
        ON storage.objects
        FOR INSERT
        TO authenticated
        WITH CHECK (
          bucket_id = 'beats-audio'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can update their audio'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can update their audio"
        ON storage.objects
        FOR UPDATE
        TO authenticated
        USING (
          bucket_id = 'beats-audio'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        )
        WITH CHECK (
          bucket_id = 'beats-audio'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can delete their audio'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can delete their audio"
        ON storage.objects
        FOR DELETE
        TO authenticated
        USING (
          bucket_id = 'beats-audio'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can read their audio'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can read their audio"
        ON storage.objects
        FOR SELECT
        TO authenticated
        USING (
          bucket_id = 'beats-audio'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
        );
    $policy$;
  END IF;
END
$$;

-- Policies for beats-covers (publicly viewable)
DO $$
DECLARE
  objects_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping cover policies.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can upload covers'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can upload covers"
        ON storage.objects
        FOR INSERT
        TO authenticated
        WITH CHECK (
          bucket_id = 'beats-covers'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can update their covers'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can update their covers"
        ON storage.objects
        FOR UPDATE
        TO authenticated
        USING (
          bucket_id = 'beats-covers'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        )
        WITH CHECK (
          bucket_id = 'beats-covers'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Producers can delete their covers'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Producers can delete their covers"
        ON storage.objects
        FOR DELETE
        TO authenticated
        USING (
          bucket_id = 'beats-covers'
          AND auth.uid() = owner
          AND public.is_active_producer(auth.uid())
          AND name LIKE auth.uid()::text || '/%'
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Anyone can view covers'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Anyone can view covers"
        ON storage.objects
        FOR SELECT
        TO anon, authenticated
        USING (bucket_id = 'beats-covers');
    $policy$;
  END IF;
END
$$;

COMMIT;
