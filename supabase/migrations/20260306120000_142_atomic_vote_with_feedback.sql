/*
  # Atomic vote + feedback for battles

  Goals:
  - Persist battle vote and qualitative feedback in one atomic RPC.
  - Prevent counting a vote without explicit feedback submission.
  - Block legacy/direct client paths that could bypass the modal confirmation.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Security hardening: block direct battle_votes writes from client roles.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON TABLE public.battle_votes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.battle_votes FROM authenticated;

DROP POLICY IF EXISTS "Confirmed users can vote" ON public.battle_votes;

CREATE POLICY "Confirmed users can vote"
ON public.battle_votes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
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

-- ---------------------------------------------------------------------------
-- 2) Atomic RPC: vote + feedback in one transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_vote_with_feedback(
  p_battle_id uuid,
  p_winner_producer_id uuid,
  p_criteria text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_vote_id uuid;
  v_winner_product_id uuid;
  v_raw_criteria text[] := COALESCE(p_criteria, ARRAY[]::text[]);
  v_criteria text[];
  v_invalid_criteria text[];
  v_feedback_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_battle_id IS NULL OR p_winner_producer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_feedback_payload';
  END IF;

  IF NOT public.is_email_verified_user(v_user_id) THEN
    RAISE EXCEPTION 'vote_not_allowed_unverified_email';
  END IF;

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_vote_with_feedback') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF COALESCE(array_length(v_raw_criteria, 1), 0) = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  IF COALESCE(array_length(v_raw_criteria, 1), 0) > 3 THEN
    RAISE EXCEPTION 'feedback_max_3_criteria';
  END IF;

  SELECT array_agg(DISTINCT normalized.criterion ORDER BY normalized.criterion)
  INTO v_criteria
  FROM (
    SELECT lower(btrim(raw_value)) AS criterion
    FROM unnest(v_raw_criteria) AS raw_value
    WHERE btrim(COALESCE(raw_value, '')) <> ''
  ) AS normalized;

  IF COALESCE(array_length(v_criteria, 1), 0) = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  IF COALESCE(array_length(v_criteria, 1), 0) > 3 THEN
    RAISE EXCEPTION 'feedback_max_3_criteria';
  END IF;

  SELECT array_agg(c)
  INTO v_invalid_criteria
  FROM unnest(v_criteria) AS c
  WHERE c NOT IN (
    'groove',
    'melody',
    'ambience',
    'sound_design',
    'drums',
    'mix',
    'originality',
    'energy',
    'artistic_vibe'
  );

  IF COALESCE(array_length(v_invalid_criteria, 1), 0) > 0 THEN
    RAISE EXCEPTION 'feedback_invalid_criterion';
  END IF;

  SELECT *
  INTO v_battle
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

  IF p_winner_producer_id != v_battle.producer1_id
     AND p_winner_producer_id != v_battle.producer2_id THEN
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_user_id = v_battle.producer1_id
     OR v_user_id = v_battle.producer2_id THEN
    RAISE EXCEPTION 'participants_cannot_vote';
  END IF;

  IF p_winner_producer_id = v_user_id THEN
    RAISE EXCEPTION 'self_vote_not_allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes bv
    WHERE bv.battle_id = p_battle_id
      AND bv.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'already_voted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes bv
    WHERE bv.user_id = v_user_id
      AND bv.created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'vote_cooldown';
  END IF;

  IF p_winner_producer_id = v_battle.producer1_id THEN
    v_winner_product_id := v_battle.product1_id;
  ELSE
    v_winner_product_id := v_battle.product2_id;
  END IF;

  IF v_winner_product_id IS NULL THEN
    RAISE EXCEPTION 'winner_product_not_found';
  END IF;

  -- Gate direct inserts: only this RPC enables write paths for this transaction.
  PERFORM set_config('app.battle_vote_rpc', '1', true);
  PERFORM set_config('app.battle_vote_feedback_rpc', '1', true);
  PERFORM set_config('app.user_music_pref_rpc', '1', true);

  INSERT INTO public.battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, v_user_id, p_winner_producer_id)
  RETURNING id INTO v_vote_id;

  IF p_winner_producer_id = v_battle.producer1_id THEN
    UPDATE public.battles
    SET votes_producer1 = votes_producer1 + 1
    WHERE id = p_battle_id;
  ELSE
    UPDATE public.battles
    SET votes_producer2 = votes_producer2 + 1
    WHERE id = p_battle_id;
  END IF;

  INSERT INTO public.battle_vote_feedback (
    vote_id,
    battle_id,
    winner_product_id,
    user_id,
    criterion
  )
  SELECT
    v_vote_id,
    p_battle_id,
    v_winner_product_id,
    v_user_id,
    criterion
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (vote_id, criterion) DO NOTHING;

  GET DIAGNOSTICS v_feedback_count = ROW_COUNT;

  IF v_feedback_count = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  INSERT INTO public.user_music_preferences (
    user_id,
    criterion,
    score,
    updated_at
  )
  SELECT
    v_user_id,
    criterion,
    1,
    now()
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (user_id, criterion)
  DO UPDATE SET
    score = public.user_music_preferences.score + 1,
    updated_at = now();

  PERFORM public.log_fraud_event('battle_vote', v_user_id, p_battle_id, NULL);

  RETURN jsonb_build_object(
    'vote_id', v_vote_id,
    'battle_id', p_battle_id,
    'feedback_count', v_feedback_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_vote_with_feedback(uuid, uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_vote_with_feedback(uuid, uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_vote_with_feedback(uuid, uuid, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_vote_with_feedback(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_vote_with_feedback(uuid, uuid, text[]) TO service_role;

INSERT INTO public.rpc_rate_limit_rules (
  rpc_name,
  scope,
  allowed_per_minute,
  is_enabled
)
VALUES (
  'rpc_vote_with_feedback',
  'per_user',
  6,
  true
)
ON CONFLICT (rpc_name)
DO UPDATE SET
  scope = EXCLUDED.scope,
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) Legacy path lockdown: authenticated users must use the atomic RPC.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.record_battle_vote(uuid, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_submit_battle_vote_feedback(uuid, uuid, text[]) FROM authenticated;

COMMIT;
