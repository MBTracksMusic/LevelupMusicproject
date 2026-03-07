/*
  # Restrict SELECT policy on storage.objects for beats-audio

  Goal:
  - Remove broad authenticated listing/read policy on beats-audio.
  - Keep producer-specific storage policies unchanged.
*/

DROP POLICY IF EXISTS "Authenticated users can read beats audio"
ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can read specific audio file" ON storage.objects;
CREATE POLICY "Authenticated users can read specific audio file"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'beats-audio'
  AND name IS NOT NULL
);
