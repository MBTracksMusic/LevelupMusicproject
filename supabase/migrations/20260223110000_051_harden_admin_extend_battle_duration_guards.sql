/*
  # Harden admin_extend_battle_duration safeguards (additive)

  Additive changes only:
  - Adds battles.extension_count (if missing)
  - Adds extra guardrails to public.admin_extend_battle_duration:
    - rejects already-expired battles
    - enforces max 60 days total from starts_at
    - enforces max 5 extensions per battle
    - logs extension_count_after in ai_decision

  Existing RPC signatures and finalize/vote logic remain unchanged.
*/

BEGIN;

ALTER TABLE public.battles
ADD COLUMN IF NOT EXISTS extension_count integer DEFAULT 0;

UPDATE public.battles
SET extension_count = 0
WHERE extension_count IS NULL;

CREATE OR REPLACE FUNCTION public.admin_extend_battle_duration(
  p_battle_id uuid,
  p_days integer,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_before_voting_ends_at timestamptz;
  v_after_voting_ends_at timestamptz;
  v_reason_text text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_extension_count integer := 0;
  v_extension_count_after integer := 0;
  v_limit_anchor timestamptz;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RAISE EXCEPTION 'invalid_extension_days';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status NOT IN ('active', 'voting') THEN
    RAISE EXCEPTION 'battle_not_open_for_extension';
  END IF;

  IF v_battle.voting_ends_at IS NULL THEN
    RAISE EXCEPTION 'battle_has_no_voting_end';
  END IF;

  IF v_battle.voting_ends_at <= now() THEN
    RAISE EXCEPTION 'battle_already_expired';
  END IF;

  v_extension_count := COALESCE(v_battle.extension_count, 0);
  IF v_extension_count >= 5 THEN
    RAISE EXCEPTION 'maximum_extensions_reached';
  END IF;

  v_before_voting_ends_at := v_battle.voting_ends_at;
  v_after_voting_ends_at := v_before_voting_ends_at + (p_days || ' days')::interval;

  v_limit_anchor := COALESCE(v_battle.starts_at, now());
  IF v_after_voting_ends_at > (v_limit_anchor + interval '60 days') THEN
    RAISE EXCEPTION 'battle_extension_limit_exceeded';
  END IF;

  UPDATE public.battles
  SET voting_ends_at = v_after_voting_ends_at,
      extension_count = COALESCE(extension_count, 0) + 1,
      updated_at = now()
  WHERE id = p_battle_id
  RETURNING extension_count INTO v_extension_count_after;

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    executed_at,
    executed_by
  )
  VALUES (
    'battle_duration_extended',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'before_voting_ends_at', v_before_voting_ends_at,
      'after_voting_ends_at', v_after_voting_ends_at,
      'days_added', p_days,
      'extension_count_after', v_extension_count_after,
      'actor', v_actor,
      'reason_text', v_reason_text
    ),
    1.0,
    'Battle duration extended by admin',
    'executed',
    now(),
    v_actor
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_battle_duration(uuid, integer, text) TO service_role;

COMMIT;
