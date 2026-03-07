/*
  # Secure beats-audio storage access

  Changes:
  - Force beats-audio bucket to private.
  - Remove broad authenticated read policies.
  - Keep only producer owner read access on beats-audio.
*/

UPDATE storage.buckets
SET public = false
WHERE id = 'beats-audio';

DROP POLICY IF EXISTS "Authenticated users can read beats audio"
ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can read specific audio file"
ON storage.objects;

DROP POLICY IF EXISTS "Producers can read their audio"
ON storage.objects;

DROP POLICY IF EXISTS "Producers can read their audio" ON storage.objects;
CREATE POLICY "Producers can read their audio"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'beats-audio'
  AND owner = auth.uid()
  AND public.is_active_producer(auth.uid())
);
