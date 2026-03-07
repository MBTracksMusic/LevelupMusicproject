/*
  # Sybil hardening: anonymized fraud event logs for vote/comment/like flows

  Goals:
  - Add dedicated fraud_events table with admin-only read access.
  - Hash request IP / User-Agent before storage (no cleartext IP).
  - Log sensitive actions from battle vote/comment/like RPCs.
*/

BEGIN;

-- 1) Fraud event table (anonymized metadata only).
CREATE TABLE IF NOT EXISTS public.fraud_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid,
  battle_id uuid,
  post_id uuid,
  ip_hash text,
  ua_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fraud_events_event_created_desc
  ON public.fraud_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_events_user_created_desc
  ON public.fraud_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_events_battle_created_desc
  ON public.fraud_events (battle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_events_post_created_desc
  ON public.fraud_events (post_id, created_at DESC);

ALTER TABLE public.fraud_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.fraud_events FROM PUBLIC;
REVOKE ALL ON TABLE public.fraud_events FROM anon;
REVOKE ALL ON TABLE public.fraud_events FROM authenticated;
GRANT SELECT ON TABLE public.fraud_events TO authenticated;
GRANT ALL ON TABLE public.fraud_events TO service_role;

DROP POLICY IF EXISTS "Admins can read fraud_events" ON public.fraud_events;
CREATE POLICY "Admins can read fraud_events"
ON public.fraud_events
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- 2) Helpers for anonymized hashing + event logging.
CREATE OR REPLACE FUNCTION public.hash_request_value(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN encode(extensions.digest(p_value, 'sha256'), 'hex');
  EXCEPTION
    WHEN undefined_function THEN
      RETURN NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hash_request_value(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hash_request_value(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hash_request_value(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hash_request_value(text) TO service_role;

CREATE OR REPLACE FUNCTION public.log_fraud_event(
  p_event_type text,
  p_user_id uuid DEFAULT auth.uid(),
  p_battle_id uuid DEFAULT NULL,
  p_post_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_headers_raw text;
  v_headers jsonb := '{}'::jsonb;
  v_forwarded_for text;
  v_ip text;
  v_user_agent text;
  v_ip_hash text;
  v_ua_hash text;
BEGIN
  v_headers_raw := current_setting('request.headers', true);

  IF v_headers_raw IS NOT NULL AND btrim(v_headers_raw) <> '' THEN
    BEGIN
      v_headers := v_headers_raw::jsonb;
    EXCEPTION
      WHEN OTHERS THEN
        v_headers := '{}'::jsonb;
    END;
  END IF;

  v_forwarded_for := COALESCE(v_headers->>'x-forwarded-for', v_headers->>'X-Forwarded-For');
  v_ip := NULLIF(
    split_part(
      COALESCE(v_forwarded_for, v_headers->>'x-real-ip', v_headers->>'X-Real-Ip', ''),
      ',',
      1
    ),
    ''
  );
  v_user_agent := NULLIF(COALESCE(v_headers->>'user-agent', v_headers->>'User-Agent', ''), '');

  v_ip_hash := public.hash_request_value(v_ip);
  v_ua_hash := public.hash_request_value(v_user_agent);

  INSERT INTO public.fraud_events (
    event_type,
    user_id,
    battle_id,
    post_id,
    ip_hash,
    ua_hash,
    created_at
  )
  VALUES (
    COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown_event'),
    p_user_id,
    p_battle_id,
    p_post_id,
    v_ip_hash,
    v_ua_hash,
    now()
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_fraud_event(text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_fraud_event(text, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_fraud_event(text, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_fraud_event(text, uuid, uuid, uuid) TO service_role;

-- 3) Vote RPC: preserve hardening + add fraud log.
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

  IF NOT public.is_account_old_enough(v_actor, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
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

  PERFORM public.log_fraud_event('battle_vote', v_actor, p_battle_id, NULL);

  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;

-- 4) Battle comment RPC: preserve hardening + add fraud log.
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

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
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

  PERFORM public.log_fraud_event('battle_comment', v_user_id, p_battle_id, NULL);

  RETURN v_row;
END;
$$;

-- 5) Forum like RPC: preserve hardening + add fraud log.
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
  v_inserted_rows integer := 0;
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

  IF to_regclass('public.forum_post_likes') IS NOT NULL THEN
    INSERT INTO public.forum_post_likes (post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  ELSIF to_regclass('public.forum_likes') IS NOT NULL THEN
    INSERT INTO public.forum_likes (post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'likes_table_not_found';
  END IF;

  IF v_inserted_rows > 0 THEN
    PERFORM public.log_fraud_event('forum_like', v_user_id, NULL, p_post_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_like_forum_post(uuid) TO service_role;

COMMIT;
