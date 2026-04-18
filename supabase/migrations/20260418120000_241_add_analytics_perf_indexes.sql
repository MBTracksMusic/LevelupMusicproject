-- Composite index for analytics queries: WHERE status = 'completed' ORDER BY created_at DESC
-- Replaces the planner having to combine idx_purchases_status + idx_purchases_created separately
CREATE INDEX IF NOT EXISTS idx_purchases_status_created_at
  ON public.purchases (status, created_at DESC);

-- Index for play_events ordered by played_at (used by getProductPerformance)
CREATE INDEX IF NOT EXISTS idx_play_events_played_at
  ON public.play_events (played_at DESC);

-- Composite index for per-product play aggregation
CREATE INDEX IF NOT EXISTS idx_play_events_product_played_at
  ON public.play_events (product_id, played_at DESC);
