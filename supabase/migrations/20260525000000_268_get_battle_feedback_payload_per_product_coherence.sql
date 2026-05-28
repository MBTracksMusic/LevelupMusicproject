-- Migration 268 — Phase 1 (Stats dashboard) — per-product coherence sufficiency
--
-- Context: the coherence score is suppressed to 0 per-product when that product
-- received fewer than 5 feedback rows. The previous RPC exposed only a
-- battle-global `meta.coherence_data_sufficient` flag, which produced a false
-- negative: a battle could be globally sufficient (say producer1=16 feedbacks)
-- while producer2 (with 4 feedbacks) still had coherence_score=0 — and the UI
-- had no signal to warn the viewer that producer2's coherence is unreliable.
--
-- Staging proof (fixture phase1-fixture-1-victoire-crasante):
--   producer1: total_feedback=16, coherence_score=100.0
--   producer2: total_feedback=4,  coherence_score=0.0  ← legitimate cutoff
--
-- This migration adds `coherence_data_sufficient` to each snapshot object in
-- the RPC payload, derived from each snapshot's own meta.total_feedback. The
-- battle-global flag is retained on the meta block for backward compatibility.
--
-- Identical to 267 except for two added lines (one in CTE, one in jsonb_build_object).

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
      -- Per-product coherence sufficiency derived from snapshot meta.
      -- meta.total_feedback is the count of feedback rows *for this product*
      -- (votes_for_product). The 5-row threshold mirrors the compute logic in
      -- private.compute_battle_quality_snapshot.
      (COALESCE((bqs.meta->>'total_feedback')::int, 0) >= 5) AS coherence_data_sufficient,
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
      'coherence_data_sufficient', r.coherence_data_sufficient,
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
      'winner_product_id',
        CASE
          WHEN v_battle.winner_id IS NULL THEN NULL
          WHEN v_battle.winner_id = v_battle.producer1_id THEN v_battle.product1_id
          WHEN v_battle.winner_id = v_battle.producer2_id THEN v_battle.product2_id
          ELSE NULL
        END,
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
