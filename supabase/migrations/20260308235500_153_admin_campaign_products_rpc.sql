/*
  # Admin RPC: read campaign proposed products with SECURITY DEFINER

  Why:
  - Admin campaign UI must display proposed beat titles/reasons even when
    product rows are not readable through standard frontend RLS paths.

  Security:
  - Execution allowed only for authenticated admins (checked in-function).
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_products_for_campaign(
  p_product_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  title text,
  producer_id uuid,
  product_type text,
  status text,
  is_published boolean,
  deleted_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.producer_id,
    p.product_type::text,
    p.status::text,
    p.is_published,
    p.deleted_at
  FROM public.products p
  WHERE p.id = ANY(p_product_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_products_for_campaign(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_products_for_campaign(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_products_for_campaign(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_products_for_campaign(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_products_for_campaign(uuid[]) TO service_role;

COMMIT;
