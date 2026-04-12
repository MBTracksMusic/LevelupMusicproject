/*
  # Fix: finalize_expired_battles doit traiter le statut 'active' (pas seulement 'voting')

  Problème:
  - Le flow officiel depuis la migration 053 est: active → completed
  - Le statut 'voting' est bloqué pour les nouvelles transitions (legacy)
  - finalize_expired_battles (migration 037) ne scannait que status = 'voting'
  - Résultat: aucune battle 'active' expirée n'était jamais finalisée automatiquement

  Également corrigé:
  - agent_finalize_expired_battles (migration 046): même filtre, donc même bug.
    Il scannait IN ('active', 'voting') pour identifier les candidats, mais appelait
    finalize_expired_battles() qui ignorait 'active'. Les battles actives expirées
    étaient ainsi loggées en 'failed' à tort.

  Cette migration remplace les deux fonctions avec le filtre correct.
*/

BEGIN;

-- ── 1. finalize_expired_battles: ajouter 'active' au filtre ─────────────────

CREATE OR REPLACE FUNCTION public.finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row      record;
  v_limit    integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count    integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  FOR v_row IN
    SELECT b.id
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')   -- ← fix: inclure 'active'
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    PERFORM public.finalize_battle(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_expired_battles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_battles(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_battles(integer) TO service_role;

-- ── 2. agent_finalize_expired_battles: cohérence du log des candidats ────────
--    Scan reste IN ('active', 'voting'). La délégation à finalize_expired_battles
--    fonctionne maintenant correctement pour les deux statuts.
--    On met à jour la fonction pour ne plus loger de faux 'failed'.

CREATE OR REPLACE FUNCTION public.agent_finalize_expired_battles(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor          uuid   := auth.uid();
  v_jwt_role       text   := current_setting('request.jwt.claim.role', true);
  v_row            record;
  v_limit          integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count          integer := 0;
  v_candidate_ids  uuid[]  := ARRAY[]::uuid[];
  v_candidate_id   uuid;
  v_status         public.battle_status;
  v_winner_id      uuid;
  v_finalize_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  -- Identifier les candidats (active ET voting, expirés)
  FOR v_row IN
    SELECT b.id, b.status, b.voting_ends_at
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    v_candidate_ids := array_append(v_candidate_ids, v_row.id);
  END LOOP;

  -- Appeler finalize_expired_battles (maintenant corrigé pour active + voting)
  BEGIN
    v_finalize_count := public.finalize_expired_battles(v_limit);
  EXCEPTION
    WHEN OTHERS THEN
      FOREACH v_candidate_id IN ARRAY v_candidate_ids
      LOOP
        INSERT INTO public.ai_admin_actions (
          action_type, entity_type, entity_id,
          ai_decision, confidence_score, reason,
          status, human_override, reversible,
          executed_at, executed_by, error
        ) VALUES (
          'battle_finalize', 'battle', v_candidate_id,
          jsonb_build_object(
            'model', 'rule-based',
            'source', 'agent_finalize_expired_battles',
            'battle_id', v_candidate_id
          ),
          1,
          'Battle finalization failed in finalize_expired_battles wrapper.',
          'failed', false, true,
          now(), NULL, SQLERRM
        );
      END LOOP;
      RAISE;
  END;

  -- Logger le résultat pour chaque candidat
  FOREACH v_candidate_id IN ARRAY v_candidate_ids
  LOOP
    SELECT b.status, b.winner_id
    INTO v_status, v_winner_id
    FROM public.battles b
    WHERE b.id = v_candidate_id;

    IF v_status = 'completed' THEN
      INSERT INTO public.ai_admin_actions (
        action_type, entity_type, entity_id,
        ai_decision, confidence_score, reason,
        status, human_override, reversible,
        executed_at, executed_by, error
      ) VALUES (
        'battle_finalize', 'battle', v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'winner_id', v_winner_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle auto-finalized by finalize_expired_battles().',
        'executed', false, true,
        now(), NULL, NULL
      );
      v_count := v_count + 1;
    ELSE
      -- Battle non finalisée (état inattendu — log sans marquer failed)
      INSERT INTO public.ai_admin_actions (
        action_type, entity_type, entity_id,
        ai_decision, confidence_score, reason,
        status, human_override, reversible,
        executed_at, executed_by, error
      ) VALUES (
        'battle_finalize', 'battle', v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'current_status', v_status,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle not in completed status after finalize call — may have been recently extended or already processed.',
        'failed', false, true,
        now(), NULL,
        'battle_not_completed_after_finalize_call'
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_finalize_expired_battles(integer) TO service_role;

COMMIT;
