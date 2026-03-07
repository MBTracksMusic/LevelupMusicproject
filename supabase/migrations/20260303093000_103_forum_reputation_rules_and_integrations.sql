/*
  # Forum category rules + public reputation exposure + reputation integrations

  Adds:
  - forum category competitive/rules columns
  - rank-aware forum access helpers
  - authenticated forum public profiles view
  - reputation fields on public_producer_profiles
  - auto XP on forum likes and completed battles
  - admin RPCs for forum category writes with audit
*/

BEGIN;

ALTER TABLE public.forum_categories
  ADD COLUMN IF NOT EXISTS xp_multiplier numeric NOT NULL DEFAULT 1 CHECK (xp_multiplier > 0),
  ADD COLUMN IF NOT EXISTS moderation_strictness text NOT NULL DEFAULT 'normal' CHECK (moderation_strictness IN ('low', 'normal', 'high')),
  ADD COLUMN IF NOT EXISTS is_competitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS required_rank_tier text NULL CHECK (required_rank_tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  ADD COLUMN IF NOT EXISTS allow_links boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_media boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.forum_get_user_rank_tier(p_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 'bronze'
    WHEN public.is_admin(p_user_id) THEN 'diamond'
    WHEN public.forum_is_assistant_user(p_user_id) THEN 'diamond'
    ELSE COALESCE((
      SELECT ur.rank_tier
      FROM public.user_reputation ur
      WHERE ur.user_id = p_user_id
      LIMIT 1
    ), 'bronze')
  END;
$$;

CREATE OR REPLACE FUNCTION public.forum_user_meets_rank_requirement(
  p_user_id uuid DEFAULT auth.uid(),
  p_required_rank_tier text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_required_rank_tier, '')), '') IS NULL THEN true
    WHEN p_user_id IS NULL THEN false
    WHEN public.is_admin(p_user_id) THEN true
    WHEN public.forum_is_assistant_user(p_user_id) THEN true
    ELSE public.reputation_rank_tier_value(public.forum_get_user_rank_tier(p_user_id))
      >= public.reputation_rank_tier_value(p_required_rank_tier)
  END;
$$;

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
      )
      AND public.forum_user_meets_rank_requirement(p_user_id, fc.required_rank_tier)
  );
$$;

