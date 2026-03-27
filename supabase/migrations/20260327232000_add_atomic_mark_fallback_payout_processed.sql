BEGIN;

CREATE OR REPLACE FUNCTION public.mark_fallback_payout_processed(
  p_purchase_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_processed_at timestamptz := now();
  v_updated_metadata jsonb;
  v_existing_metadata jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF public.is_admin(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'purchase_id_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.purchases p
  SET metadata = jsonb_set(
    jsonb_set(
      COALESCE(p.metadata, '{}'::jsonb),
      '{payout_status}',
      to_jsonb('processed'::text),
      true
    ),
    '{payout_processed_at}',
    to_jsonb(v_processed_at),
    true
  )
  WHERE p.id = p_purchase_id
    AND p.status = 'completed'
    AND COALESCE(p.metadata->>'payout_mode', '') = 'platform_fallback'
    AND lower(COALESCE(p.metadata->>'requires_manual_payout', 'false')) IN ('true', 't', '1')
    AND COALESCE(p.metadata->>'payout_status', 'pending') = 'pending'
    AND COALESCE(p.metadata->>'payout_processed_at', '') = ''
  RETURNING p.metadata INTO v_updated_metadata;

  IF v_updated_metadata IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'processed',
      'purchase_id', p_purchase_id,
      'payout_processed_at', v_processed_at,
      'metadata', v_updated_metadata
    );
  END IF;

  SELECT p.metadata
  INTO v_existing_metadata
  FROM public.purchases p
  WHERE p.id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_existing_metadata->>'payout_mode', '') <> 'platform_fallback'
    OR lower(COALESCE(v_existing_metadata->>'requires_manual_payout', 'false')) NOT IN ('true', 't', '1') THEN
    RAISE EXCEPTION 'not_fallback_payout' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_existing_metadata->>'payout_processed_at', '') <> ''
    OR COALESCE(v_existing_metadata->>'payout_status', 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'already_processed' USING ERRCODE = 'P0001';
  END IF;

  RAISE EXCEPTION 'payout_not_processible' USING ERRCODE = 'P0001';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_fallback_payout_processed(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_fallback_payout_processed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_fallback_payout_processed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_fallback_payout_processed(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_fallback_payout_processed(uuid) IS
  'Atomically marks a fallback payout as processed. Safe against concurrent admin clicks: only one UPDATE can succeed.';

COMMIT;
