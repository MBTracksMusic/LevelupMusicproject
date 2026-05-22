-- Switch products.play_count source of truth from user_interactions to play_events.
-- The increment_play_count RPC (migration 141) is the canonical writer: it enforces
-- authentication, runs the 30s dedupe bucket, and updates products.play_count atomically.
-- The user_interactions trigger added in 20260522220000 conflicts with that RPC and is removed.

-- 1. Remove the redundant trigger and its function
DROP TRIGGER IF EXISTS user_interactions_increment_play_count
  ON public.user_interactions;
DROP FUNCTION IF EXISTS public.tg_user_interactions_increment_play_count();

-- 2. Backfill play_events from prior authenticated 'play' interactions.
-- Each (user_id, product_id, 30s bucket) combination becomes one play_events row.
-- ON CONFLICT DO NOTHING is defensive in case the table was partially populated.
INSERT INTO public.play_events (user_id, product_id, played_at, dedupe_bucket)
SELECT ui.user_id,
       ui.beat_id,
       MIN(ui.created_at) AS played_at,
       to_timestamp(floor(extract(epoch FROM ui.created_at) / 30) * 30) AS bucket
FROM public.user_interactions ui
JOIN public.user_profiles up ON up.id = ui.user_id
WHERE ui.action_type = 'play'
  AND ui.user_id IS NOT NULL
GROUP BY ui.user_id, ui.beat_id, bucket
ON CONFLICT (user_id, product_id, dedupe_bucket) DO NOTHING;

-- 3. Reset products.play_count to match play_events. This recounts from the canonical
-- source so the displayed counter agrees with what the RPC will continue to bump.
UPDATE public.products p
SET play_count = COALESCE(pe.play_total, 0)
FROM (
  SELECT product_id, COUNT(*)::int AS play_total
  FROM public.play_events
  GROUP BY product_id
) pe
WHERE p.id = pe.product_id;

-- Zero out any product that had a count but no play_events (anonymous-only plays)
UPDATE public.products
SET play_count = 0
WHERE play_count > 0
  AND id NOT IN (SELECT DISTINCT product_id FROM public.play_events);
