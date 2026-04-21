/*
  # Admin RPC for Elite beat visibility

  Why:
  - The admin UI currently toggles products.is_elite via a direct table update.
  - That action depends on product UPDATE grants + RLS being perfectly aligned.
  - Back-office elite curation should use an admin-only RPC instead.

  Scope:
  - Add a SECURITY DEFINER RPC for toggling is_elite on beats.
  - Keep the existing products table, policies, and public listing logic intact.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_product_elite_status(
  p_product_id uuid,
  p_is_elite boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_admin(v_actor), false) THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required'
      USING ERRCODE = '23502';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_product.product_type <> 'beat' THEN
    RAISE EXCEPTION 'elite_status_only_available_for_beats'
      USING ERRCODE = '22023';
  END IF;

  IF v_product.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot_update_deleted_product'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.products
  SET is_elite = COALESCE(p_is_elite, false)
  WHERE id = p_product_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_product_elite_status(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_product_elite_status(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_product_elite_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_product_elite_status(uuid, boolean) TO service_role;

COMMIT;