GRANT EXECUTE ON FUNCTION public.forum_get_user_rank_tier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_get_user_rank_tier(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.forum_user_meets_rank_requirement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_user_meets_rank_requirement(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.forum_can_access_category(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_can_access_category(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.forum_can_write_topic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_can_write_topic(uuid, uuid) TO service_role;

DROP VIEW IF EXISTS public.public_producer_profiles;
DROP FUNCTION IF EXISTS public.get_public_producer_profiles();

CREATE OR REPLACE FUNCTION public.get_public_producer_profiles()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  bio text,
  social_links jsonb,
  xp bigint,
  level integer,
  rank_tier text,
  reputation_score numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    up.bio,
    up.social_links,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE up.is_producer_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO service_role;

CREATE VIEW public.public_producer_profiles
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_public_producer_profiles();

REVOKE ALL ON TABLE public.public_producer_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.public_producer_profiles FROM anon;
REVOKE ALL ON TABLE public.public_producer_profiles FROM authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO service_role;

DROP VIEW IF EXISTS public.forum_public_profiles;
DROP FUNCTION IF EXISTS public.get_forum_public_profiles();

CREATE OR REPLACE FUNCTION public.get_forum_public_profiles()
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  producer_tier public.producer_tier_type,
  xp bigint,
  level integer,
  rank_tier text,
  reputation_score numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE up.username IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_forum_public_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_forum_public_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_forum_public_profiles() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles() TO service_role;

CREATE VIEW public.forum_public_profiles
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_forum_public_profiles();

REVOKE ALL ON TABLE public.forum_public_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.forum_public_profiles FROM anon;
REVOKE ALL ON TABLE public.forum_public_profiles FROM authenticated;
GRANT SELECT ON TABLE public.forum_public_profiles TO authenticated;
GRANT SELECT ON TABLE public.forum_public_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.on_battle_completed_reputation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed' THEN
    PERFORM public.apply_reputation_event_internal(
      p_user_id => NEW.producer1_id,
      p_source => 'battles',
      p_event_type => 'battle_participation',
      p_entity_type => 'battle',
      p_entity_id => NEW.id,
      p_delta => NULL,
      p_metadata => jsonb_build_object(
        'battle_id', NEW.id,
        'role', 'producer1'
      ),
      p_idempotency_key => 'battle_participation:' || NEW.id::text || ':' || NEW.producer1_id::text
    );

    IF NEW.producer2_id IS NOT NULL THEN
      PERFORM public.apply_reputation_event_internal(
        p_user_id => NEW.producer2_id,
        p_source => 'battles',
        p_event_type => 'battle_participation',
        p_entity_type => 'battle',
        p_entity_id => NEW.id,
        p_delta => NULL,
        p_metadata => jsonb_build_object(
          'battle_id', NEW.id,
          'role', 'producer2'
        ),
        p_idempotency_key => 'battle_participation:' || NEW.id::text || ':' || NEW.producer2_id::text
      );
    END IF;

    IF NEW.winner_id IS NOT NULL THEN
      PERFORM public.apply_reputation_event_internal(
        p_user_id => NEW.winner_id,
        p_source => 'battles',
        p_event_type => 'battle_won',
        p_entity_type => 'battle',
        p_entity_id => NEW.id,
        p_delta => NULL,
        p_metadata => jsonb_build_object(
          'battle_id', NEW.id,
          'winner_id', NEW.winner_id
        ),
        p_idempotency_key => 'battle_won:' || NEW.id::text || ':' || NEW.winner_id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_battle_completed_reputation ON public.battles;
CREATE TRIGGER trg_battle_completed_reputation
  AFTER UPDATE ON public.battles
  FOR EACH ROW
  EXECUTE FUNCTION public.on_battle_completed_reputation();

CREATE OR REPLACE FUNCTION public.on_forum_post_like_reputation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post_user_id uuid;
BEGIN
  SELECT fp.user_id
  INTO v_post_user_id
  FROM public.forum_posts fp
  WHERE fp.id = NEW.post_id
  LIMIT 1;

  IF v_post_user_id IS NULL OR v_post_user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_reputation_event_internal(
    p_user_id => v_post_user_id,
    p_source => 'forum',
    p_event_type => 'forum_post_liked',
    p_entity_type => 'forum_post',
    p_entity_id => NEW.post_id,
    p_delta => NULL,
    p_metadata => jsonb_build_object(
      'liked_by_user_id', NEW.user_id,
      'post_id', NEW.post_id,
      'source_table', TG_TABLE_NAME
    ),
    p_idempotency_key => 'forum_post_liked:' || NEW.post_id::text || ':' || NEW.user_id::text
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.forum_post_likes') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_forum_post_likes_reputation ON public.forum_post_likes';
    EXECUTE '
      DROP TRIGGER IF EXISTS trg_forum_post_likes_reputation ON public.forum_post_likes;
      CREATE TRIGGER trg_forum_post_likes_reputation
      AFTER INSERT ON public.forum_post_likes
      FOR EACH ROW
      EXECUTE FUNCTION public.on_forum_post_like_reputation()
    ';
  END IF;

  IF to_regclass('public.forum_likes') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_forum_likes_reputation ON public.forum_likes';
    EXECUTE '
      DROP TRIGGER IF EXISTS trg_forum_likes_reputation ON public.forum_likes;
      CREATE TRIGGER trg_forum_likes_reputation
      AFTER INSERT ON public.forum_likes
      FOR EACH ROW
      EXECUTE FUNCTION public.on_forum_post_like_reputation()
    ';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.forum_admin_upsert_category(
  p_category_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_position integer DEFAULT NULL,
  p_is_premium_only boolean DEFAULT false,
  p_xp_multiplier numeric DEFAULT 1,
  p_moderation_strictness text DEFAULT 'normal',
  p_is_competitive boolean DEFAULT false,
  p_required_rank_tier text DEFAULT NULL,
  p_allow_links boolean DEFAULT true,
  p_allow_media boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  description text,
  is_premium_only boolean,
  "position" integer,
  xp_multiplier numeric,
  moderation_strictness text,
  is_competitive boolean,
  required_rank_tier text,
  allow_links boolean,
  allow_media boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_row public.forum_categories%ROWTYPE;
  v_effective_slug text := COALESCE(NULLIF(btrim(COALESCE(p_slug, '')), ''), NULLIF(btrim(COALESCE(p_name, '')), ''));
  v_effective_position integer := COALESCE(
    p_position,
    (SELECT COALESCE(max(fc.position), -1) + 1 FROM public.forum_categories fc)
  );
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  IF v_effective_slug IS NULL OR btrim(v_effective_slug) = '' THEN
    RAISE EXCEPTION 'slug_required';
  END IF;

  IF p_moderation_strictness NOT IN ('low', 'normal', 'high') THEN
    RAISE EXCEPTION 'invalid_moderation_strictness';
  END IF;

  IF p_required_rank_tier IS NOT NULL AND p_required_rank_tier NOT IN ('bronze', 'silver', 'gold', 'platinum', 'diamond') THEN
    RAISE EXCEPTION 'invalid_required_rank_tier';
  END IF;

  IF p_category_id IS NULL THEN
    INSERT INTO public.forum_categories (
      name,
      slug,
      description,
      position,
      is_premium_only,
      xp_multiplier,
      moderation_strictness,
      is_competitive,
      required_rank_tier,
      allow_links,
      allow_media
    )
    VALUES (
      btrim(p_name),
      btrim(v_effective_slug),
      NULLIF(btrim(COALESCE(p_description, '')), ''),
      GREATEST(0, v_effective_position),
      COALESCE(p_is_premium_only, false),
      GREATEST(COALESCE(p_xp_multiplier, 1), 0.1),
      p_moderation_strictness,
      COALESCE(p_is_competitive, false),
      p_required_rank_tier,
      COALESCE(p_allow_links, true),
      COALESCE(p_allow_media, true)
    )
    RETURNING * INTO v_row;

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'forum_category_create',
      p_entity_type => 'forum_category',
      p_entity_id => v_row.id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'slug', v_row.slug,
        'name', v_row.name
      ),
      p_extra_details => jsonb_build_object(
        'is_premium_only', v_row.is_premium_only,
        'is_competitive', v_row.is_competitive,
        'required_rank_tier', v_row.required_rank_tier,
        'xp_multiplier', v_row.xp_multiplier,
        'moderation_strictness', v_row.moderation_strictness,
        'allow_links', v_row.allow_links,
        'allow_media', v_row.allow_media
      ),
      p_success => true,
      p_error => NULL
    );
  ELSE
    UPDATE public.forum_categories
    SET name = btrim(p_name),
        slug = btrim(v_effective_slug),
        description = NULLIF(btrim(COALESCE(p_description, '')), ''),
        position = GREATEST(0, v_effective_position),
        is_premium_only = COALESCE(p_is_premium_only, false),
        xp_multiplier = GREATEST(COALESCE(p_xp_multiplier, 1), 0.1),
        moderation_strictness = p_moderation_strictness,
        is_competitive = COALESCE(p_is_competitive, false),
        required_rank_tier = p_required_rank_tier,
        allow_links = COALESCE(p_allow_links, true),
        allow_media = COALESCE(p_allow_media, true)
    WHERE id = p_category_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'category_not_found';
    END IF;

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'forum_category_update',
      p_entity_type => 'forum_category',
      p_entity_id => v_row.id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'slug', v_row.slug,
        'name', v_row.name
      ),
      p_extra_details => jsonb_build_object(
        'is_premium_only', v_row.is_premium_only,
        'is_competitive', v_row.is_competitive,
        'required_rank_tier', v_row.required_rank_tier,
        'xp_multiplier', v_row.xp_multiplier,
        'moderation_strictness', v_row.moderation_strictness,
        'allow_links', v_row.allow_links,
        'allow_media', v_row.allow_media
      ),
      p_success => true,
      p_error => NULL
    );
  END IF;

  RETURN QUERY
  SELECT
    v_row.id,
    v_row.name,
    v_row.slug,
    v_row.description,
    v_row.is_premium_only,
    v_row.position AS "position",
    v_row.xp_multiplier,
    v_row.moderation_strictness,
    v_row.is_competitive,
    v_row.required_rank_tier,
    v_row.allow_links,
    v_row.allow_media,
    v_row.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.forum_admin_delete_category(p_category_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_category public.forum_categories%ROWTYPE;
  v_topic_count integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT *
  INTO v_category
  FROM public.forum_categories
  WHERE id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  SELECT count(*)::integer
  INTO v_topic_count
  FROM public.forum_topics
  WHERE category_id = p_category_id;

  IF v_topic_count > 0 THEN
    RAISE EXCEPTION 'category_has_topics';
  END IF;

  DELETE FROM public.forum_categories
  WHERE id = p_category_id;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'forum_category_delete',
    p_entity_type => 'forum_category',
    p_entity_id => p_category_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'slug', v_category.slug,
      'name', v_category.name
    ),
    p_extra_details => '{}'::jsonb,
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.forum_admin_upsert_category(uuid, text, text, text, integer, boolean, numeric, text, boolean, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_admin_upsert_category(uuid, text, text, text, integer, boolean, numeric, text, boolean, text, boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.forum_admin_upsert_category(uuid, text, text, text, integer, boolean, numeric, text, boolean, text, boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_upsert_category(uuid, text, text, text, integer, boolean, numeric, text, boolean, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_upsert_category(uuid, text, text, text, integer, boolean, numeric, text, boolean, text, boolean, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.forum_admin_delete_category(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forum_admin_delete_category(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.forum_admin_delete_category(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_delete_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forum_admin_delete_category(uuid) TO service_role;

COMMIT;
