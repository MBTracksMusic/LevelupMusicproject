/*
  # Harden battle vote window + add anti-fraud rate limits + battle comment RPC + reputation tuning

  Goals:
  - Enforce vote time window in policy and vote RPC.
  - Add per-user RPC rate limits for vote/comment flows.
  - Introduce RPC path for battle comment creation.
  - Reduce forum like reputation farming.
*/

BEGIN;

-- 1) Allow explicit per_user scope in rpc_rate_limit_rules.
DO $$
DECLARE
  v_scope_check text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_scope_check
  FROM pg_constraint c
  WHERE c.conrelid = 'public.rpc_rate_limit_rules'::regclass
    AND c.conname = 'rpc_rate_limit_rules_scope_check'
    AND c.contype = 'c';

  IF v_scope_check IS NULL OR v_scope_check NOT ILIKE '%per_user%' THEN
    ALTER TABLE public.rpc_rate_limit_rules
      DROP CONSTRAINT IF EXISTS rpc_rate_limit_rules_scope_check;

    ALTER TABLE public.rpc_rate_limit_rules
      ADD CONSTRAINT rpc_rate_limit_rules_scope_check
      CHECK (scope IN ('per_admin', 'per_user', 'global'));
  END IF;
END
$$;

-- 2) Harden battle_votes INSERT policy with explicit time window.
DROP POLICY IF EXISTS "Confirmed users can vote" ON public.battle_votes;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_votes'
      AND policyname = 'Confirmed users can vote'
  ) THEN
    CREATE POLICY "Confirmed users can vote"
    ON public.battle_votes
    FOR INSERT
    TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND public.is_email_verified_user(auth.uid())
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
    );
  END IF;
END $$;

-- 3) Require battle comment inserts to go through rpc_create_battle_comment.
DROP POLICY IF EXISTS "Confirmed users can comment" ON public.battle_comments;
DROP POLICY IF EXISTS "Authenticated users can comment" ON public.battle_comments;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'battle_comments'
      AND policyname = 'Confirmed users can comment'
  ) THEN
    CREATE POLICY "Confirmed users can comment"
    ON public.battle_comments
    FOR INSERT
    TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND public.is_email_verified_user(auth.uid())
      AND current_setting('app.battle_comment_rpc', true) = '1'
      AND EXISTS (
        SELECT 1
        FROM public.battles b
        WHERE b.id = battle_comments.battle_id
          AND b.status IN ('active', 'voting')
      )
    );
  END IF;
END $$;

-- 4) record_battle_vote: enforce time window + RPC rate limit.
CREATE OR REPLACE FUNCTION public.record_battle_vote(
  p_battle_id uuid,
  p_user_id uuid,
  p_voted_for_producer_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_battle public.battles%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'vote_user_mismatch';
  END IF;

  IF NOT public.is_email_verified_user(p_user_id) THEN
    RAISE EXCEPTION 'vote_not_allowed_unverified_email';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'record_battle_vote') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'active' THEN
    RAISE EXCEPTION 'battle_not_open_for_voting';
  END IF;

  IF v_battle.starts_at IS NULL OR now() < v_battle.starts_at THEN
    RAISE EXCEPTION 'battle_not_started';
  END IF;

  IF v_battle.voting_ends_at IS NULL OR now() >= v_battle.voting_ends_at THEN
    RAISE EXCEPTION 'battle_voting_expired';
  END IF;

  IF v_battle.producer1_id IS NULL OR v_battle.producer2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready_for_voting';
  END IF;

  IF p_voted_for_producer_id != v_battle.producer1_id
     AND p_voted_for_producer_id != v_battle.producer2_id THEN
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_actor = v_battle.producer1_id
     OR v_actor = v_battle.producer2_id THEN
    RAISE EXCEPTION 'participants_cannot_vote';
  END IF;

  IF p_voted_for_producer_id = v_actor THEN
    RAISE EXCEPTION 'self_vote_not_allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes
    WHERE battle_id = p_battle_id
      AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_voted';
  END IF;

  INSERT INTO public.battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, v_actor, p_voted_for_producer_id);

  IF p_voted_for_producer_id = v_battle.producer1_id THEN
    UPDATE public.battles
    SET votes_producer1 = votes_producer1 + 1
    WHERE id = p_battle_id;
  ELSE
    UPDATE public.battles
    SET votes_producer2 = votes_producer2 + 1
    WHERE id = p_battle_id;
  END IF;

  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;

-- 5) Create RPC for battle comment creation.
CREATE OR REPLACE FUNCTION public.rpc_create_battle_comment(
  p_battle_id uuid,
  p_content text
)
RETURNS public.battle_comments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_row public.battle_comments;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_create_battle_comment') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_comment';
  END IF;

  IF char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long';
  END IF;

  -- Gate direct inserts: only this RPC sets this flag for the current transaction.
  PERFORM set_config('app.battle_comment_rpc', '1', true);

  INSERT INTO public.battle_comments (battle_id, user_id, content)
  VALUES (p_battle_id, v_user_id, v_content)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_battle_comment(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_create_battle_comment(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_create_battle_comment(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle_comment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle_comment(uuid, text) TO service_role;

-- 6) Rate-limit rules for anti-fraud protection.
INSERT INTO public.rpc_rate_limit_rules
  (rpc_name, scope, allowed_per_minute, is_enabled)
VALUES
  ('record_battle_vote', 'per_user', 6, true),
  ('rpc_create_battle_comment', 'per_user', 12, true)
ON CONFLICT (rpc_name)
DO UPDATE SET
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

-- 7) Reduce reputation farming surface for forum likes.
UPDATE public.reputation_rules
SET
  cooldown_sec = 30,
  max_per_day = 50,
  updated_at = now()
WHERE key = 'forum_post_liked';

COMMIT;
