/*
  # Hide elite beats from the public catalog

  Problem:
  - Marking a beat as elite/private in admin left it visible in public discovery.
  - The leak came from public SQL sources, not just frontend rendering:
    - public.producer_beats_ranked
    - public.public_catalog_products
    - public.get_public_home_featured_beats()

  Goal:
  - Keep elite beats visible only in the private Elite Hub.
  - Preserve the public marketplace behavior for non-elite products.
*/

BEGIN;

CREATE OR REPLACE VIEW public.producer_beats_ranked
WITH (security_invoker = false)
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
    AND COALESCE(p.is_elite, false) = false
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
    ranked_battles.winner_product_id AS product_id,
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
  WHERE ranked_battles.winner_product_id IS NOT NULL
  GROUP BY ranked_battles.winner_product_id
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
    public.compute_sales_tier(COALESCE(s.sales_count, 0)) AS sales_tier,
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
    ) AS performance_score,
    (
      COALESCE(pb.play_count, 0)
      + COALESCE(s.sales_count, 0)
      + COALESCE(w.battle_wins, 0)
    ) AS engagement_count,
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
  s.sales_tier,
  s.battle_wins,
  s.recency_bonus,
  s.performance_score,
  s.engagement_count,
  (ROW_NUMBER() OVER (
    PARTITION BY s.producer_id
    ORDER BY s.performance_score DESC, s.sales_count DESC, s.battle_wins DESC, s.play_count DESC, s.created_at DESC, s.id
  ))::integer AS producer_rank,
  (
    s.engagement_count > 0
    AND ROW_NUMBER() OVER (
      PARTITION BY s.producer_id
      ORDER BY s.performance_score DESC, s.sales_count DESC, s.battle_wins DESC, s.play_count DESC, s.created_at DESC, s.id
    ) <= 10
  ) AS top_10_flag,
  s.created_at,
  s.updated_at
FROM scored s;

COMMENT ON VIEW public.producer_beats_ranked
IS 'Public-safe ranked beats. Elite beats are excluded from public discovery and ranking.';

REVOKE ALL ON TABLE public.producer_beats_ranked FROM PUBLIC;
REVOKE ALL ON TABLE public.producer_beats_ranked FROM anon;
REVOKE ALL ON TABLE public.producer_beats_ranked FROM authenticated;
GRANT SELECT ON TABLE public.producer_beats_ranked TO anon;
GRANT SELECT ON TABLE public.producer_beats_ranked TO authenticated;
GRANT SELECT ON TABLE public.producer_beats_ranked TO service_role;

CREATE OR REPLACE VIEW public.public_catalog_products
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.producer_id,
  p.title,
  p.slug,
  p.description,
  p.product_type,
  p.genre_id,
  g.name AS genre_name,
  g.name_en AS genre_name_en,
  g.name_de AS genre_name_de,
  g.slug AS genre_slug,
  p.mood_id,
  m.name AS mood_name,
  m.name_en AS mood_name_en,
  m.name_de AS mood_name_de,
  m.slug AS mood_slug,
  p.bpm,
  p.key_signature,
  p.price,
  p.watermarked_path,
  p.watermarked_bucket,
  p.preview_url,
  p.exclusive_preview_url,
  p.cover_image_url,
  p.is_exclusive,
  p.is_sold,
  p.sold_at,
  CASE
    WHEN auth.role() = 'service_role' THEN p.sold_to_user_id
    ELSE NULL::uuid
  END AS sold_to_user_id,
  p.is_published,
  p.status,
  p.version,
  p.original_beat_id,
  p.version_number,
  p.parent_product_id,
  p.archived_at,
  p.play_count,
  p.tags,
  p.duration_seconds,
  p.file_format,
  p.license_terms,
  p.watermark_profile_id,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  pp.username AS producer_username,
  pp.raw_username AS producer_raw_username,
  pp.avatar_url AS producer_avatar_url,
  COALESCE(pp.is_producer_active, false) AS producer_is_active,
  COALESCE(pbr.sales_count, 0) AS sales_count,
  COALESCE(pbr.battle_wins, 0) AS battle_wins,
  COALESCE(pbr.recency_bonus, 0) AS recency_bonus,
  COALESCE(pbr.performance_score, 0) AS performance_score,
  pbr.producer_rank,
  COALESCE(pbr.top_10_flag, false) AS top_10_flag,
  p.early_access_until
FROM public.products p
LEFT JOIN public.public_producer_profiles pp ON pp.user_id = p.producer_id
LEFT JOIN public.genres g ON g.id = p.genre_id
LEFT JOIN public.moods m ON m.id = p.mood_id
LEFT JOIN public.producer_beats_ranked pbr ON pbr.id = p.id
WHERE p.deleted_at IS NULL
  AND COALESCE(p.is_published, false) = true
  AND COALESCE(p.is_elite, false) = false
  AND (
    p.product_type <> 'beat'::public.product_type
    OR p.early_access_until IS NULL
    OR p.early_access_until <= now()
    OR public.user_has_active_buyer_subscription(auth.uid())
  );

COMMENT ON VIEW public.public_catalog_products
IS 'Public-safe catalog view. Elite beats are excluded from the public marketplace.';

REVOKE ALL ON TABLE public.public_catalog_products FROM PUBLIC;
REVOKE ALL ON TABLE public.public_catalog_products FROM anon;
REVOKE ALL ON TABLE public.public_catalog_products FROM authenticated;
GRANT SELECT ON TABLE public.public_catalog_products TO anon;
GRANT SELECT ON TABLE public.public_catalog_products TO authenticated;
GRANT SELECT ON TABLE public.public_catalog_products TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_home_featured_beats(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  price integer,
  play_count integer,
  cover_image_url text,
  is_sold boolean,
  producer_id uuid,
  producer_username text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.title,
    p.slug,
    p.price,
    COALESCE(p.play_count, 0) AS play_count,
    p.cover_image_url,
    COALESCE(p.is_sold, false) AS is_sold,
    p.producer_id,
    public.get_public_profile_label(up) AS producer_username
  FROM public.products p
  LEFT JOIN public.user_profiles up ON up.id = p.producer_id
  LEFT JOIN public.producer_beats_ranked pbr ON pbr.id = p.id
  WHERE p.product_type = 'beat'
    AND p.deleted_at IS NULL
    AND p.status = 'active'
    AND COALESCE(p.is_published, false) = true
    AND COALESCE(p.is_elite, false) = false
  ORDER BY
    CASE WHEN COALESCE(pbr.top_10_flag, false) THEN 0 ELSE 1 END ASC,
    COALESCE(pbr.performance_score, 0) DESC,
    COALESCE(p.play_count, 0) DESC,
    p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 24);
$$;

COMMENT ON FUNCTION public.get_public_home_featured_beats(integer)
IS 'Public-safe featured beats feed for homepage discovery. Elite beats are excluded.';

REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_home_featured_beats(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_featured_beats(integer) TO service_role;

COMMIT;
