-- Migration 267 — Phase 1 (Stats dashboard) — battle_tier column
-- Adds a tier classification on battles. Decision D-7 was upgraded from a
-- boolean is_final flag to a 4-value enum text column so we don't need a
-- second refactor in Phase 4 when we want richer routing.
--
-- Routing intent (NOT enforced here; just documented for Phase 2-4 builders):
--   standard     → Growth Report auto email (Phase 2)
--   featured     → Curated queue (Phase 3)
--   final        → Curated + optional Signature (Phase 3-4)
--   title_match  → Curated + Signature priority (Phase 4)
--
-- Migration is DDL-only (column + index + comment) PLUS a non-destructive
-- CREATE OR REPLACE of get_battle_feedback_payload so it reads the real
-- battle_tier column instead of the 'standard'::text placeholder from 266.
--
-- Backward compat: existing battles get 'standard' via the DEFAULT, so the
-- column is effectively NOT NULL for all historical rows (no backfill step
-- needed). New rows inherit the default.
--
-- Index: partial index on rows where battle_tier <> 'standard'. The vast
-- majority of battles will stay 'standard', so a full index would be wasteful.
-- The partial index efficiently serves admin queries like "show all featured
-- battles" or "all finals in this season".

ALTER TABLE public.battles
  ADD COLUMN battle_tier text NOT NULL DEFAULT 'standard'
    CHECK (battle_tier IN ('standard', 'featured', 'final', 'title_match'));

CREATE INDEX idx_battles_tier ON public.battles (battle_tier)
  WHERE battle_tier <> 'standard';

COMMENT ON COLUMN public.battles.battle_tier IS
'Battle tier for feedback system routing:
- standard: regular battle → Growth Report auto (Phase 2)
- featured: highlighted battle (homepage, etc.) → Curated queue (Phase 3)
- final: season/cycle finale → Curated + optional Signature (Phase 3-4)
- title_match: high-stakes battle (elite ranking, prize pool) → Curated + Signature priority';

