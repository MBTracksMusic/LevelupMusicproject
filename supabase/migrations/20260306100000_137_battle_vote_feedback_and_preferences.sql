/*
  # Battle vote feedback + user music preferences (additive)

  Goals:
  - Store optional qualitative feedback after a successful battle vote.
  - Keep write access RPC-only with transaction flags.
  - Build per-user preference counters from submitted criteria.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.battle_vote_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id uuid NOT NULL REFERENCES public.battle_votes(id) ON DELETE CASCADE,
  battle_id uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  winner_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  criterion text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_vote_feedback_vote_criterion_key UNIQUE (vote_id, criterion),
  CONSTRAINT battle_vote_feedback_criterion_check CHECK (
    criterion IN (
      'groove',
      'melody',
      'ambience',
      'sound_design',
      'drums',
      'mix',
      'originality',
      'energy',
      'artistic_vibe'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_battle_vote_feedback_winner_product
  ON public.battle_vote_feedback (winner_product_id);

CREATE INDEX IF NOT EXISTS idx_battle_vote_feedback_battle
  ON public.battle_vote_feedback (battle_id);

CREATE INDEX IF NOT EXISTS idx_battle_vote_feedback_criterion
  ON public.battle_vote_feedback (criterion);

CREATE INDEX IF NOT EXISTS idx_battle_vote_feedback_product_criterion
  ON public.battle_vote_feedback (winner_product_id, criterion);

ALTER TABLE public.battle_vote_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read battle vote feedback" ON public.battle_vote_feedback;
CREATE POLICY "Admins can read battle vote feedback"
ON public.battle_vote_feedback
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can submit battle vote feedback via RPC only" ON public.battle_vote_feedback;
CREATE POLICY "Users can submit battle vote feedback via RPC only"
ON public.battle_vote_feedback
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND current_setting('app.battle_vote_feedback_rpc', true) = '1'
  AND criterion IN (
    'groove',
    'melody',
    'ambience',
    'sound_design',
    'drums',
    'mix',
    'originality',
    'energy',
    'artistic_vibe'
  )
);

REVOKE ALL ON TABLE public.battle_vote_feedback FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_vote_feedback FROM anon;
REVOKE ALL ON TABLE public.battle_vote_feedback FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.battle_vote_feedback TO authenticated;
GRANT ALL ON TABLE public.battle_vote_feedback TO service_role;

CREATE TABLE IF NOT EXISTS public.user_music_preferences (
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  criterion text NOT NULL,
  score bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, criterion),
  CONSTRAINT user_music_preferences_criterion_check CHECK (
    criterion IN (
      'groove',
      'melody',
      'ambience',
      'sound_design',
      'drums',
      'mix',
      'originality',
      'energy',
      'artistic_vibe'
    )
  ),
  CONSTRAINT user_music_preferences_score_check CHECK (score >= 0)
);

CREATE INDEX IF NOT EXISTS idx_user_music_preferences_user
  ON public.user_music_preferences (user_id);

CREATE INDEX IF NOT EXISTS idx_user_music_preferences_criterion
  ON public.user_music_preferences (criterion);

ALTER TABLE public.user_music_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or admin can read music preferences" ON public.user_music_preferences;
CREATE POLICY "Owner or admin can read music preferences"
ON public.user_music_preferences
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS "Users can insert music preferences via RPC only" ON public.user_music_preferences;
CREATE POLICY "Users can insert music preferences via RPC only"
ON public.user_music_preferences
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND score >= 0
  AND current_setting('app.user_music_pref_rpc', true) = '1'
  AND criterion IN (
    'groove',
    'melody',
    'ambience',
    'sound_design',
    'drums',
    'mix',
    'originality',
    'energy',
    'artistic_vibe'
  )
);

DROP POLICY IF EXISTS "Users can update music preferences via RPC only" ON public.user_music_preferences;
CREATE POLICY "Users can update music preferences via RPC only"
ON public.user_music_preferences
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND current_setting('app.user_music_pref_rpc', true) = '1'
)
WITH CHECK (
  user_id = auth.uid()
  AND score >= 0
  AND current_setting('app.user_music_pref_rpc', true) = '1'
  AND criterion IN (
    'groove',
    'melody',
    'ambience',
    'sound_design',
    'drums',
    'mix',
    'originality',
    'energy',
    'artistic_vibe'
  )
);

REVOKE ALL ON TABLE public.user_music_preferences FROM PUBLIC;
REVOKE ALL ON TABLE public.user_music_preferences FROM anon;
REVOKE ALL ON TABLE public.user_music_preferences FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_music_preferences TO authenticated;
GRANT ALL ON TABLE public.user_music_preferences TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_submit_battle_vote_feedback(
  p_battle_id uuid,
  p_winner_producer_id uuid,
  p_criteria text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_vote public.battle_votes%ROWTYPE;
  v_battle public.battles%ROWTYPE;
  v_winner_product_id uuid;
  v_raw_criteria text[] := COALESCE(p_criteria, ARRAY[]::text[]);
  v_criteria text[];
  v_invalid_criteria text[];
  v_inserted_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_battle_id IS NULL OR p_winner_producer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_feedback_payload';
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

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_submit_battle_vote_feedback') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT *
  INTO v_vote
  FROM public.battle_votes
  WHERE battle_id = p_battle_id
    AND user_id = v_user_id
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vote_not_found';
  END IF;

  IF v_vote.voted_for_producer_id IS DISTINCT FROM p_winner_producer_id THEN
    RAISE EXCEPTION 'feedback_winner_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_vote_feedback bvf
    WHERE bvf.vote_id = v_vote.id
  ) THEN
    RAISE EXCEPTION 'feedback_already_submitted';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF p_winner_producer_id = v_battle.producer1_id THEN
    v_winner_product_id := v_battle.product1_id;
  ELSIF p_winner_producer_id = v_battle.producer2_id THEN
    v_winner_product_id := v_battle.product2_id;
  ELSE
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_winner_product_id IS NULL THEN
    RAISE EXCEPTION 'winner_product_not_found';
  END IF;

  PERFORM set_config('app.battle_vote_feedback_rpc', '1', true);
  PERFORM set_config('app.user_music_pref_rpc', '1', true);

  INSERT INTO public.battle_vote_feedback (
    vote_id,
    battle_id,
    winner_product_id,
    user_id,
    criterion
  )
  SELECT
    v_vote.id,
    p_battle_id,
    v_winner_product_id,
    v_user_id,
    criterion
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (vote_id, criterion) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

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

  RETURN v_inserted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_battle_vote_feedback(uuid, uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_submit_battle_vote_feedback(uuid, uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_submit_battle_vote_feedback(uuid, uuid, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_submit_battle_vote_feedback(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_submit_battle_vote_feedback(uuid, uuid, text[]) TO service_role;

INSERT INTO public.rpc_rate_limit_rules (
  rpc_name,
  scope,
  allowed_per_minute,
  is_enabled
)
VALUES (
  'rpc_submit_battle_vote_feedback',
  'per_user',
  20,
  true
)
ON CONFLICT (rpc_name)
DO UPDATE SET
  scope = EXCLUDED.scope,
  allowed_per_minute = EXCLUDED.allowed_per_minute,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

COMMIT;
