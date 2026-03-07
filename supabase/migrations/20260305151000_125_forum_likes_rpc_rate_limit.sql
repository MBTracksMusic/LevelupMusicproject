/*
  # Sybil hardening: forum likes through RPC only + rate limiting

  Goals:
  - Remove direct client INSERT path for forum likes.
  - Enforce auth + account-age + rate-limit in RPC.
  - Gate INSERT policies with a transaction flag set only by the RPC.
*/

BEGIN;

-- 1) RPC for forum likes (idempotent) with anti-Sybil checks.
CREATE OR REPLACE FUNCTION public.rpc_like_forum_post(
  p_post_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'post_id_required';
  END IF;

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_like_forum_post') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- Gate direct inserts: only this RPC sets this flag for the current transaction.
  PERFORM set_config('app.forum_like_rpc', '1', true);

  -- Prefer current forum schema; fallback to legacy isolated module if needed.
  IF to_regclass('public.forum_post_likes') IS NOT NULL THEN
    INSERT INTO public.forum_post_likes (post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;
  ELSIF to_regclass('public.forum_likes') IS NOT NULL THEN
    INSERT INTO public.forum_likes (post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'likes_table_not_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) TO service_role;

-- 2) Add (or update) rate-limit rule for likes.
INSERT INTO public.rpc_rate_limit_rules
  (rpc_name, scope, allowed_per_minute, is_enabled)
VALUES
  ('rpc_like_forum_post', 'per_user', 30, true)
ON CONFLICT (rpc_name)
DO UPDATE SET
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

-- 3) forum_likes: require RPC flag for INSERT (legacy isolated module).
DO $$
BEGIN
  IF to_regclass('public.forum_likes') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can like forum posts" ON public.forum_likes';
    EXECUTE 'DROP POLICY IF EXISTS "Likes via RPC only" ON public.forum_likes';

    EXECUTE $policy$
      DROP POLICY IF EXISTS "Likes via RPC only" ON public.forum_likes;
      CREATE POLICY "Likes via RPC only"
      ON public.forum_likes
      FOR INSERT
      TO authenticated
      WITH CHECK (
        current_setting('app.forum_like_rpc', true) = '1'
        AND user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.forum_posts fp
          WHERE fp.id = forum_likes.post_id
            AND COALESCE(fp.is_deleted, false) = false
        )
      )
    $policy$;
  END IF;
END
$$;

-- 4) forum_post_likes: require RPC flag for INSERT (current forum schema).
DO $$
BEGIN
  IF to_regclass('public.forum_post_likes') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can like forum posts" ON public.forum_post_likes';
    EXECUTE 'DROP POLICY IF EXISTS "Likes via RPC only" ON public.forum_post_likes';

    EXECUTE $policy$
      DROP POLICY IF EXISTS "Likes via RPC only" ON public.forum_post_likes;
      CREATE POLICY "Likes via RPC only"
      ON public.forum_post_likes
      FOR INSERT
      TO authenticated
      WITH CHECK (
        current_setting('app.forum_like_rpc', true) = '1'
        AND user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.forum_posts fp
          JOIN public.forum_topics ft ON ft.id = fp.topic_id
          WHERE fp.id = forum_post_likes.post_id
            AND fp.is_deleted = false
            AND public.forum_can_write_topic(ft.id, auth.uid())
        )
      )
    $policy$;
  END IF;
END
$$;

COMMIT;