-- Replace get_battle_feedback_payload so it reads the real column.
-- This is a byte-for-byte copy of the 266 body except for ONE line:
--   'battle_tier', 'standard'::text   →   'battle_tier', v_battle.battle_tier
CREATE OR REPLACE FUNCTION public.get_battle_feedback_payload(
  p_battle_id uuid,
  p_viewer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_battle public.battles%ROWTYPE;
  v_authed_uid uuid := auth.uid();
  v_total_feedback int := 0;
  v_total_voters int := 0;
  v_battle_size text;
  v_coherence_sufficient boolean;
  v_snapshots jsonb;
  v_top_criteria jsonb;
  v_ranking jsonb;
  v_viewer jsonb;
  v_meta jsonb;
BEGIN
  IF p_battle_id IS NULL THEN
    RETURN jsonb_build_object('error', 'battle_required');
  END IF;

  SELECT * INTO v_battle FROM public.battles WHERE id = p_battle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'battle_not_found');
  END IF;

  IF v_battle.status::text <> 'completed' THEN
    RETURN jsonb_build_object(
      'error', 'not_finalized',
      'status', v_battle.status::text
    );
  END IF;

  v_total_voters := COALESCE(v_battle.votes_producer1, 0) + COALESCE(v_battle.votes_producer2, 0);

  SELECT COUNT(*)::int INTO v_total_feedback
  FROM public.battle_vote_feedback
  WHERE battle_id = p_battle_id;

  v_battle_size := CASE
    WHEN v_total_voters < 10 THEN 'small'
    WHEN v_total_voters < 50 THEN 'medium'
    ELSE 'large'
  END;

  v_coherence_sufficient := v_total_feedback >= 5;

  WITH ranked AS (
    SELECT
      bqs.product_id,
      bqs.votes_total,
      bqs.votes_for_product,
      bqs.win_rate,
      bqs.preference_score,
      bqs.artistic_score,
      bqs.coherence_score,
      bqs.credibility_score,
      bqs.quality_index,
      bqs.computed_at,
      ROW_NUMBER() OVER (
        ORDER BY bqs.quality_index DESC NULLS LAST, bqs.product_id
      ) AS rank
    FROM public.battle_quality_snapshots bqs
    WHERE bqs.battle_id = p_battle_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', r.product_id,
      'producer', jsonb_build_object(
        'id', up.id,
        'display_name', COALESCE(up.username, up.full_name),
        'avatar_url', up.avatar_url
      ),
      'votes_total', r.votes_total,
      'votes_for_product', r.votes_for_product,
      'win_rate', r.win_rate,
      'scores', jsonb_build_object(
        'artistic', r.artistic_score,
        'coherence', r.coherence_score,
        'credibility', r.credibility_score,
        'preference', r.preference_score
      ),
      'quality_index', r.quality_index,
      'computed_at', r.computed_at,
      'rank', r.rank
    ) ORDER BY r.rank
  )
  INTO v_snapshots
  FROM ranked r
  LEFT JOIN public.products p ON p.id = r.product_id
  LEFT JOIN public.user_profiles up ON up.id = p.producer_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'criterion_key', c.criterion,
      'count', c.cnt,
      'share', CASE
        WHEN v_total_feedback > 0 THEN ROUND(c.cnt::numeric / v_total_feedback, 4)
        ELSE 0::numeric
      END
    ) ORDER BY c.cnt DESC
  ), '[]'::jsonb)
  INTO v_top_criteria
  FROM (
    SELECT criterion, COUNT(*)::int AS cnt
    FROM public.battle_vote_feedback
    WHERE battle_id = p_battle_id
    GROUP BY criterion
    ORDER BY COUNT(*) DESC
    LIMIT 3
  ) c;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'product_id', r.product_id,
      'rank', r.rank,
      'quality_index', r.quality_index
    ) ORDER BY r.rank
  ), '[]'::jsonb)
  INTO v_ranking
  FROM (
    SELECT
      product_id,
      quality_index,
      ROW_NUMBER() OVER (
        ORDER BY quality_index DESC NULLS LAST, product_id
      ) AS rank
    FROM public.battle_quality_snapshots
    WHERE battle_id = p_battle_id
  ) r;

  IF v_authed_uid IS NULL THEN
    v_viewer := jsonb_build_object(
      'is_authenticated', false,
      'voted', false,
      'vote', null::jsonb
    );
  ELSE
    WITH vf AS (
      SELECT criterion, winner_product_id
      FROM public.battle_vote_feedback
      WHERE battle_id = p_battle_id
        AND user_id = v_authed_uid
    )
    SELECT
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM vf) THEN
          jsonb_build_object(
            'is_authenticated', true,
            'voted', false,
            'vote', null::jsonb
          )
        ELSE
          jsonb_build_object(
            'is_authenticated', true,
            'voted', true,
            'vote', jsonb_build_object(
              'criteria', (SELECT jsonb_agg(DISTINCT criterion) FROM vf),
              'preferred_product_id', (SELECT winner_product_id FROM vf LIMIT 1)
            )
          )
      END
    INTO v_viewer;
  END IF;

  v_meta := jsonb_build_object(
    'total_feedback', v_total_feedback,
    'total_voters', v_total_voters,
    'battle_size', v_battle_size,
    'coherence_data_sufficient', v_coherence_sufficient,
    'credibility_dynamic', false
  );

  RETURN jsonb_build_object(
    'battle', jsonb_build_object(
      'id', v_battle.id,
      'slug', v_battle.slug,
      'title', v_battle.title,
      'status', v_battle.status::text,
      'battle_tier', v_battle.battle_tier,
      -- winner_product_id: the product the winning producer submitted.
      -- NULL when the battle is a tie or unresolved. Front uses this as the
      -- authoritative source for "who won" instead of inferring from win_rate.
      'winner_product_id',
        CASE
          WHEN v_battle.winner_id IS NULL THEN NULL
          WHEN v_battle.winner_id = v_battle.producer1_id THEN v_battle.product1_id
          WHEN v_battle.winner_id = v_battle.producer2_id THEN v_battle.product2_id
          ELSE NULL
        END,
      -- is_tie: true only when the battle is completed but has no winner.
      -- Gating on status='completed' avoids false positives on unresolved battles.
      'is_tie', (v_battle.winner_id IS NULL AND v_battle.status::text = 'completed'),
      'finalized_at', v_battle.voting_ends_at,
      'voting_started_at', v_battle.starts_at,
      'voting_ended_at', v_battle.voting_ends_at,
      'voting_duration_seconds',
        CASE
          WHEN v_battle.voting_ends_at IS NOT NULL AND v_battle.starts_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (v_battle.voting_ends_at - v_battle.starts_at))::int
          ELSE NULL
        END
    ),
    'snapshots', COALESCE(v_snapshots, '[]'::jsonb),
    'top_criteria', v_top_criteria,
    'ranking', v_ranking,
    'viewer', v_viewer,
    'meta', v_meta
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_battle_feedback_payload(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_battle_feedback_payload(uuid, uuid) TO anon, authenticated;
