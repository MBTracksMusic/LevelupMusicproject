BEGIN;

-- DROP + CREATE to handle return type mismatch with existing function
DROP FUNCTION IF EXISTS public.get_producer_top_beats(uuid);

CREATE FUNCTION public.get_producer_top_beats(p_producer_id uuid)
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
