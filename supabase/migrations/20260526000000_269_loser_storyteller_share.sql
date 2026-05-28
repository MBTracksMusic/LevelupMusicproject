-- Migration 269 - Storyteller share after battle
--
-- Adds the backend surface for autonomous post-battle sharing by the producer
-- who did not win: share analytics, idempotent XP award, and a read RPC for
-- the frontend modal / OG pipeline.

BEGIN;

-- enabled_from=NULL keeps XP blocked until the feature is activated manually;
-- share events are still logged for QA and analytics before activation.
INSERT INTO public.app_settings (key, value)
VALUES (
  'storyteller_share_config',
  jsonb_build_object(
    'enabled_from',
    NULL,
    'xp',
    15
  )
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.reputation_rules (
  key,
  source,
  event_type,
  delta_xp,
  cooldown_sec,
  max_per_day,
  is_enabled
)
VALUES (
  'storyteller_share',
  -- source='battles' aligned with existing engine: battle_xp credits
  -- only trigger when source='battles' (cf. credit_xp function)
  'battles',
  'battle_share_after_loss',
  15,
  0,
  NULL,
  true
)
ON CONFLICT (key) DO UPDATE
SET source = EXCLUDED.source,
    event_type = EXCLUDED.event_type,
    delta_xp = EXCLUDED.delta_xp,
    cooldown_sec = EXCLUDED.cooldown_sec,
    max_per_day = EXCLUDED.max_per_day,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.battle_share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  share_channel text NOT NULL,
  template_used text NOT NULL,
  xp_applied boolean NOT NULL DEFAULT false,
  xp_delta integer NOT NULL DEFAULT 0,
  reputation_event_id uuid NULL REFERENCES public.reputation_events(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_share_events_share_channel_check CHECK (
    share_channel IN ('x', 'facebook', 'linkedin', 'whatsapp', 'copy')
  ),
  CONSTRAINT battle_share_events_template_used_check CHECK (
    template_used IN ('neutral', 'traits', 'comeback')
  ),
  CONSTRAINT battle_share_events_xp_delta_check CHECK (xp_delta >= 0)
);

CREATE INDEX IF NOT EXISTS idx_battle_share_events_battle_created
  ON public.battle_share_events (battle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_battle_share_events_producer_created
  ON public.battle_share_events (producer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_battle_share_events_channel_created
  ON public.battle_share_events (share_channel, created_at DESC);

ALTER TABLE public.battle_share_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Battle share events readable by owner or admin" ON public.battle_share_events;
CREATE POLICY "Battle share events readable by owner or admin"
ON public.battle_share_events
FOR SELECT
TO authenticated
USING (
  producer_id = auth.uid()
  OR public.is_admin(auth.uid())
);

REVOKE ALL ON TABLE public.battle_share_events FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_share_events FROM anon;
REVOKE ALL ON TABLE public.battle_share_events FROM authenticated;
GRANT SELECT ON TABLE public.battle_share_events TO authenticated;
GRANT ALL ON TABLE public.battle_share_events TO service_role;

CREATE OR REPLACE FUNCTION public.get_loser_share_data(p_battle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_battle public.battles%ROWTYPE;
  v_loser_id uuid;
  v_loser_product_id uuid;
  v_loser_name text;
  v_loser_slug text;
  v_opponent_id uuid;
  v_opponent_name text;
  v_opponent_slug text;
  v_top_traits jsonb := '[]'::jsonb;
  v_is_service_role boolean := false;
BEGIN
  IF p_battle_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'battle_required'
    );
  END IF;

  v_is_service_role := v_jwt_role = 'service_role';

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'battle_not_found'
    );
  END IF;

  IF v_battle.status::text <> 'completed' THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'battle_not_completed',
      'status', v_battle.status::text
    );
  END IF;

  IF v_battle.winner_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'battle_has_no_winner'
    );
  END IF;

  IF v_battle.producer2_id IS NULL
     OR v_battle.winner_id NOT IN (v_battle.producer1_id, v_battle.producer2_id) THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'battle_participants_invalid'
    );
  END IF;

  IF v_battle.winner_id = v_battle.producer1_id THEN
    v_loser_id := v_battle.producer2_id;
    v_loser_product_id := v_battle.product2_id;
    v_opponent_id := v_battle.producer1_id;
  ELSE
    v_loser_id := v_battle.producer1_id;
    v_loser_product_id := v_battle.product1_id;
    v_opponent_id := v_battle.producer2_id;
  END IF;

  IF v_loser_product_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'loser_product_not_found'
    );
  END IF;

  IF NOT v_is_service_role AND (v_actor IS NULL OR v_actor <> v_loser_id) THEN
    RETURN jsonb_build_object(
      'is_loser_role', false,
      'error', 'loser_role_required'
    );
  END IF;

  SELECT
    COALESCE(NULLIF(btrim(up.username), ''), NULLIF(btrim(up.full_name), ''), 'Producteur Beatelion'),
    NULLIF(btrim(up.username), '')
  INTO v_loser_name, v_loser_slug
  FROM public.user_profiles up
  WHERE up.id = v_loser_id;

  v_loser_name := COALESCE(v_loser_name, 'Producteur Beatelion');

  SELECT
    COALESCE(NULLIF(btrim(up.username), ''), NULLIF(btrim(up.full_name), ''), 'Producteur Beatelion'),
    NULLIF(btrim(up.username), '')
  INTO v_opponent_name, v_opponent_slug
  FROM public.user_profiles up
  WHERE up.id = v_opponent_id;

  v_opponent_name := COALESCE(v_opponent_name, 'Producteur Beatelion');

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'criterion_key', ranked.criterion,
      'count', ranked.vote_count
    )
    ORDER BY ranked.vote_count DESC, ranked.criterion
  ), '[]'::jsonb)
  INTO v_top_traits
  FROM (
    SELECT
      bvf.criterion,
      COUNT(*)::int AS vote_count
    FROM public.battle_vote_feedback bvf
    WHERE bvf.battle_id = p_battle_id
      AND bvf.winner_product_id = v_loser_product_id
    GROUP BY bvf.criterion
    ORDER BY COUNT(*) DESC, bvf.criterion
    LIMIT 3
  ) ranked;

  RETURN jsonb_build_object(
    'battle_id', v_battle.id,
    'battle_slug', v_battle.slug,
    'producer_id', v_loser_id,
    'producer_name', v_loser_name,
    'producer_slug', v_loser_slug,
    'opponent_id', v_opponent_id,
    'opponent_name', v_opponent_name,
    'opponent_slug', v_opponent_slug,
    'top_traits', v_top_traits,
    'share_url',
      'https://www.beatelion.com/share/battle/'
      || v_battle.slug
      || '/feedback?is_loser_card=true&producer_id='
      || v_loser_id::text,
    'is_loser_role', true
  );
