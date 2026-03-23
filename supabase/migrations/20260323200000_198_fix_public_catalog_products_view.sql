/*
  # Fix public_catalog_products view - restore data visibility

  Issue: WHERE clause filtering beats by early_access_until
  Solution: Simplified WHERE for published products only
*/

BEGIN;

DROP VIEW IF EXISTS public.public_catalog_products CASCADE;

DO $$
DECLARE
  has_watermarked_path boolean;
  has_watermark_profile_id boolean;
  watermarked_path_expr text;
  watermark_profile_expr text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'watermarked_path'
  ) INTO has_watermarked_path;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'watermark_profile_id'
  ) INTO has_watermark_profile_id;

  watermarked_path_expr := CASE
    WHEN has_watermarked_path THEN 'p.watermarked_path AS watermarked_path'
    ELSE 'NULL::text AS watermarked_path'
  END;

  watermark_profile_expr := CASE
    WHEN has_watermark_profile_id THEN 'p.watermark_profile_id AS watermark_profile_id'
    ELSE 'NULL::uuid AS watermark_profile_id'
  END;

  EXECUTE format($view$
    CREATE VIEW public.public_catalog_products
    WITH (security_invoker = false)
    AS
    SELECT
      p.id, p.producer_id, p.title, p.slug, p.description, p.product_type,
      p.genre_id, g.name AS genre_name, g.name_en AS genre_name_en,
      g.name_de AS genre_name_de, g.slug AS genre_slug,
      p.mood_id, m.name AS mood_name, m.name_en AS mood_name_en,
      m.name_de AS mood_name_de, m.slug AS mood_slug,
      p.bpm, p.key_signature, p.price,
      %s, p.watermarked_bucket, p.preview_url, p.exclusive_preview_url,
      p.cover_image_url, p.is_exclusive, p.is_sold, p.sold_at,
      CASE WHEN auth.role() = 'service_role' THEN p.sold_to_user_id ELSE NULL::uuid END AS sold_to_user_id,
      p.is_published, p.status, p.version, p.original_beat_id, p.version_number,
      p.parent_product_id, p.archived_at, p.play_count, p.tags, p.duration_seconds,
      p.file_format, p.license_terms,
      %s, p.created_at, p.updated_at, p.deleted_at,
      pp.username AS producer_username, pp.raw_username AS producer_raw_username,
      pp.avatar_url AS producer_avatar_url, COALESCE(pp.is_producer_active, false) AS producer_is_active,
      COALESCE(pbr.sales_count, 0) AS sales_count, pbr.sales_tier,
      COALESCE(pbr.battle_wins, 0) AS battle_wins, COALESCE(pbr.recency_bonus, 0) AS recency_bonus,
      COALESCE(pbr.performance_score, 0) AS performance_score, pbr.producer_rank,
      COALESCE(pbr.top_10_flag, false) AS top_10_flag
    FROM public.products p
    LEFT JOIN public.public_producer_profiles pp ON pp.user_id = p.producer_id
    LEFT JOIN public.genres g ON g.id = p.genre_id
    LEFT JOIN public.moods m ON m.id = p.mood_id
    LEFT JOIN public.producer_beats_ranked pbr ON pbr.id = p.id
    WHERE p.deleted_at IS NULL AND COALESCE(p.is_published, false) = true
  $view$, watermarked_path_expr, watermark_profile_expr);
END
$$;

GRANT SELECT ON TABLE public.public_catalog_products TO anon, authenticated, service_role;

COMMIT;
