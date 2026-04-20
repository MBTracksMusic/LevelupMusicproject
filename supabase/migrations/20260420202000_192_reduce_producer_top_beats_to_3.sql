BEGIN;

CREATE OR REPLACE VIEW public.producer_beats_ranked
WITH (security_invoker = true)
AS
WITH published_beats AS (
  SELECT
    p.id,
    p.producer_id,
    p.title,
    p.slug,
    p.cover_image_url,
    p.price,
    p.play_count,
    p.created_at,
    p.updated_at,
    COALESCE(p.status, 'active') AS status,
    COALESCE(p.is_published, false) AS is_published
  FROM public.products p
  WHERE p.product_type = 'beat'::public.product_type
    AND p.deleted_at IS NULL
    AND COALESCE(p.is_published, false) = true
    AND COALESCE(p.status, 'active') = 'active'
),
sales_by_product AS (
  SELECT
    pu.product_id,
    COUNT(*)::integer AS sales_count
  FROM public.purchases pu
  WHERE pu.status = 'completed'
  GROUP BY pu.product_id
),
battle_wins_by_product AS (
  SELECT
    winner_product_id AS product_id,
    COUNT(*)::integer AS battle_wins
  FROM (
    SELECT
      CASE
        WHEN b.winner_id = b.producer1_id THEN b.product1_id
        WHEN b.winner_id = b.producer2_id THEN b.product2_id
        ELSE NULL::uuid
      END AS winner_product_id
    FROM public.battles b
    WHERE b.status = 'completed'
      AND b.winner_id IS NOT NULL
  ) ranked_battles
  WHERE winner_product_id IS NOT NULL
  GROUP BY winner_product_id
),
scored AS (
  SELECT
    pb.id,
    pb.producer_id,
    pb.title,
    pb.slug,
    pb.cover_image_url,
    pb.price,
    pb.play_count,
    COALESCE(s.sales_count, 0) AS sales_count,
    COALESCE(w.battle_wins, 0) AS battle_wins,
    GREATEST(
      0,
      30 - FLOOR(EXTRACT(EPOCH FROM (now() - pb.created_at)) / 86400.0)::integer
    ) AS recency_bonus,
    (
      LEAST(COALESCE(pb.play_count, 0), 1000)
      + (COALESCE(s.sales_count, 0) * 25)
      + (COALESCE(w.battle_wins, 0) * 15)
      + GREATEST(
        0,
        30 - FLOOR(EXTRACT(EPOCH FROM (now() - pb.created_at)) / 86400.0)::integer
      )
    )::integer AS performance_score,
    (
      COALESCE(pb.play_count, 0)
      + COALESCE(s.sales_count, 0)
      + COALESCE(w.battle_wins, 0)
    )::integer AS engagement_count,
    pb.created_at,
    pb.updated_at
  FROM published_beats pb
  LEFT JOIN sales_by_product s ON s.product_id = pb.id
  LEFT JOIN battle_wins_by_product w ON w.product_id = pb.id
)
SELECT
  s.id,
  s.producer_id,
  s.title,
  s.slug,
  s.cover_image_url,
  s.price,
  s.play_count,
  s.sales_count,
  s.battle_wins,
  s.recency_bonus,
  s.performance_score,
  s.engagement_count,
  ROW_NUMBER() OVER (
    PARTITION BY s.producer_id
    ORDER BY s.performance_score DESC, s.sales_count DESC, s.battle_wins DESC, s.play_count DESC, s.created_at DESC, s.id ASC
  )::integer AS producer_rank,
  (
    s.engagement_count > 0
    AND ROW_NUMBER() OVER (
      PARTITION BY s.producer_id
      ORDER BY s.performance_score DESC, s.sales_count DESC, s.battle_wins DESC, s.play_count DESC, s.created_at DESC, s.id ASC
    ) <= 3
  ) AS top_10_flag,
  s.created_at,
  s.updated_at
FROM scored s;

CREATE OR REPLACE FUNCTION public.get_producer_top_beats(p_producer_id uuid)
RETURNS TABLE (
  id uuid,
  producer_id uuid,
  title text,
  slug text,
  cover_image_url text,
  price integer,
  play_count integer,
  sales_count integer,
  battle_wins integer,
  recency_bonus integer,
  performance_score integer,
  producer_rank integer,
  top_10_flag boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    pbr.id,
    pbr.producer_id,
    pbr.title,
    pbr.slug,
    pbr.cover_image_url,
    pbr.price,
    pbr.play_count,
    pbr.sales_count,
    pbr.battle_wins,
    pbr.recency_bonus,
    pbr.performance_score,
    pbr.producer_rank,
    pbr.top_10_flag,
    pbr.created_at
  FROM public.producer_beats_ranked pbr
  WHERE pbr.producer_id = p_producer_id
    AND pbr.top_10_flag = true
  ORDER BY pbr.performance_score DESC, pbr.producer_rank ASC, pbr.created_at DESC
  LIMIT 3
$$;

COMMIT;
