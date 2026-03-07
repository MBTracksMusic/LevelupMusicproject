/*
  # Battle quality snapshots + admin analytics views (secret)

  Goals:
  - Persist an internal quality snapshot per battle/product.
  - Expose admin-only analytics views for qualitative feedback.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.battle_quality_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  computed_at timestamptz NOT NULL DEFAULT now(),
  votes_total bigint NOT NULL DEFAULT 0,
  votes_for_product bigint NOT NULL DEFAULT 0,
  win_rate numeric(6,3) NOT NULL DEFAULT 0,
  preference_score numeric(6,3) NOT NULL DEFAULT 0,
  artistic_score numeric(6,3) NOT NULL DEFAULT 0,
  coherence_score numeric(6,3) NOT NULL DEFAULT 0,
  credibility_score numeric(6,3) NOT NULL DEFAULT 0,
  quality_index numeric(6,3) NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_quality_snapshots_unique_latest UNIQUE (battle_id, product_id),
  CONSTRAINT battle_quality_snapshots_non_negative_votes CHECK (
    votes_total >= 0
    AND votes_for_product >= 0
  ),
  CONSTRAINT battle_quality_snapshots_scores_range CHECK (
    win_rate BETWEEN 0 AND 100
    AND preference_score BETWEEN 0 AND 100
    AND artistic_score BETWEEN 0 AND 100
    AND coherence_score BETWEEN 0 AND 100
    AND credibility_score BETWEEN 0 AND 100
    AND quality_index BETWEEN 0 AND 100
  )
);

CREATE INDEX IF NOT EXISTS idx_battle_quality_snapshots_battle
  ON public.battle_quality_snapshots (battle_id);

CREATE INDEX IF NOT EXISTS idx_battle_quality_snapshots_product
  ON public.battle_quality_snapshots (product_id);

CREATE INDEX IF NOT EXISTS idx_battle_quality_snapshots_quality
  ON public.battle_quality_snapshots (quality_index DESC, computed_at DESC);

ALTER TABLE public.battle_quality_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read battle quality snapshots" ON public.battle_quality_snapshots;
CREATE POLICY "Admins can read battle quality snapshots"
ON public.battle_quality_snapshots
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert battle quality snapshots via RPC only" ON public.battle_quality_snapshots;
CREATE POLICY "Admins can insert battle quality snapshots via RPC only"
ON public.battle_quality_snapshots
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin(auth.uid())
  AND current_setting('app.battle_quality_snapshot_rpc', true) = '1'
);

DROP POLICY IF EXISTS "Admins can update battle quality snapshots via RPC only" ON public.battle_quality_snapshots;
CREATE POLICY "Admins can update battle quality snapshots via RPC only"
ON public.battle_quality_snapshots
FOR UPDATE
TO authenticated
USING (
  public.is_admin(auth.uid())
  AND current_setting('app.battle_quality_snapshot_rpc', true) = '1'
)
WITH CHECK (
  public.is_admin(auth.uid())
  AND current_setting('app.battle_quality_snapshot_rpc', true) = '1'
);

REVOKE ALL ON TABLE public.battle_quality_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_quality_snapshots FROM anon;
REVOKE ALL ON TABLE public.battle_quality_snapshots FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.battle_quality_snapshots TO authenticated;
GRANT ALL ON TABLE public.battle_quality_snapshots TO service_role;

DO $$
BEGIN
  IF to_regproc('public.update_updated_at_column()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'update_battle_quality_snapshots_updated_at'
         AND tgrelid = 'public.battle_quality_snapshots'::regclass
         AND NOT tgisinternal
     ) THEN
    DROP TRIGGER IF EXISTS update_battle_quality_snapshots_updated_at ON public.battle_quality_snapshots;
    CREATE TRIGGER update_battle_quality_snapshots_updated_at
      BEFORE UPDATE ON public.battle_quality_snapshots
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE OR REPLACE VIEW public.admin_beat_feedback_top_criteria
WITH (security_invoker = true)
AS
SELECT
  agg.winner_product_id AS product_id,
  agg.criterion,
  agg.criterion_count,
  ROW_NUMBER() OVER (
    PARTITION BY agg.winner_product_id
    ORDER BY agg.criterion_count DESC, agg.criterion ASC
  )::integer AS rank
FROM (
  SELECT
    bf.winner_product_id,
    bf.criterion,
    COUNT(*)::bigint AS criterion_count
  FROM public.battle_vote_feedback bf
  GROUP BY bf.winner_product_id, bf.criterion
) agg;

CREATE OR REPLACE VIEW public.admin_beat_feedback_scores
WITH (security_invoker = true)
AS
WITH base AS (
  SELECT
    bf.winner_product_id AS product_id,
    bf.criterion,
    COUNT(*)::bigint AS criterion_count
  FROM public.battle_vote_feedback bf
  GROUP BY bf.winner_product_id, bf.criterion
),
score_counts AS (
  SELECT
    b.product_id,
    COALESCE(SUM(b.criterion_count), 0)::bigint AS total_feedback,
    COALESCE(SUM(b.criterion_count) FILTER (WHERE b.criterion IN ('groove', 'energy')), 0)::bigint AS structure_raw,
    COALESCE(SUM(b.criterion_count) FILTER (WHERE b.criterion IN ('melody', 'ambience')), 0)::bigint AS melody_raw,
    COALESCE(SUM(b.criterion_count) FILTER (WHERE b.criterion IN ('groove', 'drums', 'energy')), 0)::bigint AS rhythm_raw,
    COALESCE(SUM(b.criterion_count) FILTER (WHERE b.criterion IN ('sound_design')), 0)::bigint AS sound_design_raw,
    COALESCE(SUM(b.criterion_count) FILTER (WHERE b.criterion IN ('mix')), 0)::bigint AS mix_raw,
    COALESCE(SUM(b.criterion_count) FILTER (WHERE b.criterion IN ('originality', 'artistic_vibe')), 0)::bigint AS identity_raw
  FROM base b
  GROUP BY b.product_id
)
SELECT
  s.product_id,
  s.total_feedback,
  CASE WHEN s.total_feedback > 0 THEN ROUND((s.structure_raw::numeric / s.total_feedback::numeric) * 100, 2) ELSE 0 END AS structure_score,
  CASE WHEN s.total_feedback > 0 THEN ROUND((s.melody_raw::numeric / s.total_feedback::numeric) * 100, 2) ELSE 0 END AS melody_score,
  CASE WHEN s.total_feedback > 0 THEN ROUND((s.rhythm_raw::numeric / s.total_feedback::numeric) * 100, 2) ELSE 0 END AS rhythm_score,
  CASE WHEN s.total_feedback > 0 THEN ROUND((s.sound_design_raw::numeric / s.total_feedback::numeric) * 100, 2) ELSE 0 END AS sound_design_score,
  CASE WHEN s.total_feedback > 0 THEN ROUND((s.mix_raw::numeric / s.total_feedback::numeric) * 100, 2) ELSE 0 END AS mix_score,
  CASE WHEN s.total_feedback > 0 THEN ROUND((s.identity_raw::numeric / s.total_feedback::numeric) * 100, 2) ELSE 0 END AS identity_score
FROM score_counts s;

CREATE OR REPLACE VIEW public.admin_battle_quality_latest
WITH (security_invoker = true)
AS
SELECT
  bqs.battle_id,
  b.slug AS battle_slug,
  b.title AS battle_title,
  b.status AS battle_status,
  bqs.product_id,
  p.title AS product_title,
  p.producer_id,
  ppp.username AS producer_username,
  bqs.votes_total,
  bqs.votes_for_product,
  bqs.win_rate,
  bqs.preference_score,
  bqs.artistic_score,
  bqs.coherence_score,
  bqs.credibility_score,
  bqs.quality_index,
  bqs.meta,
  bqs.computed_at,
  bqs.updated_at
FROM public.battle_quality_snapshots bqs
JOIN public.battles b ON b.id = bqs.battle_id
JOIN public.products p ON p.id = bqs.product_id
LEFT JOIN public.public_producer_profiles ppp ON ppp.user_id = p.producer_id;

REVOKE ALL ON TABLE public.admin_beat_feedback_top_criteria FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_beat_feedback_top_criteria FROM anon;
REVOKE ALL ON TABLE public.admin_beat_feedback_top_criteria FROM authenticated;
GRANT SELECT ON TABLE public.admin_beat_feedback_top_criteria TO authenticated;
GRANT SELECT ON TABLE public.admin_beat_feedback_top_criteria TO service_role;

REVOKE ALL ON TABLE public.admin_beat_feedback_scores FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_beat_feedback_scores FROM anon;
REVOKE ALL ON TABLE public.admin_beat_feedback_scores FROM authenticated;
GRANT SELECT ON TABLE public.admin_beat_feedback_scores TO authenticated;
GRANT SELECT ON TABLE public.admin_beat_feedback_scores TO service_role;

REVOKE ALL ON TABLE public.admin_battle_quality_latest FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_battle_quality_latest FROM anon;
REVOKE ALL ON TABLE public.admin_battle_quality_latest FROM authenticated;
GRANT SELECT ON TABLE public.admin_battle_quality_latest TO authenticated;
GRANT SELECT ON TABLE public.admin_battle_quality_latest TO service_role;

COMMIT;
