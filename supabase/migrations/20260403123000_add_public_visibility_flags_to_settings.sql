/*
  # Add public visibility flags to settings singleton

  - Adds `show_homepage_stats` and `show_pricing_plans` to `public.settings`.
  - Backfills homepage stats visibility from legacy `public.app_settings.show_homepage_stats`.
  - Makes `public.get_home_stats()` read the settings singleton so public pages share one source of truth.
  - Reuses existing settings RLS and realtime publication.
*/

BEGIN;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS show_homepage_stats boolean NOT NULL DEFAULT false;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS show_pricing_plans boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.settings.show_homepage_stats IS
  'When true, homepage statistics pills are visible on the public homepage.';

COMMENT ON COLUMN public.settings.show_pricing_plans IS
  'When true, pricing plans are visible on the public pricing page.';

INSERT INTO public.settings (maintenance_mode, show_homepage_stats, show_pricing_plans)
SELECT
  false,
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
  ),
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.settings
);

UPDATE public.settings
SET show_homepage_stats = legacy.enabled
FROM (
  SELECT
    CASE
      WHEN jsonb_typeof(s.value -> 'enabled') = 'boolean' THEN (s.value ->> 'enabled')::boolean
      WHEN lower(COALESCE(s.value ->> 'enabled', '')) IN ('true', 'false') THEN (s.value ->> 'enabled')::boolean
      ELSE false
    END AS enabled
  FROM public.app_settings s
  WHERE s.key = 'show_homepage_stats'
  LIMIT 1
) AS legacy
WHERE public.settings.show_homepage_stats = false;

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
        SELECT s.show_homepage_stats
        FROM public.settings s
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
