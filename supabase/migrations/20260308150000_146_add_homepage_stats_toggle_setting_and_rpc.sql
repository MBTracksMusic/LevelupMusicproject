/*
  # Add homepage stats toggle in app_settings and expose via get_home_stats RPC

  - Seeds `show_homepage_stats` setting with default disabled payload.
  - Extends `public.get_home_stats()` JSON payload with `show_homepage_stats`.
  - Keeps existing counters and grants unchanged.
*/

BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES ('show_homepage_stats', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

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
    ),
    'show_homepage_stats',
    COALESCE(
      (
        SELECT
          CASE
            WHEN jsonb_typeof(s.value -> 'enabled') = 'boolean' THEN (s.value ->> 'enabled')::boolean
            WHEN lower(COALESCE(s.value ->> 'enabled', '')) IN ('true', 'false') THEN (s.value ->> 'enabled')::boolean
            ELSE false
          END
        FROM public.app_settings s
        WHERE s.key = 'show_homepage_stats'
        LIMIT 1
      ),
      false
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_home_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_home_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_home_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_home_stats() TO service_role;

COMMIT;
