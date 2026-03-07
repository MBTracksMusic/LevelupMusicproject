/*
  # Fix admin beat feedback overview to include battles/products even without snapshots

  Goal:
  - Avoid empty admin analytics when no quality snapshot has been computed yet.
*/

BEGIN;

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

COMMIT;
