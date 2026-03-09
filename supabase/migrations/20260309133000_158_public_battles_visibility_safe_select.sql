/*
  # Public battles visibility (safe incremental)

  Goals:
  - Keep battle pages visible for visitors without opening sensitive tables.
  - Extend public battle read statuses to include official battle lifecycle states.
  - Keep pending/private negotiation states hidden.
*/

BEGIN;

ALTER TABLE public.battles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view public battles" ON public.battles;
CREATE POLICY "Anyone can view public battles"
  ON public.battles
  FOR SELECT
  USING (
    status IN ('active', 'voting', 'completed', 'awaiting_admin', 'approved')
  );

-- Align homepage battles preview with the same public statuses (no pending_acceptance exposure).
CREATE OR REPLACE FUNCTION public.get_public_home_battles_preview(p_limit integer DEFAULT 3)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  status public.battle_status,
  producer1_id uuid,
  producer1_username text,
  producer2_id uuid,
  producer2_username text,
  votes_producer1 integer,
  votes_producer2 integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.id,
    b.title,
    b.slug,
    b.status,
    b.producer1_id,
    public.get_public_profile_label(up1) AS producer1_username,
    b.producer2_id,
    public.get_public_profile_label(up2) AS producer2_username,
    COALESCE(b.votes_producer1, 0) AS votes_producer1,
    COALESCE(b.votes_producer2, 0) AS votes_producer2,
    b.created_at
  FROM public.battles b
  LEFT JOIN public.user_profiles up1 ON up1.id = b.producer1_id
  LEFT JOIN public.user_profiles up2 ON up2.id = b.producer2_id
  WHERE b.status IN ('active', 'voting', 'completed', 'awaiting_admin', 'approved')
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 12);
$$;

COMMENT ON FUNCTION public.get_public_home_battles_preview(integer)
IS 'Public-safe battles preview feed for homepage discovery (excluding pending/private states).';

REVOKE ALL ON FUNCTION public.get_public_home_battles_preview(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_battles_preview(integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_home_battles_preview(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_home_battles_preview(integer) TO service_role;

COMMIT;
