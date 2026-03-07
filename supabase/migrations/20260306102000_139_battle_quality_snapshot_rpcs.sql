/*
  # Battle quality snapshot RPCs (admin only)

  Goals:
  - Compute and upsert quality snapshots per battle/product.
  - Provide a single admin RPC to fetch analytics overview.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_compute_battle_quality_snapshot(
  p_battle_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_battle public.battles%ROWTYPE;
  v_alpha numeric := 2;
  v_beta numeric := 2;
  v_rows integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_user_id)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_battle_id IS NULL THEN
    RAISE EXCEPTION 'battle_required';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  PERFORM set_config('app.battle_quality_snapshot_rpc', '1', true);

  WITH products_to_score AS (
    SELECT v_battle.product1_id AS product_id, 1 AS slot
    WHERE v_battle.product1_id IS NOT NULL

    UNION ALL

    SELECT v_battle.product2_id AS product_id, 2 AS slot
    WHERE v_battle.product2_id IS NOT NULL
  ),
  metrics AS (
    SELECT
      pts.product_id,
      (COALESCE(v_battle.votes_producer1, 0) + COALESCE(v_battle.votes_producer2, 0))::bigint AS votes_total,
      CASE
        WHEN pts.slot = 1 THEN COALESCE(v_battle.votes_producer1, 0)::bigint
        ELSE COALESCE(v_battle.votes_producer2, 0)::bigint
      END AS votes_for_product,
      COALESCE(fe.total_feedback, 0)::bigint AS total_feedback,
      COALESCE(fe.top_share, 0::numeric) AS top_share,
      COALESCE(fe.weighted_share, 0::numeric) AS weighted_share
    FROM products_to_score pts
    LEFT JOIN LATERAL (
      WITH grouped_feedback AS (
        SELECT
          bf.criterion,
          COUNT(*)::numeric AS criterion_count
        FROM public.battle_vote_feedback bf
        WHERE bf.battle_id = p_battle_id
          AND bf.winner_product_id = pts.product_id
        GROUP BY bf.criterion
      ),
      agg AS (
        SELECT
          COALESCE(SUM(gf.criterion_count), 0::numeric) AS total_feedback,
          COALESCE(MAX(gf.criterion_count), 0::numeric) AS top_feedback,
          COALESCE(SUM(
            gf.criterion_count * CASE gf.criterion
              WHEN 'originality' THEN 1.3
              WHEN 'artistic_vibe' THEN 1.3
              WHEN 'melody' THEN 1.2
              WHEN 'ambience' THEN 1.2
              WHEN 'groove' THEN 1.0
              WHEN 'drums' THEN 1.0
              WHEN 'energy' THEN 1.0
              WHEN 'mix' THEN 0.9
              WHEN 'sound_design' THEN 0.9
              ELSE 1.0
            END
          ), 0::numeric) AS weighted_count
        FROM grouped_feedback gf
      )
      SELECT
        agg.total_feedback,
        CASE
          WHEN agg.total_feedback > 0 THEN agg.top_feedback / agg.total_feedback
          ELSE 0::numeric
        END AS top_share,
        CASE
          WHEN agg.total_feedback > 0 THEN LEAST(1::numeric, agg.weighted_count / (agg.total_feedback * 1.3))
          ELSE 0::numeric
        END AS weighted_share
      FROM agg
    ) fe ON true
  ),
  scores AS (
    SELECT
      m.product_id,
      m.votes_total,
      m.votes_for_product,
      CASE
        WHEN m.votes_total > 0 THEN ROUND((m.votes_for_product::numeric / m.votes_total::numeric) * 100, 3)
        ELSE 0::numeric
      END AS win_rate,
      ROUND(((m.votes_for_product::numeric + v_alpha) / (m.votes_total::numeric + v_alpha + v_beta)) * 100, 3) AS preference_score,
      ROUND(m.weighted_share * 100, 3) AS artistic_score,
      ROUND(
        CASE
          WHEN m.total_feedback < 5 THEN 0::numeric
          ELSE LEAST(1::numeric, m.top_share / 0.35) * 100
        END,
        3
      ) AS coherence_score,
      50::numeric AS credibility_score,
      m.total_feedback,
      m.top_share,
      m.weighted_share
    FROM metrics m
  ),
  upserted AS (
    INSERT INTO public.battle_quality_snapshots (
      battle_id,
      product_id,
      computed_at,
      votes_total,
      votes_for_product,
      win_rate,
      preference_score,
      artistic_score,
      coherence_score,
      credibility_score,
      quality_index,
      meta,
      created_at,
      updated_at
    )
    SELECT
      p_battle_id,
      s.product_id,
      now(),
      s.votes_total,
      s.votes_for_product,
      s.win_rate,
      s.preference_score,
      s.artistic_score,
      s.coherence_score,
      s.credibility_score,
      ROUND(
        (0.45 * s.preference_score)
        + (0.30 * s.artistic_score)
        + (0.15 * s.coherence_score)
        + (0.10 * s.credibility_score),
        3
      ) AS quality_index,
      jsonb_build_object(
        'alpha', v_alpha,
        'beta', v_beta,
        'total_feedback', s.total_feedback,
        'top_share', s.top_share,
        'weighted_share', s.weighted_share,
        'weights', jsonb_build_object(
          'preference', 0.45,
          'artistic', 0.30,
          'coherence', 0.15,
          'credibility', 0.10
        )
      ),
      now(),
      now()
    FROM scores s
    ON CONFLICT (battle_id, product_id)
    DO UPDATE SET
      computed_at = EXCLUDED.computed_at,
      votes_total = EXCLUDED.votes_total,
      votes_for_product = EXCLUDED.votes_for_product,
      win_rate = EXCLUDED.win_rate,
      preference_score = EXCLUDED.preference_score,
      artistic_score = EXCLUDED.artistic_score,
      coherence_score = EXCLUDED.coherence_score,
      credibility_score = EXCLUDED.credibility_score,
      quality_index = EXCLUDED.quality_index,
      meta = EXCLUDED.meta,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rows FROM upserted;

  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_compute_battle_quality_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_compute_battle_quality_snapshot(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_compute_battle_quality_snapshot(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_compute_battle_quality_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_compute_battle_quality_snapshot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_admin_get_beat_feedback_overview(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_battle_id uuid DEFAULT NULL
)
RETURNS TABLE (
  battle_id uuid,
  battle_slug text,
  battle_title text,
  battle_status public.battle_status,
  product_id uuid,
  product_title text,
  producer_id uuid,
  producer_username text,
  quality_index numeric,
  preference_score numeric,
  artistic_score numeric,
  coherence_score numeric,
  credibility_score numeric,
  votes_total bigint,
  votes_for_product bigint,
  win_rate numeric,
  total_feedback bigint,
  top_criteria jsonb,
  structure_score numeric,
  melody_score numeric,
  rhythm_score numeric,
  sound_design_score numeric,
  mix_score numeric,
  identity_score numeric,
  computed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_user_id)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
  WITH candidate_products AS (
    SELECT
      b.id AS battle_id,
      b.slug AS battle_slug,
      b.title AS battle_title,
      b.status AS battle_status,
      cp.slot,
      cp.product_id,
      p.title AS product_title,
      p.producer_id,
      ppp.username AS producer_username,
      COALESCE(b.votes_producer1, 0)::bigint AS votes_producer1,
      COALESCE(b.votes_producer2, 0)::bigint AS votes_producer2,
      b.updated_at AS battle_updated_at
    FROM public.battles b
    JOIN LATERAL (
      VALUES
        (1, b.product1_id),
        (2, b.product2_id)
    ) AS cp(slot, product_id)
      ON cp.product_id IS NOT NULL
    JOIN public.products p
      ON p.id = cp.product_id
    LEFT JOIN public.public_producer_profiles ppp
      ON ppp.user_id = p.producer_id
    WHERE p_battle_id IS NULL OR b.id = p_battle_id
  ),
  joined AS (
    SELECT
      cp.*,
      qs.quality_index,
      qs.preference_score,
      qs.artistic_score,
      qs.coherence_score,
      qs.credibility_score,
      qs.votes_total,
      qs.votes_for_product,
      qs.win_rate,
      qs.computed_at
    FROM candidate_products cp
    LEFT JOIN public.battle_quality_snapshots qs
      ON qs.battle_id = cp.battle_id
     AND qs.product_id = cp.product_id
  )
  SELECT
    j.battle_id,
    j.battle_slug,
    j.battle_title,
    j.battle_status,
    j.product_id,
    j.product_title,
    j.producer_id,
    j.producer_username,
    COALESCE(j.quality_index, 0::numeric) AS quality_index,
    COALESCE(j.preference_score, 0::numeric) AS preference_score,
    COALESCE(j.artistic_score, 0::numeric) AS artistic_score,
    COALESCE(j.coherence_score, 0::numeric) AS coherence_score,
    COALESCE(j.credibility_score, 0::numeric) AS credibility_score,
    COALESCE(j.votes_total, (j.votes_producer1 + j.votes_producer2))::bigint AS votes_total,
    COALESCE(
      j.votes_for_product,
      CASE WHEN j.slot = 1 THEN j.votes_producer1 ELSE j.votes_producer2 END
    )::bigint AS votes_for_product,
    COALESCE(
      j.win_rate,
      CASE
        WHEN (j.votes_producer1 + j.votes_producer2) > 0 THEN
          ROUND(
            (
              (CASE WHEN j.slot = 1 THEN j.votes_producer1 ELSE j.votes_producer2 END)::numeric
              / (j.votes_producer1 + j.votes_producer2)::numeric
            ) * 100,
            3
          )
        ELSE 0::numeric
      END
    ) AS win_rate,
    COALESCE(s.total_feedback, 0)::bigint AS total_feedback,
    COALESCE(tc.top_criteria, '[]'::jsonb) AS top_criteria,
    COALESCE(s.structure_score, 0::numeric) AS structure_score,
    COALESCE(s.melody_score, 0::numeric) AS melody_score,
    COALESCE(s.rhythm_score, 0::numeric) AS rhythm_score,
    COALESCE(s.sound_design_score, 0::numeric) AS sound_design_score,
    COALESCE(s.mix_score, 0::numeric) AS mix_score,
    COALESCE(s.identity_score, 0::numeric) AS identity_score,
    COALESCE(j.computed_at, j.battle_updated_at) AS computed_at
  FROM joined j
  LEFT JOIN public.admin_beat_feedback_scores s
    ON s.product_id = j.product_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'criterion', c.criterion,
        'count', c.criterion_count,
        'rank', c.rank
      )
      ORDER BY c.rank ASC
    ) AS top_criteria
    FROM public.admin_beat_feedback_top_criteria c
    WHERE c.product_id = j.product_id
      AND c.rank <= 6
  ) tc ON true
  ORDER BY COALESCE(j.quality_index, 0::numeric) DESC, COALESCE(j.computed_at, j.battle_updated_at) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_beat_feedback_overview(integer, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_beat_feedback_overview(integer, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_beat_feedback_overview(integer, integer, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_beat_feedback_overview(integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_beat_feedback_overview(integer, integer, uuid) TO service_role;

COMMIT;
