/*
  # Add public RPC for homepage stats

  Additive migration:
  - Introduces public.get_home_stats() for safe aggregated counters
  - No table structure changes
  - No policy changes
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.get_home_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'beats_published',
    (
      SELECT COUNT(*)
      FROM public.products p
      WHERE p.product_type = 'beat'
        AND p.is_published = true
        AND p.deleted_at IS NULL
    ),
    'active_producers',
    (
      SELECT COUNT(*)
      FROM public.user_profiles up
      WHERE up.is_producer_active = true
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_home_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_home_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_home_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_home_stats() TO service_role;

COMMIT;
