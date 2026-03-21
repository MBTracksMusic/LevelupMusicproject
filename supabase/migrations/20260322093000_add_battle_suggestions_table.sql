BEGIN;

CREATE TABLE IF NOT EXISTS public.battle_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  requester_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  candidate_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  suggestion_source text NOT NULL CHECK (suggestion_source IN ('ai', 'fallback_sql')),
  model_name text,
  rank_position integer NOT NULL CHECK (rank_position > 0),
  score numeric(6,2),
  reason text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz,
  ignored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_battle_suggestions_requester_created
  ON public.battle_suggestions (requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_battle_suggestions_request
  ON public.battle_suggestions (request_id, rank_position ASC);

CREATE INDEX IF NOT EXISTS idx_battle_suggestions_candidate
  ON public.battle_suggestions (candidate_user_id, created_at DESC);

ALTER TABLE public.battle_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own battle suggestions" ON public.battle_suggestions;
CREATE POLICY "Users can read own battle suggestions"
ON public.battle_suggestions
FOR SELECT
TO authenticated
USING (requester_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own battle suggestion feedback" ON public.battle_suggestions;
CREATE POLICY "Users can update own battle suggestion feedback"
ON public.battle_suggestions
FOR UPDATE
TO authenticated
USING (requester_id = auth.uid())
WITH CHECK (requester_id = auth.uid());

REVOKE ALL ON TABLE public.battle_suggestions FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_suggestions FROM anon;
GRANT SELECT, UPDATE ON TABLE public.battle_suggestions TO authenticated;
GRANT ALL ON TABLE public.battle_suggestions TO service_role;

COMMIT;
