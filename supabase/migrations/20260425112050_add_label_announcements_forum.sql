/*
  # Add Label Announcements forum category

  Goals:
  - Seed a dedicated "Annonces Label" category for label briefs.
  - Keep the category premium-only so announcements are visible to subscribed
    producers.
  - Allow verified labels to access and publish in this one premium category.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.forum_is_verified_label(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = p_user_id
        AND up.account_type = 'label'
        AND up.is_verified = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.forum_is_verified_label(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_is_verified_label(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.forum_is_verified_label(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_is_verified_label(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.forum_is_verified_label(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_is_verified_label(uuid) TO service_role;

INSERT INTO public.forum_categories (
  name,
  slug,
  description,
  is_premium_only,
  position,
  xp_multiplier,
  moderation_strictness,
  is_competitive,
  required_rank_tier,
  allow_links,
  allow_media
)
VALUES (
  'Annonces Label',
  'annonces-label',
  'Recherches et briefs des labels visibles uniquement par les producteurs abonnes.',
  true,
  COALESCE((SELECT max(fc.position) + 1 FROM public.forum_categories fc), 0),
  1,
  'high',
  false,
  NULL,
  true,
  true
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_premium_only = true,
    xp_multiplier = 1,
    moderation_strictness = 'high',
    is_competitive = false,
    required_rank_tier = NULL,
    allow_links = true,
    allow_media = true;

CREATE OR REPLACE FUNCTION public.forum_can_access_category(
  p_category_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.forum_categories fc
    WHERE fc.id = p_category_id
      AND (
        fc.is_premium_only = false
        OR public.forum_has_active_subscription(p_user_id)
        OR (
          fc.slug = 'annonces-label'
          AND public.forum_is_verified_label(p_user_id)
        )
      )
      AND public.forum_user_meets_rank_requirement(p_user_id, fc.required_rank_tier)
  );
$$;

CREATE OR REPLACE FUNCTION public.forum_can_write_topic(
  p_topic_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.forum_topics ft
    JOIN public.forum_categories fc ON fc.id = ft.category_id
    WHERE ft.id = p_topic_id
      AND COALESCE(ft.is_deleted, false) = false
      AND ft.is_locked = false
      AND (
        fc.is_premium_only = false
        OR public.forum_has_active_subscription(p_user_id)
        OR (
          fc.slug = 'annonces-label'
          AND public.forum_is_verified_label(p_user_id)
        )
      )
      AND public.forum_user_meets_rank_requirement(p_user_id, fc.required_rank_tier)
  );
$$;

REVOKE ALL ON FUNCTION public.forum_can_access_category(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_can_access_category(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.forum_can_access_category(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_can_access_category(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.forum_can_access_category(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_can_access_category(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.forum_can_write_topic(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_can_write_topic(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.forum_can_write_topic(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_can_write_topic(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.forum_can_write_topic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_can_write_topic(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS "Forum categories readable" ON public.forum_categories;
CREATE POLICY "Forum categories readable"
  ON public.forum_categories
  FOR SELECT
  TO anon, authenticated
  USING (
    is_premium_only = false
    OR public.forum_has_active_subscription(auth.uid())
    OR (
      slug = 'annonces-label'
      AND public.forum_is_verified_label(auth.uid())
    )
  );

COMMIT;
