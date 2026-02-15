/*
  # Add purchase contract PDF support

  - Adds `purchases.contract_pdf_path` to store the generated PDF path.
  - Creates private storage bucket `contracts` for contract PDFs.
  - Adds storage SELECT policy so buyers can read/sign URLs only for their own contracts.
*/

BEGIN;

ALTER TABLE public.purchases
ADD COLUMN IF NOT EXISTS contract_pdf_path text;

CREATE INDEX IF NOT EXISTS idx_purchases_contract_pdf_path
  ON public.purchases (contract_pdf_path)
  WHERE contract_pdf_path IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE 'Schema storage not found; skipping contracts bucket creation.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'contracts') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'contracts',
      'Purchase contracts (private)',
      false,
      5242880, -- 5 MB
      '{application/pdf}'
    );
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
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) INTO objects_exists;

  IF NOT objects_exists THEN
    RAISE NOTICE 'storage.objects table not found; skipping contracts read policy.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Buyers can read own contracts'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Buyers can read own contracts"
        ON storage.objects
        FOR SELECT
        TO authenticated
        USING (
          bucket_id = 'contracts'
          AND EXISTS (
            SELECT 1
            FROM public.purchases p
            WHERE p.user_id = auth.uid()
              AND p.contract_pdf_path IS NOT NULL
              AND p.contract_pdf_path = storage.objects.name
          )
        );
    $policy$;
  END IF;
END
$$;

COMMIT;