END;
$function$;

COMMENT ON FUNCTION public.get_loser_share_data(uuid) IS
  'Returns producer-scoped share data for the non-winning participant of a completed battle. Service-role access is kept for OG image generation.';

CREATE OR REPLACE FUNCTION public.record_loser_battle_share(
  p_battle_id uuid,
  p_share_channel text,
  p_template_used text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_loser_id uuid;
  v_loser_product_id uuid;
  v_normalized_channel text := lower(NULLIF(btrim(COALESCE(p_share_channel, '')), ''));
  v_normalized_template text := lower(NULLIF(btrim(COALESCE(p_template_used, '')), ''));
  v_feature_enabled_from timestamptz;
  v_share_event_id uuid;
  v_idempotency_key text;
  v_reputation record;
  v_reputation_event_id uuid := NULL;
  v_xp_delta integer := 0;
  v_xp_applied boolean := false;
  v_skipped_reason text := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_battle_id IS NULL THEN
    RAISE EXCEPTION 'battle_required';
  END IF;

  IF v_normalized_channel IS NULL
     OR v_normalized_channel NOT IN ('x', 'facebook', 'linkedin', 'whatsapp', 'copy') THEN
    RAISE EXCEPTION 'invalid_share_channel';
  END IF;

  IF v_normalized_template IS NULL
     OR v_normalized_template NOT IN ('neutral', 'traits', 'comeback') THEN
    RAISE EXCEPTION 'invalid_share_template';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status::text <> 'completed' THEN
    RAISE EXCEPTION 'battle_not_completed';
  END IF;

  IF v_battle.winner_id IS NULL THEN
    RAISE EXCEPTION 'battle_has_no_winner';
  END IF;

  IF v_battle.producer2_id IS NULL
     OR v_battle.winner_id NOT IN (v_battle.producer1_id, v_battle.producer2_id) THEN
    RAISE EXCEPTION 'battle_participants_invalid';
  END IF;

  IF v_battle.winner_id = v_battle.producer1_id THEN
    v_loser_id := v_battle.producer2_id;
    v_loser_product_id := v_battle.product2_id;
  ELSE
    v_loser_id := v_battle.producer1_id;
    v_loser_product_id := v_battle.product1_id;
  END IF;

  IF v_actor <> v_loser_id THEN
    RAISE EXCEPTION 'loser_role_required';
  END IF;

  SELECT NULLIF(value->>'enabled_from', '')::timestamptz
  INTO v_feature_enabled_from
  FROM public.app_settings
  WHERE key = 'storyteller_share_config';

  v_feature_enabled_from := COALESCE(v_feature_enabled_from, now());

  INSERT INTO public.battle_share_events (
    battle_id,
    producer_id,
    share_channel,
    template_used,
    metadata
  )
  VALUES (
    p_battle_id,
    v_actor,
    v_normalized_channel,
    v_normalized_template,
    jsonb_build_object(
      'loser_product_id', v_loser_product_id,
      'winner_id', v_battle.winner_id,
      'feature_enabled_from', v_feature_enabled_from
    )
  )
  RETURNING id INTO v_share_event_id;

  IF v_battle.created_at <= v_feature_enabled_from THEN
    v_skipped_reason := 'battle_before_storyteller_share_launch';
  ELSE
    v_idempotency_key := 'storyteller_share:' || p_battle_id::text || ':' || v_actor::text;

    PERFORM pg_advisory_xact_lock(hashtext(v_idempotency_key));

    SELECT *
    INTO v_reputation
    FROM public.apply_reputation_event_internal(
      p_user_id => v_actor,
      p_source => 'battles',
      p_event_type => 'battle_share_after_loss',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_delta => NULL,
      p_metadata => jsonb_build_object(
        'share_event_id', v_share_event_id,
        'share_channel', v_normalized_channel,
        'template_used', v_normalized_template
      ),
      p_idempotency_key => v_idempotency_key
    );

    v_xp_applied := COALESCE(v_reputation.applied, false);
    v_xp_delta := CASE WHEN v_xp_applied THEN 15 ELSE 0 END;
    v_reputation_event_id := v_reputation.event_id;
    v_skipped_reason := v_reputation.skipped_reason;

    UPDATE public.battle_share_events
    SET xp_applied = v_xp_applied,
        xp_delta = v_xp_delta,
        reputation_event_id = v_reputation_event_id
    WHERE id = v_share_event_id;
  END IF;

  RETURN jsonb_build_object(
    'share_event_id', v_share_event_id,
    'xp_awarded', v_xp_applied,
    'xp_delta', v_xp_delta,
    'reputation_event_id', v_reputation_event_id,
    'skipped_reason', v_skipped_reason
  );
END;
$function$;

COMMENT ON FUNCTION public.record_loser_battle_share(uuid, text, text) IS
  'Logs an effective battle share by the non-winning producer and awards Storyteller XP once per battle via reputation_events.idempotency_key.';

REVOKE ALL ON FUNCTION public.get_loser_share_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_loser_share_data(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_loser_share_data(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_loser_share_data(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_loser_share_data(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_loser_battle_share(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_loser_battle_share(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_loser_battle_share(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_loser_battle_share(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_loser_battle_share(uuid, text, text) TO authenticated;

COMMIT;
