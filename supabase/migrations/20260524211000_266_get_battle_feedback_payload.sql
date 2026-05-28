-- Migration 266 — Phase 1 (Stats dashboard)
-- Public RPC consumed by /battles/:slug/feedback page.
-- Returns a single jsonb payload with: battle metadata, snapshots (with
-- producer info), top criteria, ranking, viewer-specific vote info, meta.
--
-- Design notes:
--   * SECURITY DEFINER: this RPC is called by anon + authenticated users for
--     a strictly public surface (completed battles only). It bypasses RLS so
--     it can join battle_vote_feedback / user_profiles without exposing them
--     broadly. The function gates access by checking battles.status = 'completed'
--     before returning anything substantive.
--   * Privacy guard for viewer block: p_viewer_id is accepted for API
--     stability, but the lookup uses auth.uid() — never p_viewer_id directly.
--     This prevents an attacker from probing "did user X vote on battle Y?"
--     by passing arbitrary uuids.
--   * battle_tier is hardcoded to 'standard' here. Migration 267 will add the
--     real column and CREATE OR REPLACE this function to read it.
--   * Scores are returned on a 0-100 scale (confirmed in rpc_compute body).
--   * meta.coherence_data_sufficient = (total_feedback >= 5), matches the
--     compute function's hard cutoff that sets coherence_score=0 below 5.
--   * meta.weights is NOT exposed (gaming risk + implementation detail).
--   * STABLE: read-only, idempotent.

CREATE OR REPLACE FUNCTION public.get_battle_feedback_payload(
  p_battle_id uuid,
  p_viewer_id uuid DEFAULT NULL  -- accepted for API stability; lookup uses auth.uid()
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

  -- Snapshots with producer info; rank assigned by quality_index desc.
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

  -- Top 3 criteria across the whole battle (regardless of which product won the vote).
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

  -- Compact ranking projection (same ordering as snapshots).
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

  -- Viewer block. Uses auth.uid() for the lookup, not p_viewer_id (privacy guard).
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
      'battle_tier', 'standard'::text,
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

-- Public dashboard: anon + authenticated may call. Revoke from the noisy
-- PUBLIC pseudo-role and grant explicitly to the API roles.
REVOKE ALL ON FUNCTION public.get_battle_feedback_payload(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_battle_feedback_payload(uuid, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_battle_feedback_payload(uuid, uuid) IS
  'Phase 1 stats dashboard payload. Returns jsonb {battle, snapshots, top_criteria, ranking, viewer, meta} or {error,...}. Public for completed battles. Viewer lookup uses auth.uid() — p_viewer_id parameter is for API stability only and is not used for lookup.';
