/*
  # Soft delete account + profile anonymization

  Goals:
  - Add logical deletion metadata on public.user_profiles.
  - Provide secure RPC for self-account deletion with anonymization.
  - Keep historical FK integrity (no hard delete).
  - Expose safe public labels for deleted accounts.
  - Block write actions for deleted accounts without breaking historical reads.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) user_profiles soft-delete columns + documentation + index
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS deleted_label text,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.deleted_at IS
  'Logical account deletion timestamp. Row remains for FK integrity and historical data.';

COMMENT ON COLUMN public.user_profiles.delete_reason IS
  'Optional user-supplied reason captured during self-account deletion.';

COMMENT ON COLUMN public.user_profiles.deleted_label IS
  'Public safe label shown on historical content once account is deleted.';

COMMENT ON COLUMN public.user_profiles.is_deleted IS
  'True when account was logically deleted. Auth row is not physically deleted.';

CREATE INDEX IF NOT EXISTS idx_user_profiles_is_deleted_deleted_at
  ON public.user_profiles (is_deleted, deleted_at);

CREATE INDEX IF NOT EXISTS idx_user_profiles_deleted
  ON public.user_profiles (is_deleted);

-- ---------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_profile_label(profile_row public.user_profiles)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN profile_row.id IS NULL THEN 'Deleted Producer'
    WHEN COALESCE(profile_row.is_deleted, false) = true
      OR profile_row.deleted_at IS NOT NULL
      THEN COALESCE(NULLIF(btrim(COALESCE(profile_row.deleted_label, '')), ''), 'Deleted Producer')
    ELSE COALESCE(
      NULLIF(btrim(COALESCE(profile_row.username, '')), ''),
      NULLIF(btrim(COALESCE(profile_row.full_name, '')), ''),
      'Producer'
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_profile_label(public.user_profiles) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_profile_label(public.user_profiles) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_label(public.user_profiles) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_label(public.user_profiles) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profile_label(public.user_profiles) TO service_role;

CREATE OR REPLACE FUNCTION public.is_current_user_active(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = COALESCE(p_user_id, auth.uid())
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_current_user_active(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_current_user_active(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_active(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Main RPC: delete_my_account (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account(p_reason text DEFAULT NULL)
RETURNS TABLE (
  success boolean,
  status text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.user_profiles%ROWTYPE;
  v_suffix text;
  v_deleted_username text;
  v_attempt integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF COALESCE(v_profile.is_deleted, false) = true OR v_profile.deleted_at IS NOT NULL THEN
    RETURN QUERY
    SELECT
      true,
      'already_deleted'::text,
      'Account already deleted.'::text;
    RETURN;
  END IF;

  LOOP
    v_suffix := encode(gen_random_bytes(4), 'hex');
    v_deleted_username := 'deleted_' || v_suffix;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.username = v_deleted_username
    );

    v_attempt := v_attempt + 1;
    IF v_attempt >= 8 THEN
      RAISE EXCEPTION 'unable_to_generate_deleted_username';
    END IF;
  END LOOP;

  UPDATE public.user_profiles
  SET
    username = v_deleted_username,
    full_name = NULL,
    avatar_url = NULL,
    bio = NULL,
    website_url = NULL,
    social_links = '{}'::jsonb,
    is_producer_active = false,
    is_deleted = true,
    deleted_at = now(),
    delete_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
    deleted_label = 'Deleted Producer',
    updated_at = now()
  WHERE id = v_user_id;

  IF to_regclass('public.cart_items') IS NOT NULL THEN
    DELETE FROM public.cart_items WHERE user_id = v_user_id;
  END IF;

  IF to_regclass('public.wishlists') IS NOT NULL THEN
    DELETE FROM public.wishlists WHERE user_id = v_user_id;
  END IF;

  RETURN QUERY
  SELECT
    true,
    'deleted'::text,
    'Account deleted and anonymized.'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_account(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO service_role;

COMMENT ON FUNCTION public.delete_my_account(text) IS
  'Self-service logical account deletion + profile anonymization. Preserves all historical FK-linked records.';

-- ---------------------------------------------------------------------------
-- 4) Views/functions exposing public usernames safely
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.my_user_profile
WITH (security_invoker = true)
AS
SELECT
  up.id,
  up.id AS user_id,
  up.username,
  up.full_name,
  up.avatar_url,
  up.role,
  up.producer_tier,
  up.is_producer_active,
  up.total_purchases,
  up.confirmed_at,
  up.producer_verified_at,
  up.battle_refusal_count,
  up.battles_participated,
  up.battles_completed,
  up.engagement_score,
  up.language,
  up.bio,
  up.website_url,
  up.social_links,
  up.created_at,
  up.updated_at,
  up.is_deleted,
  up.deleted_at,
  up.delete_reason,
  up.deleted_label
FROM public.user_profiles up
WHERE up.id = auth.uid();

REVOKE ALL ON TABLE public.my_user_profile FROM PUBLIC;
REVOKE ALL ON TABLE public.my_user_profile FROM anon;
REVOKE ALL ON TABLE public.my_user_profile FROM authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO authenticated;
GRANT SELECT ON TABLE public.my_user_profile TO service_role;

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
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.bio
    END AS bio,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN '{}'::jsonb
      ELSE COALESCE(up.social_links, '{}'::jsonb)
    END AS social_links,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles() TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_producer_profiles_soft()
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
  updated_at timestamptz,
  raw_username text,
  is_deleted boolean,
  is_producer_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    up.id AS user_id,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.bio
    END AS bio,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN '{}'::jsonb
      ELSE COALESCE(up.social_links, '{}'::jsonb)
    END AS social_links,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at,
    up.username AS raw_username,
    (COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL) AS is_deleted,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.producer_subscriptions ps_any
        WHERE ps_any.user_id = up.id
      ) THEN EXISTS (
        SELECT 1
        FROM public.producer_subscriptions ps
        WHERE ps.user_id = up.id
          AND COALESCE(ps.is_producer_active, false) = true
          AND ps.subscription_status IN ('active', 'trialing')
          AND ps.current_period_end > now()
      )
      ELSE COALESCE(up.is_producer_active, false)
    END AS is_producer_active
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_public_producer_profiles_soft() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles_soft() FROM anon;
REVOKE ALL ON FUNCTION public.get_public_producer_profiles_soft() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles_soft() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles_soft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_producer_profiles_soft() TO service_role;

CREATE OR REPLACE VIEW public.public_producer_profiles
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_public_producer_profiles_soft();

REVOKE ALL ON TABLE public.public_producer_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.public_producer_profiles FROM anon;
REVOKE ALL ON TABLE public.public_producer_profiles FROM authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO anon;
GRANT SELECT ON TABLE public.public_producer_profiles TO authenticated;
GRANT SELECT ON TABLE public.public_producer_profiles TO service_role;

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
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_forum_public_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_forum_public_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_forum_public_profiles() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forum_public_profiles() TO service_role;

CREATE OR REPLACE VIEW public.forum_public_profiles
WITH (security_invoker = true)
AS
SELECT *
FROM public.get_forum_public_profiles();

REVOKE ALL ON TABLE public.forum_public_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.forum_public_profiles FROM anon;
REVOKE ALL ON TABLE public.forum_public_profiles FROM authenticated;
GRANT SELECT ON TABLE public.forum_public_profiles TO authenticated;
GRANT SELECT ON TABLE public.forum_public_profiles TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Write guards (RLS + trigger)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owner can update own profile" ON public.user_profiles;

CREATE POLICY "Owner can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  AND COALESCE(is_deleted, false) = false
  AND deleted_at IS NULL
)
WITH CHECK (
  id = auth.uid()
  AND COALESCE(is_deleted, false) = false
  AND deleted_at IS NULL
  AND role IS NOT DISTINCT FROM (SELECT role FROM public.user_profiles WHERE id = auth.uid())
  AND producer_tier IS NOT DISTINCT FROM (SELECT producer_tier FROM public.user_profiles WHERE id = auth.uid())
  AND is_confirmed IS NOT DISTINCT FROM (SELECT is_confirmed FROM public.user_profiles WHERE id = auth.uid())
  AND is_producer_active IS NOT DISTINCT FROM (SELECT is_producer_active FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.user_profiles WHERE id = auth.uid())
  AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.user_profiles WHERE id = auth.uid())
  AND subscription_status IS NOT DISTINCT FROM (SELECT subscription_status FROM public.user_profiles WHERE id = auth.uid())
  AND total_purchases IS NOT DISTINCT FROM (SELECT total_purchases FROM public.user_profiles WHERE id = auth.uid())
  AND confirmed_at IS NOT DISTINCT FROM (SELECT confirmed_at FROM public.user_profiles WHERE id = auth.uid())
  AND producer_verified_at IS NOT DISTINCT FROM (SELECT producer_verified_at FROM public.user_profiles WHERE id = auth.uid())
  AND battle_refusal_count IS NOT DISTINCT FROM (SELECT battle_refusal_count FROM public.user_profiles WHERE id = auth.uid())
  AND battles_participated IS NOT DISTINCT FROM (SELECT battles_participated FROM public.user_profiles WHERE id = auth.uid())
  AND battles_completed IS NOT DISTINCT FROM (SELECT battles_completed FROM public.user_profiles WHERE id = auth.uid())
  AND engagement_score IS NOT DISTINCT FROM (SELECT engagement_score FROM public.user_profiles WHERE id = auth.uid())
  AND elo_rating IS NOT DISTINCT FROM (SELECT elo_rating FROM public.user_profiles WHERE id = auth.uid())
  AND battle_wins IS NOT DISTINCT FROM (SELECT battle_wins FROM public.user_profiles WHERE id = auth.uid())
  AND battle_losses IS NOT DISTINCT FROM (SELECT battle_losses FROM public.user_profiles WHERE id = auth.uid())
  AND battle_draws IS NOT DISTINCT FROM (SELECT battle_draws FROM public.user_profiles WHERE id = auth.uid())
  AND is_deleted IS NOT DISTINCT FROM (SELECT is_deleted FROM public.user_profiles WHERE id = auth.uid())
  AND deleted_at IS NOT DISTINCT FROM (SELECT deleted_at FROM public.user_profiles WHERE id = auth.uid())
  AND delete_reason IS NOT DISTINCT FROM (SELECT delete_reason FROM public.user_profiles WHERE id = auth.uid())
  AND deleted_label IS NOT DISTINCT FROM (SELECT deleted_label FROM public.user_profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Confirmed users can vote" ON public.battle_votes;
CREATE POLICY "Confirmed users can vote"
ON public.battle_votes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_current_user_active(auth.uid()) = true
  AND public.is_email_verified_user(auth.uid())
  AND public.is_account_old_enough(auth.uid(), interval '24 hours')
  AND current_setting('app.battle_vote_rpc', true) = '1'
  AND voted_for_producer_id != auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.battles b
    WHERE b.id = battle_votes.battle_id
      AND b.status = 'active'
      AND b.starts_at IS NOT NULL
      AND b.starts_at <= now()
      AND b.voting_ends_at IS NOT NULL
      AND now() < b.voting_ends_at
      AND b.producer1_id IS NOT NULL
      AND b.producer2_id IS NOT NULL
      AND (
        voted_for_producer_id = b.producer1_id
        OR voted_for_producer_id = b.producer2_id
      )
      AND auth.uid() != b.producer1_id
      AND auth.uid() != b.producer2_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.battle_votes bv
    WHERE bv.battle_id = battle_votes.battle_id
      AND bv.user_id = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.battle_votes bv_recent
    WHERE bv_recent.user_id = auth.uid()
      AND bv_recent.created_at > now() - interval '30 seconds'
  )
);

DROP POLICY IF EXISTS "Confirmed users can comment" ON public.battle_comments;
CREATE POLICY "Confirmed users can comment"
ON public.battle_comments
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_current_user_active(auth.uid()) = true
  AND public.is_email_verified_user(auth.uid())
  AND current_setting('app.battle_comment_rpc', true) = '1'
  AND EXISTS (
    SELECT 1
    FROM public.battles b
    WHERE b.id = battle_comments.battle_id
      AND b.status IN ('active', 'voting')
  )
);

DROP POLICY IF EXISTS "Active producers can create battles" ON public.battles;
CREATE POLICY "Active producers can create battles"
  ON public.battles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND producer1_id = auth.uid()
    AND producer2_id IS NOT NULL
    AND producer1_id != producer2_id
    AND status = 'pending_acceptance'
    AND winner_id IS NULL
    AND votes_producer1 = 0
    AND votes_producer2 = 0
    AND accepted_at IS NULL
    AND rejected_at IS NULL
    AND admin_validated_at IS NULL
    AND public.can_create_battle(auth.uid()) = true
    AND public.can_create_active_battle(auth.uid()) = true
    AND public.assert_battle_skill_gap(auth.uid(), producer2_id, 400) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up2
      WHERE up2.id = producer2_id
        AND up2.id <> auth.uid()
        AND up2.role IN ('producer', 'admin')
        AND up2.is_producer_active = true
        AND COALESCE(up2.is_deleted, false) = false
        AND up2.deleted_at IS NULL
    )
    AND (
      product1_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p1
        WHERE p1.id = product1_id
          AND p1.producer_id = auth.uid()
          AND p1.deleted_at IS NULL
      )
    )
    AND (
      product2_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.products p2
        WHERE p2.id = product2_id
          AND p2.producer_id = producer2_id
          AND p2.deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS "Active producers can create products" ON public.products;
CREATE POLICY "Active producers can create products"
  ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    producer_id = auth.uid()
    AND public.is_current_user_active(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
    AND (
      NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL)
      OR public.can_publish_beat(auth.uid(), NULL)
    )
  );

DROP POLICY IF EXISTS "Producers can update own unsold products" ON public.products;
CREATE POLICY "Producers can update own unsold products"
  ON public.products
  FOR UPDATE
  TO authenticated
  USING (
    producer_id = auth.uid()
    AND deleted_at IS NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchases pu
      WHERE pu.product_id = products.id
        AND pu.status IN ('completed', 'refunded')
    )
  )
  WITH CHECK (
    producer_id = auth.uid()
    AND deleted_at IS NULL
    AND public.is_current_user_active(auth.uid()) = true
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_producer_active = true
        AND COALESCE(up.is_deleted, false) = false
        AND up.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.purchases pu
      WHERE pu.product_id = products.id
        AND pu.status IN ('completed', 'refunded')
    )
    AND (
      NOT (product_type = 'beat' AND is_published = true AND deleted_at IS NULL)
      OR public.can_publish_beat(auth.uid(), id)
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_active_user_id_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_current_user_active(NEW.user_id) THEN
    RAISE EXCEPTION 'account_deleted_or_inactive';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'battle_votes',
    'battle_comments',
    'battle_vote_feedback',
    'user_music_preferences',
    'forum_topics',
    'forum_posts',
    'forum_likes',
    'forum_post_likes',
    'purchases',
    'cart_items',
    'wishlists'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_%I_require_active_user_id ON public.%I',
        v_table,
        v_table
      );

      EXECUTE format(
        'CREATE TRIGGER trg_%I_require_active_user_id
           BEFORE INSERT OR UPDATE OF user_id
           ON public.%I
           FOR EACH ROW
           EXECUTE FUNCTION public.enforce_active_user_id_reference()',
        v_table,
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
