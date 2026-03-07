/*
  # Secure increment_play_count (V1 hardening)

  Goals:
  - Restrict RPC execution to authenticated/service roles only.
  - Keep products schema and existing products RLS policies unchanged.
  - Add server-side deduplication to reduce play count inflation.
  - Validate product visibility before incrementing.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.play_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  played_at timestamptz NOT NULL DEFAULT now(),
  dedupe_bucket timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_play_events_user_product
  ON public.play_events (user_id, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_play_events_user_product_bucket
  ON public.play_events (user_id, product_id, dedupe_bucket);

ALTER TABLE public.play_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own play events" ON public.play_events;
CREATE POLICY "Users can insert their own play events"
ON public.play_events
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read their own play events" ON public.play_events;
CREATE POLICY "Users can read their own play events"
ON public.play_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read all play events" ON public.play_events;
CREATE POLICY "Admins can read all play events"
ON public.play_events
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

REVOKE ALL ON TABLE public.play_events FROM PUBLIC;
REVOKE ALL ON TABLE public.play_events FROM anon;
REVOKE ALL ON TABLE public.play_events FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.play_events TO authenticated;
GRANT ALL ON TABLE public.play_events TO service_role;

DROP FUNCTION IF EXISTS public.increment_play_count(uuid);

CREATE FUNCTION public.increment_play_count(p_product_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bucket timestamptz := to_timestamp(floor(extract(epoch FROM now()) / 30) * 30);
  v_event_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.products p
  WHERE p.id = p_product_id
    AND p.deleted_at IS NULL
    AND p.status = 'active'
    AND (p.is_published IS DISTINCT FROM false)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.play_events (
    user_id,
    product_id,
    played_at,
    dedupe_bucket
  )
  VALUES (
    v_user_id,
    p_product_id,
    now(),
    v_bucket
  )
  ON CONFLICT (user_id, product_id, dedupe_bucket) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.products
  SET play_count = play_count + 1
  WHERE id = p_product_id
    AND deleted_at IS NULL
    AND status = 'active'
    AND (is_published IS DISTINCT FROM false);

  IF NOT FOUND THEN
    DELETE FROM public.play_events WHERE id = v_event_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_play_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_play_count(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.increment_play_count(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_play_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_play_count(uuid) TO service_role;

COMMIT;
