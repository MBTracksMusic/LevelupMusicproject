/*
  # Add configurable default battle duration via app_settings

  Additive migration:
  - creates public.app_settings with RLS policies
  - seeds battle_default_duration_days = 5
  - updates public.admin_validate_battle to use DB-configured duration only when voting_ends_at is NULL
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can insert app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update app settings" ON public.app_settings;

CREATE POLICY "Anyone can read app settings"
  ON public.app_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can insert app settings"
  ON public.app_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update app settings"
  ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.app_settings (key, value)
VALUES (
  'battle_default_duration_days',
  '{"days": 5}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_validate_battle(p_battle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_days integer;
  v_new_voting_ends_at timestamptz;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'awaiting_admin' THEN
    RAISE EXCEPTION 'battle_not_waiting_admin_validation';
  END IF;

  v_new_voting_ends_at := v_battle.voting_ends_at;

  IF v_battle.voting_ends_at IS NULL THEN
    SELECT COALESCE(
      (value->>'days')::int,
      5
    )
    INTO v_days
    FROM public.app_settings
    WHERE key = 'battle_default_duration_days';

    v_days := COALESCE(v_days, 5);

    v_new_voting_ends_at := now() + (v_days || ' days')::interval;
  END IF;

  UPDATE public.battles
  SET status = 'active',
      admin_validated_at = now(),
      starts_at = COALESCE(starts_at, now()),
      voting_ends_at = CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE voting_ends_at
      END,
      updated_at = now()
  WHERE id = p_battle_id;

  UPDATE public.user_profiles
  SET battles_participated = COALESCE(battles_participated, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_validate_battle(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_battle(uuid) TO service_role;

COMMIT;
