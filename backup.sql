


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."battle_status" AS ENUM (
    'pending',
    'active',
    'voting',
    'completed',
    'cancelled',
    'pending_acceptance',
    'rejected',
    'awaiting_admin',
    'approved'
);


ALTER TYPE "public"."battle_status" OWNER TO "postgres";


CREATE TYPE "public"."entitlement_type" AS ENUM (
    'purchase',
    'subscription',
    'promo',
    'admin_grant'
);


ALTER TYPE "public"."entitlement_type" OWNER TO "postgres";


CREATE TYPE "public"."producer_tier_type" AS ENUM (
    'user',
    'producteur',
    'elite'
);


ALTER TYPE "public"."producer_tier_type" OWNER TO "postgres";


CREATE TYPE "public"."product_type" AS ENUM (
    'beat',
    'exclusive',
    'kit'
);


ALTER TYPE "public"."product_type" OWNER TO "postgres";


CREATE TYPE "public"."purchase_status" AS ENUM (
    'pending',
    'completed',
    'failed',
    'refunded'
);


ALTER TYPE "public"."purchase_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_status" AS ENUM (
    'active',
    'canceled',
    'past_due',
    'trialing',
    'unpaid',
    'incomplete',
    'incomplete_expired',
    'paused'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'visitor',
    'user',
    'confirmed_user',
    'producer',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_reputation"("p_user_id" "uuid", "p_delta_xp" integer, "p_reason" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("applied" boolean, "event_id" "uuid", "xp" bigint, "level" integer, "rank_tier" "text", "forum_xp" bigint, "battle_xp" bigint, "commerce_xp" bigint, "reputation_score" numeric, "skipped_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_reason text := COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'admin_adjustment');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  IF p_delta_xp = 0 THEN
    RAISE EXCEPTION 'delta_required';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.apply_reputation_event_internal(
    p_user_id => p_user_id,
    p_source => 'admin',
    p_event_type => 'admin_adjustment',
    p_entity_type => 'user',
    p_entity_id => p_user_id,
    p_delta => p_delta_xp,
    p_metadata => jsonb_build_object(
      'admin_user_id', v_actor,
      'reason', v_reason
    ) || COALESCE(p_metadata, '{}'::jsonb),
    p_idempotency_key => NULL
  );

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_adjust_reputation',
    p_entity_type => 'user',
    p_entity_id => p_user_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'reason', v_reason,
      'delta_xp', p_delta_xp
    ),
    p_extra_details => COALESCE(p_metadata, '{}'::jsonb),
    p_success => true,
    p_error => NULL
  );
END;
$$;


ALTER FUNCTION "public"."admin_adjust_reputation"("p_user_id" "uuid", "p_delta_xp" integer, "p_reason" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_battle"("p_battle_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'admin_cancel_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'admin_cancel_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object('guard', 'rate_limit'),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status = 'completed' THEN
    RAISE EXCEPTION 'cannot_cancel_completed_battle';
  END IF;

  UPDATE public.battles
  SET status = 'cancelled',
      winner_id = NULL,
      updated_at = now()
  WHERE id = p_battle_id;

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  )
  VALUES (
    'battle_cancel_admin',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'source', 'admin_cancel_battle',
      'status_before', v_battle.status,
      'status_after', 'cancelled',
      'actor', v_actor
    ),
    1.0,
    'Battle cancelled by admin',
    'executed',
    false,
    true,
    now(),
    v_actor,
    NULL
  );

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_cancel_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'cancelled'
    ),
    p_extra_details => '{}'::jsonb,
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."admin_cancel_battle"("p_battle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_extend_battle_duration"("p_battle_id" "uuid", "p_days" integer, "p_reason" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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

  IF NOT public.check_rpc_rate_limit(v_actor, 'admin_extend_battle_duration') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'admin_extend_battle_duration',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object('guard', 'rate_limit'),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
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

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_extend_battle_duration',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status', v_battle.status,
      'reason_text', v_reason_text
    ),
    p_extra_details => jsonb_build_object(
      'before_voting_ends_at', v_before_voting_ends_at,
      'after_voting_ends_at', v_after_voting_ends_at,
      'days_added', p_days,
      'extension_count_before', v_extension_count,
      'extension_count_after', v_extension_count_after
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."admin_extend_battle_duration"("p_battle_id" "uuid", "p_days" integer, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_validate_battle"("p_battle_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_new_voting_ends_at timestamptz;
  v_effective_days integer;
  v_duration_source text := 'already_defined';
BEGIN
  IF NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'admin_validate_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'admin_validate_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object('guard', 'rate_limit'),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
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
    IF v_battle.custom_duration_days IS NOT NULL THEN
      v_effective_days := v_battle.custom_duration_days;
      v_duration_source := 'custom';
    ELSE
      SELECT COALESCE((value->>'days')::int, 5)
      INTO v_effective_days
      FROM public.app_settings
      WHERE key = 'battle_default_duration_days'
      LIMIT 1;

      v_effective_days := COALESCE(v_effective_days, 5);
      v_duration_source := 'app_settings';
    END IF;

    v_new_voting_ends_at := now() + (v_effective_days || ' days')::interval;
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

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  )
  VALUES (
    'battle_validate_admin',
    'battle',
    p_battle_id,
    jsonb_build_object(
      'source', 'admin_validate_battle',
      'status_before', v_battle.status,
      'status_after', 'active',
      'voting_ends_at_before', v_battle.voting_ends_at,
      'voting_ends_at_after', CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE v_battle.voting_ends_at
      END,
      'duration_source', v_duration_source,
      'effective_days', v_effective_days,
      'actor', v_actor
    ),
    1.0,
    'Battle validated by admin',
    'executed',
    false,
    true,
    now(),
    v_actor,
    NULL
  );

  IF v_battle.voting_ends_at IS NULL THEN
    INSERT INTO public.ai_admin_actions (
      action_type,
      entity_type,
      entity_id,
      ai_decision,
      confidence_score,
      reason,
      status,
      executed_at
    )
    VALUES (
      'battle_duration_set',
      'battle',
      p_battle_id,
      jsonb_build_object(
        'effective_days', v_effective_days,
        'custom_duration', v_battle.custom_duration_days,
        'source', CASE
          WHEN v_battle.custom_duration_days IS NOT NULL THEN 'custom'
          ELSE 'app_settings'
        END
      ),
      1.0,
      'Battle duration determined during admin validation',
      'executed',
      now()
    );
  END IF;

  UPDATE public.user_profiles
  SET battles_participated = COALESCE(battles_participated, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'admin_validate_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'active',
      'duration_source', v_duration_source
    ),
    p_extra_details => jsonb_build_object(
      'effective_days', v_effective_days,
      'voting_ends_at_before', v_battle.voting_ends_at,
      'voting_ends_at_after', CASE
        WHEN v_battle.voting_ends_at IS NULL THEN v_new_voting_ends_at
        ELSE v_battle.voting_ends_at
      END
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."admin_validate_battle"("p_battle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_finalize_expired_battles"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_candidate_id uuid;
  v_status public.battle_status;
  v_winner_id uuid;
  v_finalize_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'agent_finalize_expired_battles') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'agent_finalize_expired_battles',
      p_entity_type => 'other',
      p_entity_id => NULL,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role
      ),
      p_extra_details => jsonb_build_object(
        'limit', v_limit,
        'message', 'rate_limit_exceeded'
      ),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

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

  BEGIN
    v_finalize_count := public.finalize_expired_battles(v_limit);
  EXCEPTION
    WHEN OTHERS THEN
      FOREACH v_candidate_id IN ARRAY v_candidate_ids
      LOOP
        INSERT INTO public.ai_admin_actions (
          action_type,
          entity_type,
          entity_id,
          ai_decision,
          confidence_score,
          reason,
          status,
          human_override,
          reversible,
          executed_at,
          executed_by,
          error
        ) VALUES (
          'battle_finalize',
          'battle',
          v_candidate_id,
          jsonb_build_object(
            'model', 'rule-based',
            'source', 'agent_finalize_expired_battles',
            'battle_id', v_candidate_id
          ),
          1,
          'Battle finalization failed in finalize_expired_battles wrapper.',
          'failed',
          false,
          true,
          now(),
          NULL,
          SQLERRM
        );
      END LOOP;

      PERFORM public.log_admin_action_audit(
        p_admin_user_id => v_actor,
        p_action_type => 'agent_finalize_expired_battles',
        p_entity_type => 'other',
        p_entity_id => NULL,
        p_source => 'rpc',
        p_context => jsonb_build_object('jwt_role', v_jwt_role),
        p_extra_details => jsonb_build_object(
          'limit', v_limit,
          'candidate_count', COALESCE(array_length(v_candidate_ids, 1), 0)
        ),
        p_success => false,
        p_error => SQLERRM
      );
      RAISE;
  END;

  FOREACH v_candidate_id IN ARRAY v_candidate_ids
  LOOP
    SELECT b.status, b.winner_id
    INTO v_status, v_winner_id
    FROM public.battles b
    WHERE b.id = v_candidate_id;

    IF v_status = 'completed' THEN
      INSERT INTO public.ai_admin_actions (
        action_type,
        entity_type,
        entity_id,
        ai_decision,
        confidence_score,
        reason,
        status,
        human_override,
        reversible,
        executed_at,
        executed_by,
        error
      ) VALUES (
        'battle_finalize',
        'battle',
        v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'winner_id', v_winner_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle auto-finalized by finalize_expired_battles().',
        'executed',
        false,
        true,
        now(),
        NULL,
        NULL
      );
      v_count := v_count + 1;
    ELSE
      INSERT INTO public.ai_admin_actions (
        action_type,
        entity_type,
        entity_id,
        ai_decision,
        confidence_score,
        reason,
        status,
        human_override,
        reversible,
        executed_at,
        executed_by,
        error
      ) VALUES (
        'battle_finalize',
        'battle',
        v_candidate_id,
        jsonb_build_object(
          'model', 'rule-based',
          'source', 'agent_finalize_expired_battles',
          'battle_id', v_candidate_id,
          'finalize_expired_battles_count', v_finalize_count
        ),
        1,
        'Battle not finalized by finalize_expired_battles().',
        'failed',
        false,
        true,
        now(),
        NULL,
        'battle_not_completed_after_finalize_call'
      );
    END IF;
  END LOOP;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'agent_finalize_expired_battles',
    p_entity_type => 'other',
    p_entity_id => NULL,
    p_source => 'rpc',
    p_context => jsonb_build_object('jwt_role', v_jwt_role),
    p_extra_details => jsonb_build_object(
      'limit', v_limit,
      'candidate_count', COALESCE(array_length(v_candidate_ids, 1), 0),
      'finalized_count', v_count,
      'finalize_expired_battles_count', v_finalize_count
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."agent_finalize_expired_battles"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_reputation_event_internal"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_delta" integer DEFAULT NULL::integer, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS TABLE("applied" boolean, "event_id" "uuid", "xp" bigint, "level" integer, "rank_tier" "text", "forum_xp" bigint, "battle_xp" bigint, "commerce_xp" bigint, "reputation_score" numeric, "skipped_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rule public.reputation_rules%ROWTYPE;
  v_has_rule boolean := false;
  v_now timestamptz := now();
  v_effective_delta integer;
  v_effective_source text := lower(COALESCE(NULLIF(btrim(p_source), ''), 'system'));
  v_effective_event_type text := lower(COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown'));
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_multiplier numeric := 1;
  v_existing_event public.reputation_events%ROWTYPE;
  v_recent_count integer := 0;
  v_last_event_at timestamptz;
  v_target public.user_reputation%ROWTYPE;
  v_new_xp bigint;
  v_new_level integer;
  v_new_rank_tier text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  PERFORM public.ensure_user_reputation_row(p_user_id);

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT *
    INTO v_existing_event
    FROM public.reputation_events
    WHERE idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      SELECT *
      INTO v_target
      FROM public.user_reputation
      WHERE user_id = p_user_id;

      RETURN QUERY
      SELECT
        false,
        v_existing_event.id,
        v_target.xp,
        v_target.level,
        v_target.rank_tier,
        v_target.forum_xp,
        v_target.battle_xp,
        v_target.commerce_xp,
        v_target.reputation_score,
        'duplicate_idempotency_key'::text;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_rule
  FROM public.reputation_rules
  WHERE source = v_effective_source
    AND event_type = v_effective_event_type
  LIMIT 1;

  v_has_rule := FOUND;

  IF v_has_rule AND v_rule.is_enabled = false THEN
    SELECT *
    INTO v_target
    FROM public.user_reputation
    WHERE user_id = p_user_id;

    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      v_target.xp,
      v_target.level,
      v_target.rank_tier,
      v_target.forum_xp,
      v_target.battle_xp,
      v_target.commerce_xp,
      v_target.reputation_score,
      'rule_disabled'::text;
    RETURN;
  END IF;

  v_effective_delta := COALESCE(
    p_delta,
    CASE WHEN v_has_rule THEN v_rule.delta_xp ELSE NULL END
  );

  IF v_effective_delta IS NULL THEN
    RAISE EXCEPTION 'reputation_rule_not_found';
  END IF;

  IF jsonb_typeof(v_metadata) = 'object' AND (v_metadata ? 'xp_multiplier') THEN
    v_multiplier := GREATEST(
      0,
      COALESCE(NULLIF(v_metadata->>'xp_multiplier', '')::numeric, 1)
    );
  END IF;

  v_effective_delta := CASE
    WHEN v_multiplier IS NULL OR v_multiplier = 1 THEN v_effective_delta
    WHEN v_effective_delta >= 0 THEN floor(v_effective_delta::numeric * v_multiplier)::integer
    ELSE ceil(v_effective_delta::numeric * v_multiplier)::integer
  END;

  IF v_has_rule AND v_rule.cooldown_sec > 0 THEN
    SELECT max(created_at)
    INTO v_last_event_at
    FROM public.reputation_events
    WHERE user_id = p_user_id
      AND source = v_effective_source
      AND event_type = v_effective_event_type;

    IF v_last_event_at IS NOT NULL AND v_last_event_at >= v_now - make_interval(secs => v_rule.cooldown_sec) THEN
      SELECT *
      INTO v_target
      FROM public.user_reputation
      WHERE user_id = p_user_id;

      RETURN QUERY
      SELECT
        false,
        NULL::uuid,
        v_target.xp,
        v_target.level,
        v_target.rank_tier,
        v_target.forum_xp,
        v_target.battle_xp,
        v_target.commerce_xp,
        v_target.reputation_score,
        'cooldown_active'::text;
      RETURN;
    END IF;
  END IF;

  IF v_has_rule AND v_rule.max_per_day IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_recent_count
    FROM public.reputation_events
    WHERE user_id = p_user_id
      AND source = v_effective_source
      AND event_type = v_effective_event_type
      AND created_at >= date_trunc('day', v_now);

    IF v_recent_count >= v_rule.max_per_day THEN
      SELECT *
      INTO v_target
      FROM public.user_reputation
      WHERE user_id = p_user_id;

      RETURN QUERY
      SELECT
        false,
        NULL::uuid,
        v_target.xp,
        v_target.level,
        v_target.rank_tier,
        v_target.forum_xp,
        v_target.battle_xp,
        v_target.commerce_xp,
        v_target.reputation_score,
        'daily_cap_reached'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.reputation_events (
    user_id,
    source,
    event_type,
    entity_type,
    entity_id,
    delta_xp,
    metadata,
    idempotency_key,
    created_at
  )
  VALUES (
    p_user_id,
    v_effective_source,
    v_effective_event_type,
    NULLIF(btrim(COALESCE(p_entity_type, '')), ''),
    p_entity_id,
    v_effective_delta,
    v_metadata,
    NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
    v_now
  )
  RETURNING * INTO v_existing_event;

  SELECT *
  INTO v_target
  FROM public.user_reputation
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_new_xp := GREATEST(0, COALESCE(v_target.xp, 0) + v_effective_delta);
  v_new_level := public.reputation_calculate_level(v_new_xp);
  v_new_rank_tier := public.reputation_calculate_rank_tier(v_new_xp);

  UPDATE public.user_reputation
  SET xp = v_new_xp,
      level = v_new_level,
      rank_tier = v_new_rank_tier,
      forum_xp = GREATEST(
        0,
        COALESCE(v_target.forum_xp, 0)
        + CASE WHEN v_effective_source = 'forum' THEN v_effective_delta ELSE 0 END
      ),
      battle_xp = GREATEST(
        0,
        COALESCE(v_target.battle_xp, 0)
        + CASE WHEN v_effective_source = 'battles' THEN v_effective_delta ELSE 0 END
      ),
      commerce_xp = GREATEST(
        0,
        COALESCE(v_target.commerce_xp, 0)
        + CASE WHEN v_effective_source = 'commerce' THEN v_effective_delta ELSE 0 END
      ),
      reputation_score = v_new_xp,
      last_event_at = v_now,
      updated_at = v_now
  WHERE user_id = p_user_id;

  SELECT *
  INTO v_target
  FROM public.user_reputation
  WHERE user_id = p_user_id;

  RETURN QUERY
  SELECT
    true,
    v_existing_event.id,
    v_target.xp,
    v_target.level,
    v_target.rank_tier,
    v_target.forum_xp,
    v_target.battle_xp,
    v_target.commerce_xp,
    v_target.reputation_score,
    NULL::text;
END;
$$;


ALTER FUNCTION "public"."apply_reputation_event_internal"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_battle_skill_gap"("p_producer1" "uuid", "p_producer2" "uuid", "p_max_diff" integer DEFAULT 400) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_elo_1 integer := 1200;
  v_elo_2 integer := 1200;
BEGIN
  IF p_producer1 IS NULL OR p_producer2 IS NULL THEN
    RETURN false;
  END IF;

  IF p_max_diff IS NULL OR p_max_diff < 0 THEN
    p_max_diff := 400;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_producer1)
    OR public.is_admin(v_actor)
  ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_elo_1
  FROM public.user_profiles up
  WHERE up.id = p_producer1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_elo_2
  FROM public.user_profiles up
  WHERE up.id = p_producer2
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF ABS(v_elo_1 - v_elo_2) > p_max_diff THEN
    RAISE EXCEPTION 'Skill difference too high to start battle.';
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."assert_battle_skill_gap"("p_producer1" "uuid", "p_producer2" "uuid", "p_max_diff" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."battles_force_created_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."battles_force_created_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."battles_lock_created_at_on_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."battles_lock_created_at_on_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_exclusive_preview"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN public.is_confirmed_user(p_user_id);
END;
$$;


ALTER FUNCTION "public"."can_access_exclusive_preview"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_create_active_battle"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_count bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.battles b
  WHERE b.producer1_id = p_user_id
    AND b.status IN ('pending_acceptance', 'active', 'voting');

  RETURN v_count < 3;
END;
$$;


ALTER FUNCTION "public"."can_create_active_battle"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_create_battle"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_tier_text text := 'user';
  v_allowed_tiers text[] := ARRAY['producteur', 'elite'];
  v_max_battles integer;
  v_count bigint := 0;
  v_month_start timestamptz := date_trunc('month', now());
  v_next_month_start timestamptz := date_trunc('month', now()) + interval '1 month';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.producer_tier::text, 'user')
  INTO v_tier_text
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT (v_tier_text = ANY (v_allowed_tiers)) THEN
    RETURN false;
  END IF;

  SELECT pp.max_battles_created_per_month
  INTO v_max_battles
  FROM public.producer_plans pp
  WHERE pp.tier::text = v_tier_text
    AND pp.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_max_battles IS NULL THEN
    RETURN true;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.battles b
  WHERE b.producer1_id = p_user_id
    AND b.created_at >= v_month_start
    AND b.created_at < v_next_month_start;

  RETURN v_count < v_max_battles;
END;
$$;


ALTER FUNCTION "public"."can_create_battle"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_create_product"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN public.can_publish_beat(p_user_id, NULL);
END;
$$;


ALTER FUNCTION "public"."can_create_product"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_edit_product"("p_product_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_sales_count integer := 0;
  v_active_battle_count integer := 0;
  v_has_terminated_battle boolean := false;
  v_can_edit_audio boolean := false;
  v_can_edit_metadata_essentials boolean := false;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND product_type = 'beat'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF v_actor IS NULL OR v_product.producer_id <> v_actor THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  SELECT COUNT(*)
  INTO v_sales_count
  FROM public.purchases pu
  WHERE pu.product_id = p_product_id
    AND pu.status IN ('completed', 'refunded');

  SELECT COUNT(*)
  INTO v_active_battle_count
  FROM public.battles b
  WHERE b.status = 'active'
    AND (b.product1_id = p_product_id OR b.product2_id = p_product_id);

  v_has_terminated_battle := public.product_has_terminated_battle(p_product_id);
  v_can_edit_audio := v_sales_count = 0 AND v_active_battle_count = 0 AND NOT v_has_terminated_battle;
  v_can_edit_metadata_essentials := v_sales_count = 0 AND NOT v_has_terminated_battle;

  RETURN jsonb_build_object(
    'can_edit_audio', v_can_edit_audio,
    'can_edit_metadata', v_can_edit_metadata_essentials,
    'can_edit_metadata_essentials', v_can_edit_metadata_essentials,
    'must_create_new_version', v_sales_count > 0 OR v_has_terminated_battle,
    'has_sales', v_sales_count > 0,
    'has_active_battle', v_active_battle_count > 0,
    'has_terminated_battle', v_has_terminated_battle
  );
END;
$$;


ALTER FUNCTION "public"."can_edit_product"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_publish_beat"("p_user_id" "uuid", "p_exclude_product_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tier public.producer_tier_type;
  v_max_beats integer;
  v_count bigint := 0;
BEGIN
  v_tier := public.get_producer_tier(p_user_id);
  IF v_tier IS NULL THEN
    RETURN false;
  END IF;

  SELECT limits.max_beats_published
  INTO v_max_beats
  FROM public.get_plan_limits(v_tier) AS limits;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_max_beats IS NULL THEN
    RETURN true;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.products p
  WHERE p.producer_id = p_user_id
    AND p.product_type = 'beat'
    AND p.is_published = true
    AND p.deleted_at IS NULL
    AND (p_exclude_product_id IS NULL OR p.id <> p_exclude_product_id);

  RETURN v_count < v_max_beats;
END;
$$;


ALTER FUNCTION "public"."can_publish_beat"("p_user_id" "uuid", "p_exclude_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_battle_product_snapshots"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.product1_id IS NOT NULL THEN
      PERFORM public.upsert_battle_product_snapshot(NEW.id, 'producer1');
    END IF;

    IF NEW.product2_id IS NOT NULL THEN
      PERFORM public.upsert_battle_product_snapshot(NEW.id, 'producer2');
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.product1_id IS DISTINCT FROM OLD.product1_id THEN
    PERFORM public.upsert_battle_product_snapshot(NEW.id, 'producer1');
  END IF;

  IF NEW.product2_id IS DISTINCT FROM OLD.product2_id THEN
    PERFORM public.upsert_battle_product_snapshot(NEW.id, 'producer2');
  END IF;

  IF NEW.status = 'completed' AND COALESCE(OLD.status::text, '') <> 'completed' THEN
    PERFORM public.upsert_battle_product_snapshot(NEW.id, 'producer1');
    PERFORM public.upsert_battle_product_snapshot(NEW.id, 'producer2');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."capture_battle_product_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_assign_badges"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_wins integer := 0;
  v_losses integer := 0;
  v_draws integer := 0;
  v_total_battles integer := 0;
  v_rank_position bigint := NULL;
  v_inserted integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT
    COALESCE(up.battle_wins, 0),
    COALESCE(up.battle_losses, 0),
    COALESCE(up.battle_draws, 0)
  INTO
    v_wins,
    v_losses,
    v_draws
  FROM public.user_profiles up
  WHERE up.id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_total_battles := v_wins + v_losses + v_draws;

  SELECT glp.rank_position
  INTO v_rank_position
  FROM public.get_leaderboard_producers() glp
  WHERE glp.user_id = p_user_id
  LIMIT 1;

  WITH eligible AS (
    SELECT pb.id
    FROM public.producer_badges pb
    WHERE (
      pb.condition_type = 'total_battles'
      AND v_total_battles >= pb.condition_value
    )
    OR (
      pb.condition_type = 'total_wins'
      AND v_wins >= pb.condition_value
    )
    OR (
      pb.condition_type = 'leaderboard_top'
      AND v_rank_position IS NOT NULL
      AND v_rank_position <= pb.condition_value
    )
  )
  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT p_user_id, e.id
  FROM eligible e
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."check_and_assign_badges"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_daily_battle_refusals"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_count bigint := 0;
  v_window_start timestamptz := now() - interval '24 hours';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.battles b
  WHERE b.producer2_id = p_user_id
    AND b.status = 'rejected'
    AND b.rejected_at IS NOT NULL
    AND b.rejected_at >= v_window_start;

  RETURN v_count < 5;
END;
$$;


ALTER FUNCTION "public"."check_daily_battle_refusals"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rpc_rate_limit"("p_user_id" "uuid", "p_rpc_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rule public.rpc_rate_limit_rules%ROWTYPE;
  v_scope_key text;
  v_window_start timestamptz := date_trunc('minute', now());
  v_request_count integer := 0;
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_headers jsonb := public.get_request_headers_jsonb();
BEGIN
  IF p_rpc_name IS NULL OR btrim(p_rpc_name) = '' THEN
    RETURN true;
  END IF;

  SELECT *
  INTO v_rule
  FROM public.rpc_rate_limit_rules
  WHERE rpc_name = p_rpc_name;

  IF NOT FOUND OR COALESCE(v_rule.is_enabled, true) = false THEN
    RETURN true;
  END IF;

  v_scope_key := CASE
    WHEN v_rule.scope = 'global' THEN 'global'
    ELSE COALESCE(p_user_id::text, v_actor::text, 'anonymous')
  END;

  INSERT INTO public.rpc_rate_limit_counters (
    rpc_name,
    scope_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_rpc_name,
    v_scope_key,
    v_window_start,
    1,
    now()
  )
  ON CONFLICT (rpc_name, scope_key, window_started_at)
  DO UPDATE
    SET request_count = public.rpc_rate_limit_counters.request_count + 1,
        updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > v_rule.allowed_per_minute THEN
    INSERT INTO public.rpc_rate_limit_hits (
      rpc_name,
      user_id,
      scope_key,
      allowed_per_minute,
      observed_count,
      context
    )
    VALUES (
      p_rpc_name,
      COALESCE(p_user_id, v_actor),
      v_scope_key,
      v_rule.allowed_per_minute,
      v_request_count,
      jsonb_build_object(
        'jwt_role', v_jwt_role,
        'auth_uid', v_actor,
        'request_sub', current_setting('request.jwt.claim.sub', true),
        'session_id', COALESCE(auth.jwt()->>'session_id', current_setting('request.jwt.claim.session_id', true)),
        'request_id', COALESCE(v_headers->>'x-request-id', v_headers->>'X-Request-Id'),
        'source', 'check_rpc_rate_limit'
      )
    );

    RETURN false;
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."check_rpc_rate_limit"("p_user_id" "uuid", "p_rpc_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_stripe_event_processed"("p_event_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM stripe_events WHERE id = p_event_id AND processed = true);
END;
$$;


ALTER FUNCTION "public"."check_stripe_event_processed"("p_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_user_confirmation_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.total_purchases >= 10 AND OLD.total_purchases < 10 AND NEW.role = 'user' THEN
    NEW.role := 'confirmed_user';
    NEW.confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_user_confirmation_status"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audio_processing_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "job_type" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "last_error" "text",
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audio_processing_jobs_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "audio_processing_jobs_job_type_check" CHECK (("job_type" = ANY (ARRAY['generate_preview'::"text", 'reprocess_all'::"text"]))),
    CONSTRAINT "audio_processing_jobs_max_attempts_check" CHECK (("max_attempts" >= 1)),
    CONSTRAINT "audio_processing_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'done'::"text", 'error'::"text", 'dead'::"text"])))
);


ALTER TABLE "public"."audio_processing_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_audio_processing_jobs"("p_limit" integer DEFAULT 20, "p_worker" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."audio_processing_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_worker text := COALESCE(NULLIF(btrim(COALESCE(p_worker, '')), ''), 'audio-worker');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_or_service_role_required';
  END IF;

  RETURN QUERY
  WITH reclaimed AS (
    UPDATE public.audio_processing_jobs AS stale
    SET
      status = 'queued',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
    WHERE stale.status = 'processing'
      AND stale.locked_at IS NOT NULL
      AND stale.locked_at < now() - interval '15 minutes'
    RETURNING stale.id
  ),
  candidates AS (
    SELECT job.id
    FROM public.audio_processing_jobs AS job
    WHERE job.status IN ('queued', 'error')
      AND job.attempts < job.max_attempts
    ORDER BY job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.audio_processing_jobs AS job
    SET
      status = 'processing',
      attempts = job.attempts + 1,
      locked_at = now(),
      locked_by = v_worker,
      updated_at = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  )
  SELECT * FROM claimed;
END;
$$;


ALTER FUNCTION "public"."claim_audio_processing_jobs"("p_limit" integer, "p_worker" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_generation_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "max_attempts" integer DEFAULT 8 NOT NULL,
    CONSTRAINT "contract_generation_jobs_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "contract_generation_jobs_max_attempts_check" CHECK (("max_attempts" >= 1)),
    CONSTRAINT "contract_generation_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."contract_generation_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_contract_generation_jobs"("p_limit" integer DEFAULT 10, "p_worker" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."contract_generation_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_worker text := COALESCE(NULLIF(btrim(COALESCE(p_worker, '')), ''), 'contract-worker');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_or_service_role_required';
  END IF;

  RETURN QUERY
  WITH reclaimed AS (
    UPDATE public.contract_generation_jobs j
    SET
      status = 'failed',
      last_error = COALESCE(j.last_error, 'stale_processing_lock'),
      locked_at = NULL,
      locked_by = NULL,
      next_run_at = now(),
      updated_at = now()
    WHERE j.status = 'processing'
      AND j.locked_at IS NOT NULL
      AND j.locked_at < now() - interval '10 minutes'
    RETURNING j.id
  ),
  candidates AS (
    SELECT j.id
    FROM public.contract_generation_jobs j
    WHERE j.status IN ('pending', 'failed')
      AND j.next_run_at <= now()
      AND j.attempts < j.max_attempts
    ORDER BY j.next_run_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  claimed AS (
    UPDATE public.contract_generation_jobs j
    SET
      status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = v_worker,
      updated_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * FROM claimed;
END;
$$;


ALTER FUNCTION "public"."claim_contract_generation_jobs"("p_limit" integer, "p_worker" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_notification_email_send"("p_category" "text", "p_recipient_email" "text", "p_dedupe_key" "text", "p_rate_limit_seconds" integer DEFAULT 900, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_category text := trim(coalesce(p_category, ''));
  v_recipient_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_dedupe_key text := trim(coalesce(p_dedupe_key, ''));
  v_rate_limit_seconds integer := GREATEST(coalesce(p_rate_limit_seconds, 0), 0);
  v_recent_exists boolean := false;
BEGIN
  IF v_category = '' OR v_recipient_email = '' OR v_dedupe_key = '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_params');
  END IF;

  IF v_rate_limit_seconds <= 0 THEN
    v_rate_limit_seconds := 900;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_category || ':' || v_recipient_email, 0));

  IF EXISTS (
    SELECT 1
    FROM public.notification_email_log nel
    WHERE nel.dedupe_key = v_dedupe_key
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_dedupe');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.notification_email_log nel
    WHERE nel.category = v_category
      AND nel.recipient_email = v_recipient_email
      AND nel.created_at >= (now() - make_interval(secs => v_rate_limit_seconds))
  ) INTO v_recent_exists;

  IF v_recent_exists THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  INSERT INTO public.notification_email_log (
    category,
    recipient_email,
    dedupe_key,
    metadata
  )
  VALUES (
    v_category,
    v_recipient_email,
    v_dedupe_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_dedupe');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'claimed');
END;
$$;


ALTER FUNCTION "public"."claim_notification_email_send"("p_category" "text", "p_recipient_email" "text", "p_dedupe_key" "text", "p_rate_limit_seconds" integer, "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."classify_battle_comment_rule_based"("p_content" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_text text := lower(COALESCE(p_content, ''));
  v_toxic_hits integer := 0;
  v_spam_hits integer := 0;
  v_borderline_hits integer := 0;
  v_has_link boolean := false;
  v_classification text := 'safe';
  v_score numeric(5,4) := 0.0500;
  v_reason text := 'no_signal';
  v_suggested_action text := 'allow';
BEGIN
  IF btrim(v_text) = '' THEN
    v_classification := 'spam';
    v_score := 0.9900;
    v_reason := 'empty_comment';
    v_suggested_action := 'hide';
  ELSE
    v_has_link := (v_text ~ '(https?://|www\\.)');

    SELECT COUNT(*) INTO v_toxic_hits
    FROM unnest(ARRAY[
      'kill yourself', 'kys', 'nazi', 'racist', 'slur', 'fdp', 'pute', 'connard', 'encule'
    ]) kw
    WHERE v_text LIKE '%' || kw || '%';

    SELECT COUNT(*) INTO v_spam_hits
    FROM unnest(ARRAY[
      'buy followers', 'free money', 'dm me', 'telegram', 'whatsapp', 'crypto giveaway', 'promo code'
    ]) kw
    WHERE v_text LIKE '%' || kw || '%';

    SELECT COUNT(*) INTO v_borderline_hits
    FROM unnest(ARRAY[
      'nul', 'naze', 'trash', 'horrible', 'hate', 'stupid', 'idiot'
    ]) kw
    WHERE v_text LIKE '%' || kw || '%';

    IF v_toxic_hits > 0 THEN
      v_classification := 'toxic';
      v_score := LEAST(1.0000, 0.9400 + (v_toxic_hits * 0.0300));
      v_reason := 'toxic_keyword_match';
      v_suggested_action := CASE WHEN v_score >= 0.9500 THEN 'hide' ELSE 'review' END;
    ELSIF v_spam_hits > 0 OR (v_has_link AND char_length(v_text) <= 40) THEN
      v_classification := 'spam';
      v_score := CASE
        WHEN v_spam_hits > 1 OR (v_has_link AND char_length(v_text) <= 20) THEN 0.9700
        ELSE 0.9100
      END;
      v_reason := 'spam_signal_match';
      v_suggested_action := CASE WHEN v_score >= 0.9500 THEN 'hide' ELSE 'review' END;
    ELSIF v_borderline_hits > 0 THEN
      v_classification := 'borderline';
      v_score := LEAST(0.8900, 0.6200 + (v_borderline_hits * 0.0700));
      v_reason := 'borderline_toxicity_signal';
      v_suggested_action := 'review';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'model', 'rule-based-comment-v1',
    'classification', v_classification,
    'score', v_score,
    'reason', v_reason,
    'suggested_action', v_suggested_action,
    'flags', jsonb_build_object(
      'toxic_hits', v_toxic_hits,
      'spam_hits', v_spam_hits,
      'borderline_hits', v_borderline_hits,
      'has_link', v_has_link
    ),
    'auto_threshold', 0.9500,
    'analyzed_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."classify_battle_comment_rule_based"("p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_exclusive_locks"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  DELETE FROM exclusive_locks WHERE expires_at < now();
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_exclusive_locks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_rpc_rate_limit_counters"("p_keep_hours" integer DEFAULT 48) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_deleted integer := 0;
  v_keep_hours integer := GREATEST(1, COALESCE(p_keep_hours, 48));
BEGIN
  DELETE FROM public.rpc_rate_limit_counters
  WHERE window_started_at < now() - make_interval(hours => v_keep_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_rpc_rate_limit_counters"("p_keep_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_exclusive_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_purchase_id uuid;
  v_producer_id uuid;
  v_lock exclusive_locks%ROWTYPE;
BEGIN
  -- Verify lock exists and matches
  SELECT * INTO v_lock FROM exclusive_locks 
  WHERE product_id = p_product_id 
  AND stripe_checkout_session_id = p_checkout_session_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No valid lock found for this purchase';
  END IF;
  
  -- Get producer ID
  SELECT producer_id INTO v_producer_id FROM products WHERE id = p_product_id;
  
  -- Create purchase record
  INSERT INTO purchases (
    user_id, product_id, producer_id, 
    stripe_payment_intent_id, stripe_checkout_session_id,
    amount, status, is_exclusive, completed_at,
    download_expires_at
  ) VALUES (
    p_user_id, p_product_id, v_producer_id,
    p_payment_intent_id, p_checkout_session_id,
    p_amount, 'completed', true, now(),
    now() + interval '24 hours'
  ) RETURNING id INTO v_purchase_id;
  
  -- Create entitlement
  INSERT INTO entitlements (user_id, product_id, purchase_id, entitlement_type)
  VALUES (p_user_id, p_product_id, v_purchase_id, 'purchase')
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now();
  
  -- Mark product as sold
  UPDATE products SET
    is_sold = true,
    sold_at = now(),
    sold_to_user_id = p_user_id,
    is_published = false
  WHERE id = p_product_id;
  
  -- Remove lock
  DELETE FROM exclusive_locks WHERE product_id = p_product_id;
  
  -- Increment user's purchase count
  UPDATE user_profiles SET
    total_purchases = total_purchases + 1
  WHERE id = p_user_id;
  
  RETURN v_purchase_id;
END;
$$;


ALTER FUNCTION "public"."complete_exclusive_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_license_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_license_id" "uuid", "p_amount" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_purchase_id uuid;
  v_existing_purchase_id uuid;
  v_producer_id uuid;
  v_product public.products%ROWTYPE;
  v_license public.licenses%ROWTYPE;
  v_existing_license_sales integer;
  v_lock public.exclusive_locks%ROWTYPE;
  v_is_new_purchase boolean := false;
BEGIN
  IF p_checkout_session_id IS NULL OR btrim(p_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'Missing checkout session id';
  END IF;

  IF p_payment_intent_id IS NULL OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'Missing payment intent id';
  END IF;

  SELECT id
  INTO v_existing_purchase_id
  FROM public.purchases
  WHERE stripe_payment_intent_id = p_payment_intent_id
     OR stripe_checkout_session_id = p_checkout_session_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_purchase_id IS NOT NULL THEN
    RETURN v_existing_purchase_id;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  SELECT *
  INTO v_license
  FROM public.licenses
  WHERE id = p_license_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'License not found: %', p_license_id;
  END IF;

  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount;
  END IF;

  IF v_product.price <> p_amount THEN
    RAISE EXCEPTION 'Amount mismatch for product %. Expected %, got %', v_product.id, v_product.price, p_amount;
  END IF;

  IF v_product.is_exclusive AND NOT v_license.exclusive_allowed THEN
    RAISE EXCEPTION 'License % does not allow exclusive purchase', v_license.name;
  END IF;

  IF v_product.is_exclusive THEN
    IF v_product.is_sold AND v_product.sold_to_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'This exclusive product has already been sold';
    END IF;

    SELECT *
    INTO v_lock
    FROM public.exclusive_locks
    WHERE product_id = p_product_id
      AND stripe_checkout_session_id = p_checkout_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No valid lock found for this exclusive purchase';
    END IF;
  END IF;

  IF v_license.max_sales IS NOT NULL THEN
    SELECT count(*)
    INTO v_existing_license_sales
    FROM public.purchases
    WHERE product_id = p_product_id
      AND license_id = p_license_id
      AND status = 'completed';

    IF v_existing_license_sales >= v_license.max_sales THEN
      RAISE EXCEPTION 'License % reached max sales limit for this product', v_license.name;
    END IF;
  END IF;

  v_producer_id := v_product.producer_id;

  INSERT INTO public.purchases (
    user_id,
    product_id,
    producer_id,
    stripe_payment_intent_id,
    stripe_checkout_session_id,
    amount,
    status,
    is_exclusive,
    license_type,
    license_id,
    completed_at,
    download_expires_at,
    metadata
  ) VALUES (
    p_user_id,
    p_product_id,
    v_producer_id,
    p_payment_intent_id,
    p_checkout_session_id,
    p_amount,
    'completed',
    v_product.is_exclusive,
    v_license.name,
    v_license.id,
    now(),
    CASE
      WHEN v_product.is_exclusive THEN now() + interval '24 hours'
      ELSE now() + interval '7 days'
    END,
    jsonb_build_object(
      'license_id', v_license.id,
      'license_name', v_license.name,
      'max_streams', v_license.max_streams,
      'max_sales', v_license.max_sales,
      'youtube_monetization', v_license.youtube_monetization,
      'music_video_allowed', v_license.music_video_allowed,
      'credit_required', v_license.credit_required,
      'exclusive_allowed', v_license.exclusive_allowed,
      'price_source', 'products.price'
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_purchase_id;

  IF v_purchase_id IS NULL THEN
    SELECT id
    INTO v_purchase_id
    FROM public.purchases
    WHERE stripe_payment_intent_id = p_payment_intent_id
       OR stripe_checkout_session_id = p_checkout_session_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_purchase_id IS NULL THEN
      RAISE EXCEPTION 'Could not resolve existing purchase for payment intent %', p_payment_intent_id;
    END IF;
  ELSE
    v_is_new_purchase := true;
  END IF;

  INSERT INTO public.entitlements (
    user_id,
    product_id,
    purchase_id,
    entitlement_type
  ) VALUES (
    p_user_id,
    p_product_id,
    v_purchase_id,
    'purchase'
  )
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now();

  IF v_product.is_exclusive THEN
    UPDATE public.products
    SET
      is_sold = true,
      sold_at = now(),
      sold_to_user_id = p_user_id,
      is_published = false
    WHERE id = p_product_id;

    DELETE FROM public.exclusive_locks
    WHERE product_id = p_product_id;
  END IF;

  IF v_is_new_purchase THEN
    UPDATE public.user_profiles
    SET total_purchases = total_purchases + 1
    WHERE id = p_user_id;
  END IF;

  RETURN v_purchase_id;
END;
$$;


ALTER FUNCTION "public"."complete_license_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_license_id" "uuid", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_standard_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer, "p_license_type" "text" DEFAULT 'standard'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_purchase_id uuid;
  v_producer_id uuid;
BEGIN
  -- Get producer ID
  SELECT producer_id INTO v_producer_id FROM products WHERE id = p_product_id;
  
  -- Create purchase record
  INSERT INTO purchases (
    user_id, product_id, producer_id,
    stripe_payment_intent_id, stripe_checkout_session_id,
    amount, status, is_exclusive, license_type, completed_at,
    download_expires_at
  ) VALUES (
    p_user_id, p_product_id, v_producer_id,
    p_payment_intent_id, p_checkout_session_id,
    p_amount, 'completed', false, p_license_type, now(),
    now() + interval '7 days'
  ) RETURNING id INTO v_purchase_id;
  
  -- Create entitlement
  INSERT INTO entitlements (user_id, product_id, purchase_id, entitlement_type)
  VALUES (p_user_id, p_product_id, v_purchase_id, 'purchase')
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    purchase_id = EXCLUDED.purchase_id,
    is_active = true,
    granted_at = now();
  
  -- Increment user's purchase count
  UPDATE user_profiles SET
    total_purchases = total_purchases + 1
  WHERE id = p_user_id;
  
  RETURN v_purchase_id;
END;
$$;


ALTER FUNCTION "public"."complete_standard_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer, "p_license_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_preview_signature"("p_master_reference" "text", "p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT encode(
    extensions.digest(
      concat_ws(
        '|',
        COALESCE(p_master_reference, ''),
        COALESCE(p_watermark_audio_path, ''),
        public.format_watermark_gain_db(p_gain_db),
        COALESCE(p_min_interval_sec, 0)::text,
        COALESCE(p_max_interval_sec, 0)::text
      ),
      'sha256'
    ),
    'hex'
  );
$$;


ALTER FUNCTION "public"."compute_preview_signature"("p_master_reference" "text", "p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_watermark_hash"("p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT encode(
    extensions.digest(
      concat_ws(
        '|',
        COALESCE(p_watermark_audio_path, ''),
        public.format_watermark_gain_db(p_gain_db),
        COALESCE(p_min_interval_sec, 0)::text,
        COALESCE(p_max_interval_sec, 0)::text
      ),
      'sha256'
    ),
    'hex'
  );
$$;


ALTER FUNCTION "public"."compute_watermark_hash"("p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_exclusive_lock"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_is_sold boolean;
  v_existing_lock exclusive_locks%ROWTYPE;
BEGIN
  -- First, clean up expired locks
  PERFORM cleanup_expired_exclusive_locks();
  
  -- Check if product is already sold
  SELECT is_sold INTO v_is_sold FROM products WHERE id = p_product_id;
  IF v_is_sold THEN
    RETURN false;
  END IF;
  
  -- Check for existing lock
  SELECT * INTO v_existing_lock FROM exclusive_locks WHERE product_id = p_product_id;
  IF FOUND AND v_existing_lock.expires_at > now() THEN
    -- Lock exists and is not expired
    RETURN false;
  END IF;
  
  -- Delete any existing expired lock and create new one
  DELETE FROM exclusive_locks WHERE product_id = p_product_id;
  
  INSERT INTO exclusive_locks (product_id, user_id, stripe_checkout_session_id)
  VALUES (p_product_id, p_user_id, p_checkout_session_id);
  
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."create_exclusive_lock"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "producer_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "product_type" "public"."product_type" NOT NULL,
    "genre_id" "uuid",
    "mood_id" "uuid",
    "bpm" integer,
    "key_signature" "text",
    "price" integer NOT NULL,
    "preview_url" "text",
    "exclusive_preview_url" "text",
    "cover_image_url" "text",
    "is_exclusive" boolean DEFAULT false NOT NULL,
    "is_sold" boolean DEFAULT false NOT NULL,
    "sold_at" timestamp with time zone,
    "sold_to_user_id" "uuid",
    "is_published" boolean DEFAULT false NOT NULL,
    "play_count" integer DEFAULT 0 NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "duration_seconds" integer,
    "file_format" "text" DEFAULT 'mp3'::"text",
    "license_terms" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "watermarked_path" "text",
    "master_path" "text",
    "watermark_profile_id" "uuid",
    "deleted_at" timestamp with time zone,
    "master_url" "text",
    "processing_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "processing_error" "text",
    "preview_version" integer DEFAULT 1 NOT NULL,
    "processed_at" timestamp with time zone,
    "watermarked_bucket" "text" DEFAULT 'beats-watermarked'::"text",
    "preview_signature" "text",
    "last_watermark_hash" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "original_beat_id" "uuid",
    "version_number" integer DEFAULT 1 NOT NULL,
    "parent_product_id" "uuid",
    "archived_at" timestamp with time zone,
    CONSTRAINT "exclusive_must_have_type" CHECK (((("is_exclusive" = true) AND ("product_type" = 'exclusive'::"public"."product_type")) OR (("is_exclusive" = false) AND ("product_type" <> 'exclusive'::"public"."product_type")))),
    CONSTRAINT "products_bpm_check" CHECK ((("bpm" > 0) AND ("bpm" <= 300))),
    CONSTRAINT "products_preview_version_positive_check" CHECK (("preview_version" >= 1)),
    CONSTRAINT "products_price_check" CHECK (("price" >= 0)),
    CONSTRAINT "products_processing_status_check" CHECK (("processing_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'error'::"text"]))),
    CONSTRAINT "products_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"]))),
    CONSTRAINT "products_version_number_positive_check" CHECK (("version_number" >= 1)),
    CONSTRAINT "products_version_positive_check" CHECK (("version" >= 1)),
    CONSTRAINT "products_watermarked_bucket_not_blank_check" CHECK ((("watermarked_bucket" IS NULL) OR ("btrim"("watermarked_bucket") <> ''::"text")))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_new_version_from_beat"("p_beat_id" "uuid", "p_new_data" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."products"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_new_product_id uuid;
  v_new_product public.products%ROWTYPE;
BEGIN
  v_new_product_id := public.rpc_create_product_version(p_beat_id);

  SELECT *
  INTO v_new_product
  FROM public.products
  WHERE id = v_new_product_id;

  RETURN v_new_product;
END;
$$;


ALTER FUNCTION "public"."create_new_version_from_beat"("p_beat_id" "uuid", "p_new_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_beat_if_no_sales"("p_beat_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.rpc_delete_product_if_no_sales(p_beat_id);
$$;


ALTER FUNCTION "public"."delete_beat_if_no_sales"("p_beat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_my_account"("p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("success" boolean, "status" "text", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.user_profiles%ROWTYPE;
  v_suffix text;
  v_deleted_username text;
  v_attempt integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF COALESCE(v_profile.is_deleted, false) = true OR v_profile.deleted_at IS NOT NULL THEN
    RETURN QUERY
    SELECT
      true,
      'already_deleted'::text,
      'Account already deleted.'::text;
    RETURN;
  END IF;

  LOOP
    v_suffix := encode(gen_random_bytes(4), 'hex');
    v_deleted_username := 'deleted_' || v_suffix;

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.username = v_deleted_username
    );

    v_attempt := v_attempt + 1;
    IF v_attempt >= 8 THEN
      RAISE EXCEPTION 'unable_to_generate_deleted_username';
    END IF;
  END LOOP;

  UPDATE public.user_profiles
  SET
    username = v_deleted_username,
    full_name = NULL,
    avatar_url = NULL,
    bio = NULL,
    website_url = NULL,
    social_links = '{}'::jsonb,
    is_producer_active = false,
    is_deleted = true,
    deleted_at = now(),
    delete_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
    deleted_label = 'Deleted Producer',
    updated_at = now()
  WHERE id = v_user_id;

  IF to_regclass('public.cart_items') IS NOT NULL THEN
    DELETE FROM public.cart_items WHERE user_id = v_user_id;
  END IF;

  IF to_regclass('public.wishlists') IS NOT NULL THEN
    DELETE FROM public.wishlists WHERE user_id = v_user_id;
  END IF;

  RETURN QUERY
  SELECT
    true,
    'deleted'::text,
    'Account deleted and anonymized.'::text;
END;
$$;


ALTER FUNCTION "public"."delete_my_account"("p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_my_account"("p_reason" "text") IS 'Self-service logical account deletion + profile anonymization. Preserves all historical FK-linked records.';



CREATE OR REPLACE FUNCTION "public"."detect_admin_action_anomalies"("p_lookback_minutes" integer DEFAULT 15) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_lookback integer := GREATEST(1, COALESCE(p_lookback_minutes, 15));
  v_row record;
  v_inserted integer := 0;
BEGIN
  FOR v_row IN
    SELECT
      aal.action_type,
      COUNT(*)::integer AS action_count
    FROM public.admin_action_audit_log aal
    WHERE aal.created_at >= now() - make_interval(mins => v_lookback)
    GROUP BY aal.action_type
    HAVING COUNT(*) >= 50
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.monitoring_alert_events mae
      WHERE mae.event_type = 'admin_action_spike_scan'
        AND mae.details->>'action_type' = v_row.action_type
        AND mae.created_at >= now() - make_interval(mins => v_lookback)
    ) THEN
      PERFORM public.log_monitoring_alert(
        p_event_type => 'admin_action_spike_scan',
        p_severity => 'critical',
        p_source => 'detect_admin_action_anomalies',
        p_entity_type => 'other',
        p_entity_id => NULL,
        p_details => jsonb_build_object(
          'action_type', v_row.action_type,
          'action_count', v_row.action_count,
          'lookback_minutes', v_lookback,
          'threshold', 50
        )
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."detect_admin_action_anomalies"("p_lookback_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_active_user_id_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_current_user_active(NEW.user_id) THEN
    RAISE EXCEPTION 'account_deleted_or_inactive';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_active_user_id_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_admin_notifications_for_ai_action"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.status <> 'proposed' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_notifications (user_id, type, payload)
  SELECT
    up.id,
    'ai_action_proposed',
    jsonb_build_object(
      'action_id', NEW.id,
      'action_type', NEW.action_type,
      'entity_type', NEW.entity_type,
      'entity_id', NEW.entity_id,
      'confidence_score', NEW.confidence_score,
      'created_at', NEW.created_at
    )
  FROM public.user_profiles up
  WHERE up.role = 'admin';

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enqueue_admin_notifications_for_ai_action"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_audio_processing_job"("p_product_id" "uuid", "p_job_type" "text" DEFAULT 'generate_preview'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_product_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_job_type NOT IN ('generate_preview', 'reprocess_all') THEN
    RAISE EXCEPTION 'invalid_job_type';
  END IF;

  BEGIN
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    VALUES (p_product_id, p_job_type, 'queued');
    RETURN true;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN false;
  END;
END;
$$;


ALTER FUNCTION "public"."enqueue_audio_processing_job"("p_product_id" "uuid", "p_job_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_contract_generation_job"("p_purchase_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_existing_id uuid;
  v_inserted_id uuid;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'purchase_required';
  END IF;

  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_or_service_role_required';
  END IF;

  SELECT id
  INTO v_existing_id
  FROM public.contract_generation_jobs
  WHERE purchase_id = p_purchase_id
    AND status IN ('pending', 'processing')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  BEGIN
    INSERT INTO public.contract_generation_jobs (
      purchase_id,
      status,
      attempts,
      last_error,
      next_run_at,
      locked_at,
      locked_by
    )
    VALUES (
      p_purchase_id,
      'pending',
      0,
      NULL,
      now(),
      NULL,
      NULL
    )
    RETURNING id INTO v_inserted_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id
      INTO v_inserted_id
      FROM public.contract_generation_jobs
      WHERE purchase_id = p_purchase_id
        AND status IN ('pending', 'processing')
      ORDER BY created_at DESC
      LIMIT 1;
  END;

  RETURN v_inserted_id;
END;
$$;


ALTER FUNCTION "public"."enqueue_contract_generation_job"("p_purchase_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_product_preview_job"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.product_type <> 'beat'
     OR NEW.deleted_at IS NOT NULL
     OR NEW.is_published IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF coalesce(nullif(btrim(COALESCE(NEW.master_path, '')), ''), nullif(btrim(COALESCE(NEW.master_url, '')), '')) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.master_path IS DISTINCT FROM OLD.master_path
     OR NEW.master_url IS DISTINCT FROM OLD.master_url
     OR (OLD.is_published = false AND NEW.is_published = true)
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
    PERFORM public.enqueue_audio_processing_job(NEW.id, 'generate_preview');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enqueue_product_preview_job"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_reprocess_all_previews"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_enqueued_count integer := 0;
  v_skipped_count integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  WITH candidate_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
  ),
  inserted_jobs AS (
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    SELECT cp.id, 'generate_preview', 'queued'
    FROM candidate_products cp
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.audio_processing_jobs job
      WHERE job.product_id = cp.id
        AND job.job_type = 'generate_preview'
        AND job.status IN ('queued', 'processing')
    )
    ON CONFLICT DO NOTHING
    RETURNING product_id
  ),
  updated_products AS (
    UPDATE public.products p
    SET
      preview_version = GREATEST(COALESCE(p.preview_version, 1), 1) + 1,
      processing_status = 'pending',
      processing_error = NULL,
      processed_at = NULL
    FROM inserted_jobs ij
    WHERE p.id = ij.product_id
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_enqueued_count
  FROM updated_products;

  WITH candidate_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
  )
  SELECT GREATEST(COUNT(*) - v_enqueued_count, 0)::integer
  INTO v_skipped_count
  FROM candidate_products;

  RETURN jsonb_build_object(
    'enqueued_count', v_enqueued_count,
    'skipped_count', v_skipped_count
  );
END;
$$;


ALTER FUNCTION "public"."enqueue_reprocess_all_previews"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_reputation" (
    "user_id" "uuid" NOT NULL,
    "xp" bigint DEFAULT 0 NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "rank_tier" "text" DEFAULT 'bronze'::"text" NOT NULL,
    "forum_xp" bigint DEFAULT 0 NOT NULL,
    "battle_xp" bigint DEFAULT 0 NOT NULL,
    "commerce_xp" bigint DEFAULT 0 NOT NULL,
    "reputation_score" numeric DEFAULT 0 NOT NULL,
    "last_event_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_reputation_level_check" CHECK (("level" >= 1)),
    CONSTRAINT "user_reputation_rank_tier_check" CHECK (("rank_tier" = ANY (ARRAY['bronze'::"text", 'silver'::"text", 'gold'::"text", 'platinum'::"text", 'diamond'::"text"])))
);


ALTER TABLE "public"."user_reputation" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_user_reputation_row"("p_user_id" "uuid") RETURNS "public"."user_reputation"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row public.user_reputation%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  INSERT INTO public.user_reputation (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.user_reputation
  WHERE user_id = p_user_id;

  RETURN v_row;
END;
$$;


ALTER FUNCTION "public"."ensure_user_reputation_row"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_battle"("p_battle_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_is_admin_actor boolean := public.is_admin(v_actor);
  v_battle public.battles%ROWTYPE;
  v_winner_id uuid;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR v_is_admin_actor
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'finalize_battle') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role,
        'is_admin_actor', v_is_admin_actor
      ),
      p_extra_details => jsonb_build_object('message', 'rate_limit_exceeded'),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status = 'cancelled' THEN
    RAISE EXCEPTION 'battle_cancelled';
  END IF;

  IF v_battle.status = 'completed' THEN
    IF v_is_admin_actor THEN
      INSERT INTO public.ai_admin_actions (
        action_type,
        entity_type,
        entity_id,
        ai_decision,
        confidence_score,
        reason,
        status,
        human_override,
        reversible,
        executed_at,
        executed_by,
        error
      )
      VALUES (
        'battle_finalize_admin',
        'battle',
        p_battle_id,
        jsonb_build_object(
          'source', 'finalize_battle',
          'noop', true,
          'already_completed', true,
          'winner_id', v_battle.winner_id,
          'actor', v_actor
        ),
        1.0,
        'Battle already completed (admin finalize noop)',
        'executed',
        false,
        true,
        now(),
        v_actor,
        NULL
      );
    END IF;

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_battle',
      p_entity_type => 'battle',
      p_entity_id => p_battle_id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'status_before', v_battle.status,
        'status_after', v_battle.status,
        'jwt_role', v_jwt_role,
        'is_admin_actor', v_is_admin_actor,
        'noop', true
      ),
      p_extra_details => jsonb_build_object('winner_id', v_battle.winner_id),
      p_success => true,
      p_error => NULL
    );

    RETURN v_battle.winner_id;
  END IF;

  IF v_battle.status NOT IN ('active', 'voting') THEN
    RAISE EXCEPTION 'battle_not_open_for_finalization';
  END IF;

  IF v_battle.votes_producer1 > v_battle.votes_producer2 THEN
    v_winner_id := v_battle.producer1_id;
  ELSIF v_battle.votes_producer2 > v_battle.votes_producer1 THEN
    v_winner_id := v_battle.producer2_id;
  ELSE
    v_winner_id := NULL;
  END IF;

  UPDATE public.battles
  SET status = 'completed',
      winner_id = v_winner_id,
      voting_ends_at = COALESCE(voting_ends_at, now()),
      updated_at = now()
  WHERE id = p_battle_id;

  UPDATE public.user_profiles
  SET battles_completed = COALESCE(battles_completed, 0) + 1,
      updated_at = now()
  WHERE id IN (v_battle.producer1_id, v_battle.producer2_id);

  PERFORM public.recalculate_engagement(v_battle.producer1_id);
  IF v_battle.producer2_id IS NOT NULL THEN
    PERFORM public.recalculate_engagement(v_battle.producer2_id);
  END IF;

  IF v_is_admin_actor THEN
    INSERT INTO public.ai_admin_actions (
      action_type,
      entity_type,
      entity_id,
      ai_decision,
      confidence_score,
      reason,
      status,
      human_override,
      reversible,
      executed_at,
      executed_by,
      error
    )
    VALUES (
      'battle_finalize_admin',
      'battle',
      p_battle_id,
      jsonb_build_object(
        'source', 'finalize_battle',
        'noop', false,
        'status_before', v_battle.status,
        'status_after', 'completed',
        'winner_id', v_winner_id,
        'votes_producer1', v_battle.votes_producer1,
        'votes_producer2', v_battle.votes_producer2,
        'actor', v_actor
      ),
      1.0,
      'Battle finalized by admin',
      'executed',
      false,
      true,
      now(),
      v_actor,
      NULL
    );
  END IF;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'finalize_battle',
    p_entity_type => 'battle',
    p_entity_id => p_battle_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'status_before', v_battle.status,
      'status_after', 'completed',
      'jwt_role', v_jwt_role,
      'is_admin_actor', v_is_admin_actor,
      'noop', false
    ),
    p_extra_details => jsonb_build_object(
      'winner_id', v_winner_id,
      'votes_producer1', v_battle.votes_producer1,
      'votes_producer2', v_battle.votes_producer2
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_winner_id;
END;
$$;


ALTER FUNCTION "public"."finalize_battle"("p_battle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_expired_battles"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_row record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_count integer := 0;
BEGIN
  IF NOT (
    v_jwt_role = 'service_role'
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'finalize_expired_battles') THEN
    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'finalize_expired_battles',
      p_entity_type => 'other',
      p_entity_id => NULL,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'guard', 'rate_limit',
        'jwt_role', v_jwt_role
      ),
      p_extra_details => jsonb_build_object(
        'limit', v_limit,
        'message', 'rate_limit_exceeded'
      ),
      p_success => false,
      p_error => 'rate_limit_exceeded'
    );
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  FOR v_row IN
    SELECT b.id
    FROM public.battles b
    WHERE b.status IN ('active', 'voting')
      AND b.voting_ends_at IS NOT NULL
      AND b.voting_ends_at <= now()
    ORDER BY b.voting_ends_at ASC
    LIMIT v_limit
  LOOP
    PERFORM public.finalize_battle(v_row.id);
    v_count := v_count + 1;
  END LOOP;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'finalize_expired_battles',
    p_entity_type => 'other',
    p_entity_id => NULL,
    p_source => 'rpc',
    p_context => jsonb_build_object('jwt_role', v_jwt_role),
    p_extra_details => jsonb_build_object(
      'limit', v_limit,
      'finalized_count', v_count
    ),
    p_success => true,
    p_error => NULL
  );

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."finalize_expired_battles"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_battle_insert_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."force_battle_insert_timestamps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_reprocess_all_previews"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_enqueued_count integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  WITH eligible_products AS (
    SELECT p.id
    FROM public.products p
    WHERE p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
      AND COALESCE(
        NULLIF(btrim(COALESCE(p.master_path, '')), ''),
        NULLIF(btrim(COALESCE(p.master_url, '')), '')
      ) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.audio_processing_jobs job
        WHERE job.product_id = p.id
          AND job.job_type = 'generate_preview'
          AND job.status IN ('queued', 'processing')
      )
  ),
  updated_products AS (
    UPDATE public.products p
    SET
      preview_version = GREATEST(COALESCE(p.preview_version, 1), 1) + 1,
      processing_status = 'pending',
      processing_error = NULL,
      processed_at = NULL
    FROM eligible_products eligible
    WHERE p.id = eligible.id
    RETURNING p.id
  ),
  inserted_jobs AS (
    INSERT INTO public.audio_processing_jobs (product_id, job_type, status)
    SELECT updated_products.id, 'generate_preview', 'queued'
    FROM updated_products
    RETURNING id
  )
  SELECT COUNT(*) INTO v_enqueued_count
  FROM inserted_jobs;

  RETURN jsonb_build_object(
    'enqueued_count', v_enqueued_count
  );
END;
$$;


ALTER FUNCTION "public"."force_reprocess_all_previews"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."format_watermark_gain_db"("p_gain_db" numeric) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT trim(to_char(COALESCE(p_gain_db, 0), 'FM999999999990.00'));
$$;


ALTER FUNCTION "public"."format_watermark_gain_db"("p_gain_db" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_admin_delete_category"("p_category_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_category public.forum_categories%ROWTYPE;
  v_topic_count integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT *
  INTO v_category
  FROM public.forum_categories
  WHERE id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  SELECT count(*)::integer
  INTO v_topic_count
  FROM public.forum_topics
  WHERE category_id = p_category_id;

  IF v_topic_count > 0 THEN
    RAISE EXCEPTION 'category_has_topics';
  END IF;

  DELETE FROM public.forum_categories
  WHERE id = p_category_id;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => v_actor,
    p_action_type => 'forum_category_delete',
    p_entity_type => 'forum_category',
    p_entity_id => p_category_id,
    p_source => 'rpc',
    p_context => jsonb_build_object(
      'slug', v_category.slug,
      'name', v_category.name
    ),
    p_extra_details => '{}'::jsonb,
    p_success => true,
    p_error => NULL
  );

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."forum_admin_delete_category"("p_category_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "edited_at" timestamp with time zone,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "moderation_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "is_flagged" boolean DEFAULT false NOT NULL,
    "moderation_score" numeric(5,4),
    "moderation_reason" "text",
    "moderated_at" timestamp with time zone,
    "moderation_model" "text",
    "is_ai_generated" boolean DEFAULT false NOT NULL,
    "ai_agent_name" "text",
    "source_post_id" "uuid",
    CONSTRAINT "forum_posts_content_check" CHECK (("btrim"("content") <> ''::"text")),
    CONSTRAINT "forum_posts_moderation_status_check" CHECK (("moderation_status" = ANY (ARRAY['pending'::"text", 'allowed'::"text", 'review'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."forum_posts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_admin_set_post_state"("p_post_id" "uuid", "p_action" "text") RETURNS "public"."forum_posts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_post public.forum_posts%ROWTYPE;
  v_action text := lower(COALESCE(p_action, ''));
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT *
  INTO v_post
  FROM public.forum_posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  IF v_action = 'approve' THEN
    UPDATE public.forum_posts
    SET
      is_deleted = false,
      is_visible = true,
      is_flagged = false,
      moderation_status = 'allowed',
      moderation_reason = 'approved_by_admin',
      moderated_at = now()
    WHERE id = p_post_id
    RETURNING * INTO v_post;
  ELSIF v_action = 'block' THEN
    UPDATE public.forum_posts
    SET
      is_visible = false,
      is_flagged = true,
      moderation_status = 'blocked',
      moderation_reason = 'blocked_by_admin',
      moderated_at = now()
    WHERE id = p_post_id
    RETURNING * INTO v_post;
  ELSIF v_action = 'delete' THEN
    UPDATE public.forum_posts
    SET
      is_deleted = true,
      is_visible = true,
      is_flagged = true,
      moderation_status = CASE
        WHEN moderation_status = 'allowed' THEN 'blocked'
        ELSE moderation_status
      END,
      moderation_reason = 'deleted_by_admin',
      moderated_at = now()
    WHERE id = p_post_id
    RETURNING * INTO v_post;
  ELSIF v_action = 'restore' THEN
    UPDATE public.forum_posts
    SET
      is_deleted = false,
      is_visible = true,
      is_flagged = false,
      moderation_status = 'allowed',
      moderation_reason = 'restored_by_admin',
      moderated_at = now()
    WHERE id = p_post_id
    RETURNING * INTO v_post;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;

  INSERT INTO public.forum_moderation_logs (
    post_id,
    topic_id,
    source,
    model,
    decision,
    reason,
    reviewed_by,
    reviewed_at,
    raw_response
  )
  VALUES (
    v_post.id,
    v_post.topic_id,
    'forum_admin',
    'human',
    v_action,
    COALESCE(v_post.moderation_reason, v_action),
    v_actor,
    now(),
    jsonb_build_object('action', v_action)
  );

  RETURN v_post;
END;
$$;


ALTER FUNCTION "public"."forum_admin_set_post_state"("p_post_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_post_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "post_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "last_ai_reply_at" timestamp with time zone,
    CONSTRAINT "forum_topics_post_count_check" CHECK (("post_count" >= 0)),
    CONSTRAINT "forum_topics_slug_check" CHECK (("btrim"("slug") <> ''::"text")),
    CONSTRAINT "forum_topics_title_check" CHECK (("btrim"("title") <> ''::"text"))
);


ALTER TABLE "public"."forum_topics" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_admin_set_topic_deleted"("p_topic_id" "uuid", "p_is_deleted" boolean) RETURNS "public"."forum_topics"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_topic public.forum_topics%ROWTYPE;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  UPDATE public.forum_topics
  SET
    is_deleted = COALESCE(p_is_deleted, true),
    deleted_at = CASE WHEN COALESCE(p_is_deleted, true) THEN now() ELSE NULL END,
    deleted_by = CASE WHEN COALESCE(p_is_deleted, true) THEN v_actor ELSE NULL END
  WHERE id = p_topic_id
  RETURNING * INTO v_topic;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic_not_found';
  END IF;

  INSERT INTO public.forum_moderation_logs (
    post_id,
    topic_id,
    source,
    model,
    decision,
    reason,
    reviewed_by,
    reviewed_at,
    raw_response
  )
  VALUES (
    NULL,
    v_topic.id,
    'forum_admin',
    'human',
    CASE WHEN COALESCE(p_is_deleted, true) THEN 'topic_delete' ELSE 'topic_restore' END,
    CASE WHEN COALESCE(p_is_deleted, true) THEN 'topic_deleted_by_admin' ELSE 'topic_restored_by_admin' END,
    v_actor,
    now(),
    jsonb_build_object('is_deleted', COALESCE(p_is_deleted, true))
  );

  RETURN v_topic;
END;
$$;


ALTER FUNCTION "public"."forum_admin_set_topic_deleted"("p_topic_id" "uuid", "p_is_deleted" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_admin_upsert_category"("p_category_id" "uuid" DEFAULT NULL::"uuid", "p_name" "text" DEFAULT NULL::"text", "p_slug" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text", "p_position" integer DEFAULT NULL::integer, "p_is_premium_only" boolean DEFAULT false, "p_xp_multiplier" numeric DEFAULT 1, "p_moderation_strictness" "text" DEFAULT 'normal'::"text", "p_is_competitive" boolean DEFAULT false, "p_required_rank_tier" "text" DEFAULT NULL::"text", "p_allow_links" boolean DEFAULT true, "p_allow_media" boolean DEFAULT true) RETURNS TABLE("id" "uuid", "name" "text", "slug" "text", "description" "text", "is_premium_only" boolean, "position" integer, "xp_multiplier" numeric, "moderation_strictness" "text", "is_competitive" boolean, "required_rank_tier" "text", "allow_links" boolean, "allow_media" boolean, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_row public.forum_categories%ROWTYPE;
  v_effective_slug text := COALESCE(NULLIF(btrim(COALESCE(p_slug, '')), ''), NULLIF(btrim(COALESCE(p_name, '')), ''));
  v_effective_position integer := COALESCE(
    p_position,
    (SELECT COALESCE(max(fc.position), -1) + 1 FROM public.forum_categories fc)
  );
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  IF v_effective_slug IS NULL OR btrim(v_effective_slug) = '' THEN
    RAISE EXCEPTION 'slug_required';
  END IF;

  IF p_moderation_strictness NOT IN ('low', 'normal', 'high') THEN
    RAISE EXCEPTION 'invalid_moderation_strictness';
  END IF;

  IF p_required_rank_tier IS NOT NULL AND p_required_rank_tier NOT IN ('bronze', 'silver', 'gold', 'platinum', 'diamond') THEN
    RAISE EXCEPTION 'invalid_required_rank_tier';
  END IF;

  IF p_category_id IS NULL THEN
    INSERT INTO public.forum_categories (
      name,
      slug,
      description,
      position,
      is_premium_only,
      xp_multiplier,
      moderation_strictness,
      is_competitive,
      required_rank_tier,
      allow_links,
      allow_media
    )
    VALUES (
      btrim(p_name),
      btrim(v_effective_slug),
      NULLIF(btrim(COALESCE(p_description, '')), ''),
      GREATEST(0, v_effective_position),
      COALESCE(p_is_premium_only, false),
      GREATEST(COALESCE(p_xp_multiplier, 1), 0.1),
      p_moderation_strictness,
      COALESCE(p_is_competitive, false),
      p_required_rank_tier,
      COALESCE(p_allow_links, true),
      COALESCE(p_allow_media, true)
    )
    RETURNING * INTO v_row;

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'forum_category_create',
      p_entity_type => 'forum_category',
      p_entity_id => v_row.id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'slug', v_row.slug,
        'name', v_row.name
      ),
      p_extra_details => jsonb_build_object(
        'is_premium_only', v_row.is_premium_only,
        'is_competitive', v_row.is_competitive,
        'required_rank_tier', v_row.required_rank_tier,
        'xp_multiplier', v_row.xp_multiplier,
        'moderation_strictness', v_row.moderation_strictness,
        'allow_links', v_row.allow_links,
        'allow_media', v_row.allow_media
      ),
      p_success => true,
      p_error => NULL
    );
  ELSE
    UPDATE public.forum_categories
    SET name = btrim(p_name),
        slug = btrim(v_effective_slug),
        description = NULLIF(btrim(COALESCE(p_description, '')), ''),
        position = GREATEST(0, v_effective_position),
        is_premium_only = COALESCE(p_is_premium_only, false),
        xp_multiplier = GREATEST(COALESCE(p_xp_multiplier, 1), 0.1),
        moderation_strictness = p_moderation_strictness,
        is_competitive = COALESCE(p_is_competitive, false),
        required_rank_tier = p_required_rank_tier,
        allow_links = COALESCE(p_allow_links, true),
        allow_media = COALESCE(p_allow_media, true)
    WHERE id = p_category_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'category_not_found';
    END IF;

    PERFORM public.log_admin_action_audit(
      p_admin_user_id => v_actor,
      p_action_type => 'forum_category_update',
      p_entity_type => 'forum_category',
      p_entity_id => v_row.id,
      p_source => 'rpc',
      p_context => jsonb_build_object(
        'slug', v_row.slug,
        'name', v_row.name
      ),
      p_extra_details => jsonb_build_object(
        'is_premium_only', v_row.is_premium_only,
        'is_competitive', v_row.is_competitive,
        'required_rank_tier', v_row.required_rank_tier,
        'xp_multiplier', v_row.xp_multiplier,
        'moderation_strictness', v_row.moderation_strictness,
        'allow_links', v_row.allow_links,
        'allow_media', v_row.allow_media
      ),
      p_success => true,
      p_error => NULL
    );
  END IF;

  RETURN QUERY
  SELECT
    v_row.id,
    v_row.name,
    v_row.slug,
    v_row.description,
    v_row.is_premium_only,
    v_row.position AS "position",
    v_row.xp_multiplier,
    v_row.moderation_strictness,
    v_row.is_competitive,
    v_row.required_rank_tier,
    v_row.allow_links,
    v_row.allow_media,
    v_row.created_at;
END;
$$;


ALTER FUNCTION "public"."forum_admin_upsert_category"("p_category_id" "uuid", "p_name" "text", "p_slug" "text", "p_description" "text", "p_position" integer, "p_is_premium_only" boolean, "p_xp_multiplier" numeric, "p_moderation_strictness" "text", "p_is_competitive" boolean, "p_required_rank_tier" "text", "p_allow_links" boolean, "p_allow_media" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_can_access_category"("p_category_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.forum_categories fc
    WHERE fc.id = p_category_id
      AND (
        fc.is_premium_only = false
        OR public.forum_has_active_subscription(p_user_id)
      )
      AND public.forum_user_meets_rank_requirement(p_user_id, fc.required_rank_tier)
  );
$$;


ALTER FUNCTION "public"."forum_can_access_category"("p_category_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_can_write_topic"("p_topic_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.forum_topics ft
    JOIN public.forum_categories fc ON fc.id = ft.category_id
    WHERE ft.id = p_topic_id
      AND COALESCE(ft.is_deleted, false) = false
      AND ft.is_locked = false
      AND (
        fc.is_premium_only = false
        OR public.forum_has_active_subscription(p_user_id)
      )
      AND public.forum_user_meets_rank_requirement(p_user_id, fc.required_rank_tier)
  );
$$;


ALTER FUNCTION "public"."forum_can_write_topic"("p_topic_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_get_user_rank_tier"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 'bronze'
    WHEN public.is_admin(p_user_id) THEN 'diamond'
    WHEN public.forum_is_assistant_user(p_user_id) THEN 'diamond'
    ELSE COALESCE((
      SELECT ur.rank_tier
      FROM public.user_reputation ur
      WHERE ur.user_id = p_user_id
      LIMIT 1
    ), 'bronze')
  END;
$$;


ALTER FUNCTION "public"."forum_get_user_rank_tier"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_has_active_subscription"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    CASE
      WHEN p_user_id IS NULL THEN false
      WHEN public.is_admin(p_user_id) THEN true
      WHEN public.forum_is_assistant_user(p_user_id) THEN true
      ELSE EXISTS (
        SELECT 1
        FROM public.producer_subscriptions ps
        WHERE ps.user_id = p_user_id
          AND ps.subscription_status IN ('active', 'trialing')
          AND ps.current_period_end > now()
      )
    END;
$$;


ALTER FUNCTION "public"."forum_has_active_subscription"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_is_assistant_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_settings s
    WHERE s.key = 'forum_assistant_settings'
      AND NULLIF(s.value->>'assistant_user_id', '') IS NOT NULL
      AND (s.value->>'assistant_user_id')::uuid = p_user_id
  );
$$;


ALTER FUNCTION "public"."forum_is_assistant_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."forum_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forum_user_meets_rank_requirement"("p_user_id" "uuid" DEFAULT "auth"."uid"(), "p_required_rank_tier" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_required_rank_tier, '')), '') IS NULL THEN true
    WHEN p_user_id IS NULL THEN false
    WHEN public.is_admin(p_user_id) THEN true
    WHEN public.forum_is_assistant_user(p_user_id) THEN true
    ELSE public.reputation_rank_tier_value(public.forum_get_user_rank_tier(p_user_id))
      >= public.reputation_rank_tier_value(p_required_rank_tier)
  END;
$$;


ALTER FUNCTION "public"."forum_user_meets_rank_requirement"("p_user_id" "uuid", "p_required_rank_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_battle_slug"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 1;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug != '' THEN
    IF TG_OP = 'UPDATE' AND NEW.title = OLD.title THEN
      RETURN NEW;
    END IF;
  END IF;
  
  base_slug := lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  
  WHILE EXISTS (SELECT 1 FROM battles WHERE slug = final_slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) LOOP
    final_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_battle_slug"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_product_slug"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 1;
BEGIN
  -- Only generate slug if it's null or empty, or if title changed on update
  IF NEW.slug IS NOT NULL AND NEW.slug != '' THEN
    IF TG_OP = 'UPDATE' AND NEW.title = OLD.title THEN
      RETURN NEW;
    END IF;
  END IF;
  
  -- Generate base slug from title
  base_slug := lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  
  -- Check for uniqueness and add counter if needed
  WHILE EXISTS (SELECT 1 FROM products WHERE slug = final_slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) LOOP
    final_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_product_slug"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_season"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT cs.id
  FROM public.competitive_seasons cs
  WHERE cs.is_active = true
  ORDER BY cs.start_date DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_active_season"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_season_details"() RETURNS TABLE("id" "uuid", "name" "text", "start_date" timestamp with time zone, "end_date" timestamp with time zone, "is_active" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT cs.id, cs.name, cs.start_date, cs.end_date, cs.is_active
  FROM public.competitive_seasons cs
  WHERE cs.is_active = true
  ORDER BY cs.start_date DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_active_season_details"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_business_metrics"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_total_users bigint := 0;
  v_active_producers bigint := 0;
  v_active_producers_with_publication bigint := 0;
  v_published_beats bigint := 0;
  v_completed_purchases bigint := 0;
  v_monthly_revenue_cents bigint := 0;
  v_producer_publication_rate_pct numeric(12,2) := 0;
  v_beats_conversion_rate_pct numeric(12,2) := 0;
  v_arpu_cents bigint := 0;
  v_active_producer_ratio_pct numeric(12,2) := 0;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_total_users
  FROM public.user_profiles;

  SELECT COUNT(*)::bigint
  INTO v_active_producers
  FROM public.user_profiles
  WHERE is_producer_active = true;

  SELECT COUNT(DISTINCT p.producer_id)::bigint
  INTO v_active_producers_with_publication
  FROM public.products p
  JOIN public.user_profiles up ON up.id = p.producer_id
  WHERE up.is_producer_active = true
    AND p.product_type = 'beat'
    AND p.is_published = true
    AND p.deleted_at IS NULL;

  SELECT COUNT(*)::bigint
  INTO v_published_beats
  FROM public.products
  WHERE product_type = 'beat'
    AND is_published = true
    AND deleted_at IS NULL;

  SELECT COUNT(*)::bigint
  INTO v_completed_purchases
  FROM public.purchases
  WHERE status = 'completed';

  SELECT COALESCE(SUM(amount), 0)::bigint
  INTO v_monthly_revenue_cents
  FROM public.purchases
  WHERE status = 'completed'
    AND created_at >= date_trunc('month', now())
    AND created_at < date_trunc('month', now()) + interval '1 month';

  IF v_active_producers > 0 THEN
    v_producer_publication_rate_pct := ROUND(
      (v_active_producers_with_publication::numeric / v_active_producers::numeric) * 100.0,
      2
    );
  END IF;

  IF v_published_beats > 0 THEN
    v_beats_conversion_rate_pct := ROUND(
      (v_completed_purchases::numeric / v_published_beats::numeric) * 100.0,
      2
    );
  END IF;

  IF v_total_users > 0 THEN
    v_arpu_cents := ROUND(v_monthly_revenue_cents::numeric / v_total_users::numeric)::bigint;
    v_active_producer_ratio_pct := ROUND(
      (v_active_producers::numeric / v_total_users::numeric) * 100.0,
      2
    );
  END IF;

  RETURN jsonb_build_object(
    'producer_publication_rate_pct', v_producer_publication_rate_pct,
    'beats_conversion_rate_pct', v_beats_conversion_rate_pct,
    'arpu_cents', v_arpu_cents,
    'active_producer_ratio_pct', v_active_producer_ratio_pct
  );
END;
$$;


ALTER FUNCTION "public"."get_admin_business_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_metrics_timeseries"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_users_30d jsonb := '[]'::jsonb;
  v_revenue_30d jsonb := '[]'::jsonb;
  v_beats_30d jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH days AS (
    SELECT generate_series(
      (current_date - interval '29 days')::date,
      current_date::date,
      interval '1 day'
    )::date AS day
  ),
  users_daily AS (
    SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS value
    FROM public.user_profiles
    WHERE created_at >= (current_date - interval '29 days')
    GROUP BY 1
  ),
  revenue_daily AS (
    SELECT date_trunc('day', created_at)::date AS day, COALESCE(SUM(amount), 0)::bigint AS value
    FROM public.purchases
    WHERE status = 'completed'
      AND created_at >= (current_date - interval '29 days')
    GROUP BY 1
  ),
  beats_daily AS (
    SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS value
    FROM public.products
    WHERE product_type = 'beat'
      AND is_published = true
      AND deleted_at IS NULL
      AND created_at >= (current_date - interval '29 days')
    GROUP BY 1
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(d.day, 'YYYY-MM-DD'),
          'value', COALESCE(u.value, 0)
        )
        ORDER BY d.day
      ),
      '[]'::jsonb
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(d.day, 'YYYY-MM-DD'),
          'value', COALESCE(r.value, 0)
        )
        ORDER BY d.day
      ),
      '[]'::jsonb
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(d.day, 'YYYY-MM-DD'),
          'value', COALESCE(b.value, 0)
        )
        ORDER BY d.day
      ),
      '[]'::jsonb
    )
  INTO v_users_30d, v_revenue_30d, v_beats_30d
  FROM days d
  LEFT JOIN users_daily u ON u.day = d.day
  LEFT JOIN revenue_daily r ON r.day = d.day
  LEFT JOIN beats_daily b ON b.day = d.day;

  RETURN jsonb_build_object(
    'users_30d', v_users_30d,
    'revenue_30d', v_revenue_30d,
    'beats_30d', v_beats_30d
  );
END;
$$;


ALTER FUNCTION "public"."get_admin_metrics_timeseries"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_pilotage_deltas"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_users_current bigint := 0;
  v_users_previous bigint := 0;
  v_revenue_current bigint := 0;
  v_revenue_previous bigint := 0;
  v_beats_current bigint := 0;
  v_beats_previous bigint := 0;
  v_users_growth_30d_pct numeric(12,2) := NULL;
  v_revenue_growth_30d_pct numeric(12,2) := NULL;
  v_beats_growth_30d_pct numeric(12,2) := NULL;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_users_current
  FROM public.user_profiles
  WHERE created_at >= now() - interval '30 days';

  SELECT COUNT(*)::bigint
  INTO v_users_previous
  FROM public.user_profiles
  WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days';

  SELECT COALESCE(SUM(amount), 0)::bigint
  INTO v_revenue_current
  FROM public.purchases
  WHERE status = 'completed'
    AND created_at >= now() - interval '30 days';

  SELECT COALESCE(SUM(amount), 0)::bigint
  INTO v_revenue_previous
  FROM public.purchases
  WHERE status = 'completed'
    AND created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days';

  SELECT COUNT(*)::bigint
  INTO v_beats_current
  FROM public.products
  WHERE product_type = 'beat'
    AND is_published = true
    AND deleted_at IS NULL
    AND created_at >= now() - interval '30 days';

  SELECT COUNT(*)::bigint
  INTO v_beats_previous
  FROM public.products
  WHERE product_type = 'beat'
    AND is_published = true
    AND deleted_at IS NULL
    AND created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days';

  IF v_users_previous > 0 THEN
    v_users_growth_30d_pct := ROUND(
      ((v_users_current::numeric - v_users_previous::numeric) / v_users_previous::numeric) * 100.0,
      2
    );
  END IF;

  IF v_revenue_previous > 0 THEN
    v_revenue_growth_30d_pct := ROUND(
      ((v_revenue_current::numeric - v_revenue_previous::numeric) / v_revenue_previous::numeric) * 100.0,
      2
    );
  END IF;

  IF v_beats_previous > 0 THEN
    v_beats_growth_30d_pct := ROUND(
      ((v_beats_current::numeric - v_beats_previous::numeric) / v_beats_previous::numeric) * 100.0,
      2
    );
  END IF;

  RETURN jsonb_build_object(
    'users_growth_30d_pct', v_users_growth_30d_pct,
    'revenue_growth_30d_pct', v_revenue_growth_30d_pct,
    'beats_growth_30d_pct', v_beats_growth_30d_pct
  );
END;
$$;


ALTER FUNCTION "public"."get_admin_pilotage_deltas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_pilotage_metrics"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_actor uuid := auth.uid();
  v_total_users bigint := 0;
  v_active_producers bigint := 0;
  v_published_beats bigint := 0;
  v_active_battles bigint := 0;
  v_monthly_revenue_beats_cents bigint := 0;
  v_subscription_mrr_estimate_cents bigint := 0;
  v_confirmed_signup_rate_pct numeric(12,2) := 0;
  v_user_growth_30d_pct numeric(12,2) := NULL;
  v_current_30d_users bigint := 0;
  v_previous_30d_users bigint := 0;
  v_month_start timestamptz := date_trunc('month', now());
  v_month_end timestamptz := date_trunc('month', now()) + interval '1 month';

  v_new_subscriptions_30d bigint := 0;
  v_churned_subscriptions_30d bigint := 0;
  v_net_subscriptions_growth_30d bigint := 0;
  v_has_stripe_events boolean := false;
  v_has_processed_column boolean := false;
  v_has_processed_at_column boolean := false;
  v_has_payload_column boolean := false;
  v_has_data_column boolean := false;
  v_event_json_column text := NULL;
  v_processed_filter_sql text := '';
  v_subscription_kpi_sql text := '';
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin(v_actor) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_total_users
  FROM public.user_profiles;

  SELECT COUNT(*)::bigint
  INTO v_active_producers
  FROM public.user_profiles
  WHERE is_producer_active = true;

  SELECT COUNT(*)::bigint
  INTO v_published_beats
  FROM public.products
  WHERE product_type = 'beat'
    AND is_published = true
    AND deleted_at IS NULL;

  SELECT COUNT(*)::bigint
  INTO v_active_battles
  FROM public.battles
  WHERE status IN ('active', 'voting');

  SELECT COALESCE(SUM(p.amount), 0)::bigint
  INTO v_monthly_revenue_beats_cents
  FROM public.purchases p
  WHERE p.status = 'completed'
    AND p.created_at >= v_month_start
    AND p.created_at < v_month_end;

  IF to_regclass('public.producer_subscriptions') IS NOT NULL
     AND to_regclass('public.producer_plans') IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(pp.amount_cents, 0)), 0)::bigint
    INTO v_subscription_mrr_estimate_cents
    FROM public.producer_subscriptions ps
    JOIN public.user_profiles up
      ON up.id = ps.user_id
    JOIN public.producer_plans pp
      ON pp.tier = up.producer_tier
    WHERE ps.is_producer_active = true
      AND ps.current_period_end > now()
      AND ps.subscription_status IN ('active', 'trialing', 'past_due', 'unpaid')
      AND pp.is_active = true;
  ELSE
    v_subscription_mrr_estimate_cents := 0;
  END IF;

  IF v_total_users > 0 THEN
    SELECT ROUND(
      100.0 * SUM(CASE WHEN COALESCE(up.is_confirmed, false) THEN 1 ELSE 0 END)::numeric
      / v_total_users::numeric,
      2
    )
    INTO v_confirmed_signup_rate_pct
    FROM public.user_profiles up;
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_current_30d_users
  FROM public.user_profiles up
  WHERE up.created_at >= now() - interval '30 days';

  SELECT COUNT(*)::bigint
  INTO v_previous_30d_users
  FROM public.user_profiles up
  WHERE up.created_at >= now() - interval '60 days'
    AND up.created_at < now() - interval '30 days';

  IF v_previous_30d_users > 0 THEN
    v_user_growth_30d_pct := ROUND(
      ((v_current_30d_users::numeric - v_previous_30d_users::numeric) / v_previous_30d_users::numeric) * 100.0,
      2
    );
  ELSE
    v_user_growth_30d_pct := NULL;
  END IF;

  SELECT to_regclass('public.stripe_events') IS NOT NULL
  INTO v_has_stripe_events;

  IF v_has_stripe_events THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stripe_events'
        AND column_name = 'processed'
    )
    INTO v_has_processed_column;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stripe_events'
        AND column_name = 'processed_at'
    )
    INTO v_has_processed_at_column;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stripe_events'
        AND column_name = 'payload'
    )
    INTO v_has_payload_column;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stripe_events'
        AND column_name = 'data'
    )
    INTO v_has_data_column;

    IF v_has_payload_column THEN
      v_event_json_column := 'payload';
    ELSIF v_has_data_column THEN
      v_event_json_column := 'data';
    END IF;

    IF v_has_processed_column THEN
      v_processed_filter_sql := 'WHERE processed = true';
    ELSIF v_has_processed_at_column THEN
      v_processed_filter_sql := 'WHERE processed_at IS NOT NULL';
    ELSE
      v_processed_filter_sql := '';
    END IF;

    IF v_event_json_column IS NOT NULL THEN
      v_subscription_kpi_sql := format(
        $sql$
        WITH subscription_events AS (
          SELECT
            type,
            COALESCE(
              CASE
                WHEN %1$I IS NOT NULL
                  AND jsonb_typeof(%1$I) = 'object'
                  AND (%1$I->>'created') ~ '^[0-9]+$'
                THEN to_timestamp((%1$I->>'created')::bigint)
                ELSE NULL
              END,
              created_at
            ) AS event_at
          FROM public.stripe_events
          %2$s
        )
        SELECT
          COALESCE(
            COUNT(*) FILTER (
              WHERE type = 'customer.subscription.created'
                AND event_at >= now() - interval '30 days'
            ),
            0
          )::bigint,
          COALESCE(
            COUNT(*) FILTER (
              WHERE type = 'customer.subscription.deleted'
                AND event_at >= now() - interval '30 days'
            ),
            0
          )::bigint
        FROM subscription_events
        $sql$,
        v_event_json_column,
        v_processed_filter_sql
      );
    ELSE
      v_subscription_kpi_sql := format(
        $sql$
        SELECT
          COALESCE(
            COUNT(*) FILTER (
              WHERE type = 'customer.subscription.created'
                AND created_at >= now() - interval '30 days'
            ),
            0
          )::bigint,
          COALESCE(
            COUNT(*) FILTER (
              WHERE type = 'customer.subscription.deleted'
                AND created_at >= now() - interval '30 days'
            ),
            0
          )::bigint
        FROM public.stripe_events
        %1$s
        $sql$,
        v_processed_filter_sql
      );
    END IF;

    EXECUTE v_subscription_kpi_sql
    INTO v_new_subscriptions_30d, v_churned_subscriptions_30d;
  END IF;

  v_net_subscriptions_growth_30d := COALESCE(v_new_subscriptions_30d, 0) - COALESCE(v_churned_subscriptions_30d, 0);

  RETURN jsonb_build_object(
    'total_users', v_total_users,
    'active_producers', v_active_producers,
    'published_beats', v_published_beats,
    'active_battles', v_active_battles,
    'monthly_revenue_beats_cents', v_monthly_revenue_beats_cents,
    'subscription_mrr_estimate_cents', v_subscription_mrr_estimate_cents,
    'confirmed_signup_rate_pct', v_confirmed_signup_rate_pct,
    'user_growth_30d_pct', v_user_growth_30d_pct,
    'new_subscriptions_30d', COALESCE(v_new_subscriptions_30d, 0),
    'churned_subscriptions_30d', COALESCE(v_churned_subscriptions_30d, 0),
    'net_subscriptions_growth_30d', COALESCE(v_net_subscriptions_growth_30d, 0)
  );
END;
$_$;


ALTER FUNCTION "public"."get_admin_pilotage_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_advanced_producer_stats"() RETURNS TABLE("published_beats" bigint, "completed_sales" bigint, "revenue_cents" bigint, "monthly_battles_created" bigint, "sales_per_published_beat" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_producer_tier(v_uid, 'producteur'::public.producer_tier_type) THEN
    RAISE EXCEPTION 'insufficient_tier' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH beats AS (
    SELECT count(*)::bigint AS published_beats
    FROM public.products p
    WHERE p.producer_id = v_uid
      AND p.product_type = 'beat'
      AND p.is_published = true
      AND p.deleted_at IS NULL
  ),
  sales AS (
    SELECT
      count(*)::bigint AS completed_sales,
      COALESCE(sum(pu.amount), 0)::bigint AS revenue_cents
    FROM public.purchases pu
    WHERE pu.producer_id = v_uid
      AND pu.status = 'completed'
  ),
  monthly_battles AS (
    SELECT count(*)::bigint AS monthly_battles_created
    FROM public.battles b
    WHERE b.producer1_id = v_uid
      AND b.created_at >= date_trunc('month', now())
      AND b.created_at < date_trunc('month', now()) + interval '1 month'
  )
  SELECT
    beats.published_beats,
    sales.completed_sales,
    sales.revenue_cents,
    monthly_battles.monthly_battles_created,
    CASE
      WHEN beats.published_beats > 0
      THEN round((sales.completed_sales::numeric / beats.published_beats::numeric), 4)
      ELSE 0::numeric
    END::numeric(10,4) AS sales_per_published_beat
  FROM beats, sales, monthly_battles;
END;
$$;


ALTER FUNCTION "public"."get_advanced_producer_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_battles_quota_status"() RETURNS TABLE("tier" "text", "used_this_month" bigint, "max_per_month" integer, "can_create" boolean, "reset_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tier_text text := 'user';
  v_allowed_tiers text[] := ARRAY['producteur', 'elite'];
  v_used bigint := 0;
  v_max integer := NULL;
  v_can_create boolean := false;
  v_month_start timestamptz := date_trunc('month', now());
  v_next_month_start timestamptz := date_trunc('month', now()) + interval '1 month';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(up.producer_tier::text, 'user')
  INTO v_tier_text
  FROM public.user_profiles up
  WHERE up.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_used
  FROM public.battles b
  WHERE b.producer1_id = v_uid
    AND b.created_at >= v_month_start
    AND b.created_at < v_next_month_start;

  IF v_tier_text = ANY (v_allowed_tiers) THEN
    SELECT pp.max_battles_created_per_month
    INTO v_max
    FROM public.producer_plans pp
    WHERE pp.tier::text = v_tier_text
      AND pp.is_active = true
    LIMIT 1;
  ELSE
    v_max := 0;
  END IF;

  IF v_tier_text = ANY (v_allowed_tiers) AND v_max IS NOT NULL THEN
    v_can_create := v_used < v_max;
  ELSE
    v_can_create := false;
  END IF;

  RETURN QUERY
  SELECT
    v_tier_text,
    v_used,
    v_max,
    v_can_create,
    v_next_month_start;
END;
$$;


ALTER FUNCTION "public"."get_battles_quota_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_forum_public_profiles"() RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "xp" bigint, "level" integer, "rank_tier" "text", "reputation_score" numeric, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    up.id AS user_id,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL;
$$;


ALTER FUNCTION "public"."get_forum_public_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_home_stats"() RETURNS json
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT json_build_object(
    'beats_published',
    (
      SELECT COUNT(*)
      FROM public.products p
      WHERE p.product_type = 'beat'
        AND p.is_published = true
        AND p.deleted_at IS NULL
    ),
    'active_producers',
    (
      SELECT COUNT(*)
      FROM public.user_profiles up
      WHERE up.is_producer_active = true
    ),
    'show_homepage_stats',
    COALESCE(
      (
        SELECT
          CASE
            WHEN jsonb_typeof(s.value -> 'enabled') = 'boolean' THEN (s.value ->> 'enabled')::boolean
            WHEN lower(COALESCE(s.value ->> 'enabled', '')) IN ('true', 'false') THEN (s.value ->> 'enabled')::boolean
            ELSE false
          END
        FROM public.app_settings s
        WHERE s.key = 'show_homepage_stats'
        LIMIT 1
      ),
      false
    )
  );
$$;


ALTER FUNCTION "public"."get_home_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_leaderboard_producers"() RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "elo_rating" integer, "battle_wins" integer, "battle_losses" integer, "battle_draws" integer, "total_battles" integer, "win_rate" numeric, "rank_position" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH base AS (
    SELECT
      up.id AS user_id,
      up.username,
      up.avatar_url,
      up.producer_tier,
      COALESCE(up.elo_rating, 1200) AS elo_rating,
      COALESCE(up.battle_wins, 0) AS battle_wins,
      COALESCE(up.battle_losses, 0) AS battle_losses,
      COALESCE(up.battle_draws, 0) AS battle_draws,
      (
        COALESCE(up.battle_wins, 0)
        + COALESCE(up.battle_losses, 0)
        + COALESCE(up.battle_draws, 0)
      )::integer AS total_battles
    FROM public.user_profiles up
    WHERE up.is_producer_active = true
      AND up.role IN ('producer', 'admin')
  )
  SELECT
    b.user_id,
    b.username,
    b.avatar_url,
    b.producer_tier,
    b.elo_rating,
    b.battle_wins,
    b.battle_losses,
    b.battle_draws,
    b.total_battles,
    CASE
      WHEN b.total_battles = 0 THEN 0::numeric
      ELSE round((b.battle_wins::numeric / b.total_battles::numeric) * 100, 2)
    END AS win_rate,
    row_number() OVER (
      ORDER BY
        b.elo_rating DESC,
        b.battle_wins DESC,
        b.battle_losses ASC,
        b.username ASC NULLS LAST,
        b.user_id ASC
    ) AS rank_position
  FROM base b;
$$;


ALTER FUNCTION "public"."get_leaderboard_producers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_matchmaking_opponents"() RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "elo_rating" integer, "battle_wins" integer, "battle_losses" integer, "battle_draws" integer, "elo_diff" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.suggest_opponents(v_uid);
END;
$$;


ALTER FUNCTION "public"."get_matchmaking_opponents"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_plan_limits"("p_tier" "public"."producer_tier_type") RETURNS TABLE("max_beats_published" integer, "max_battles_created_per_month" integer, "commission_rate" numeric, "stripe_price_id" "text", "is_active" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    pp.max_beats_published,
    pp.max_battles_created_per_month,
    pp.commission_rate,
    pp.stripe_price_id,
    pp.is_active
  FROM public.producer_plans pp
  WHERE pp.tier = p_tier
    AND pp.is_active = true
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_plan_limits"("p_tier" "public"."producer_tier_type") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_producer_tier"("p_user_id" "uuid") RETURNS "public"."producer_tier_type"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_tier public.producer_tier_type;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT up.producer_tier
  INTO v_tier
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  RETURN v_tier;
END;
$$;


ALTER FUNCTION "public"."get_producer_tier"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_producer_profiles"() RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "bio" "text", "social_links" "jsonb", "xp" bigint, "level" integer, "rank_tier" "text", "reputation_score" numeric, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    up.id AS user_id,
    public.get_public_profile_label(up) AS username,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.avatar_url
    END AS avatar_url,
    up.producer_tier,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN NULL
      ELSE up.bio
    END AS bio,
    CASE
      WHEN COALESCE(up.is_deleted, false) = true OR up.deleted_at IS NOT NULL THEN '{}'::jsonb
      ELSE COALESCE(up.social_links, '{}'::jsonb)
    END AS social_links,
    COALESCE(ur.xp, 0) AS xp,
    COALESCE(ur.level, 1) AS level,
    COALESCE(ur.rank_tier, 'bronze') AS rank_tier,
    COALESCE(ur.reputation_score, 0) AS reputation_score,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  LEFT JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE NULLIF(btrim(COALESCE(up.username, '')), '') IS NOT NULL;
$$;


ALTER FUNCTION "public"."get_public_producer_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_producer_profiles_v2"() RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "bio" "text", "social_links" "jsonb", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    up.bio,
    up.social_links,
    up.created_at,
    up.updated_at
  FROM public.user_profiles up
  WHERE up.is_producer_active = true
$$;


ALTER FUNCTION "public"."get_public_producer_profiles_v2"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_public_producer_profiles_v2"() IS 'Public producer profiles V2 allowlist (SECURITY DEFINER). NE PAS AJOUTER DE COLONNES SENSIBLES.';



CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "username" "text",
    "full_name" "text",
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'user'::"public"."user_role" NOT NULL,
    "is_producer_active" boolean DEFAULT false NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "public"."subscription_status",
    "total_purchases" integer DEFAULT 0 NOT NULL,
    "confirmed_at" timestamp with time zone,
    "producer_verified_at" timestamp with time zone,
    "language" "text" DEFAULT 'fr'::"text",
    "bio" "text",
    "website_url" "text",
    "social_links" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_confirmed" boolean DEFAULT false NOT NULL,
    "battle_refusal_count" integer DEFAULT 0 NOT NULL,
    "battles_participated" integer DEFAULT 0 NOT NULL,
    "battles_completed" integer DEFAULT 0 NOT NULL,
    "engagement_score" integer DEFAULT 0 NOT NULL,
    "producer_tier" "public"."producer_tier_type" DEFAULT 'user'::"public"."producer_tier_type" NOT NULL,
    "elo_rating" integer DEFAULT 1200 NOT NULL,
    "battle_wins" integer DEFAULT 0 NOT NULL,
    "battle_losses" integer DEFAULT 0 NOT NULL,
    "battle_draws" integer DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "delete_reason" "text",
    "deleted_label" "text",
    "is_deleted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "user_profiles_language_check" CHECK (("language" = ANY (ARRAY['fr'::"text", 'en'::"text", 'de'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profiles"."deleted_at" IS 'Logical account deletion timestamp. Row remains for FK integrity and historical data.';



COMMENT ON COLUMN "public"."user_profiles"."delete_reason" IS 'Optional user-supplied reason captured during self-account deletion.';



COMMENT ON COLUMN "public"."user_profiles"."deleted_label" IS 'Public safe label shown on historical content once account is deleted.';



COMMENT ON COLUMN "public"."user_profiles"."is_deleted" IS 'True when account was logically deleted. Auth row is not physically deleted.';



CREATE OR REPLACE FUNCTION "public"."get_public_profile_label"("profile_row" "public"."user_profiles") RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN profile_row.id IS NULL THEN 'Deleted Producer'
    WHEN COALESCE(profile_row.is_deleted, false) = true
      OR profile_row.deleted_at IS NOT NULL
      THEN COALESCE(NULLIF(btrim(COALESCE(profile_row.deleted_label, '')), ''), 'Deleted Producer')
    ELSE COALESCE(
      NULLIF(btrim(COALESCE(profile_row.username, '')), ''),
      NULLIF(btrim(COALESCE(profile_row.full_name, '')), ''),
      'Producer'
    )
  END;
$$;


ALTER FUNCTION "public"."get_public_profile_label"("profile_row" "public"."user_profiles") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_request_headers_jsonb"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_headers_raw text;
BEGIN
  v_headers_raw := current_setting('request.headers', true);
  IF v_headers_raw IS NULL OR btrim(v_headers_raw) = '' THEN
    RETURN '{}'::jsonb;
  END IF;

  BEGIN
    RETURN v_headers_raw::jsonb;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN '{}'::jsonb;
  END;
END;
$$;


ALTER FUNCTION "public"."get_request_headers_jsonb"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_weekly_leaderboard"("p_limit" integer DEFAULT 50) RETURNS TABLE("user_id" "uuid", "username" "text", "weekly_wins" integer, "weekly_losses" integer, "weekly_winrate" numeric, "rank_position" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    wl.user_id,
    wl.username,
    wl.weekly_wins,
    wl.weekly_losses,
    wl.weekly_winrate,
    wl.rank_position
  FROM public.weekly_leaderboard wl
  ORDER BY wl.rank_position ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
$$;


ALTER FUNCTION "public"."get_weekly_leaderboard"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_product_editability"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sales_count integer := 0;
  v_active_battle_count integer := 0;
  v_has_terminated_battle boolean := false;
  v_audio_changed boolean := false;
  v_metadata_essentials_changed boolean := false;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.product_type <> 'beat' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO v_sales_count
  FROM public.purchases pu
  WHERE pu.product_id = OLD.id
    AND pu.status IN ('completed', 'refunded');

  SELECT COUNT(*)
  INTO v_active_battle_count
  FROM public.battles b
  WHERE b.status = 'active'
    AND (b.product1_id = OLD.id OR b.product2_id = OLD.id);

  v_has_terminated_battle := public.product_has_terminated_battle(OLD.id);

  v_audio_changed := NEW.master_path IS DISTINCT FROM OLD.master_path
    OR NEW.master_url IS DISTINCT FROM OLD.master_url
    OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
    OR NEW.file_format IS DISTINCT FROM OLD.file_format;

  v_metadata_essentials_changed := NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.price IS DISTINCT FROM OLD.price
    OR NEW.bpm IS DISTINCT FROM OLD.bpm
    OR NEW.key_signature IS DISTINCT FROM OLD.key_signature
    OR NEW.cover_image_url IS DISTINCT FROM OLD.cover_image_url
    OR NEW.genre_id IS DISTINCT FROM OLD.genre_id
    OR NEW.mood_id IS DISTINCT FROM OLD.mood_id
    OR NEW.tags IS DISTINCT FROM OLD.tags
    OR NEW.license_terms IS DISTINCT FROM OLD.license_terms;

  IF v_sales_count > 0 AND (v_audio_changed OR v_metadata_essentials_changed) THEN
    RAISE EXCEPTION 'product_must_create_new_version';
  END IF;

  IF v_has_terminated_battle AND v_audio_changed THEN
    RAISE EXCEPTION 'product_audio_locked_by_terminated_battle';
  END IF;

  IF v_has_terminated_battle AND v_metadata_essentials_changed THEN
    RAISE EXCEPTION 'product_metadata_locked_by_terminated_battle';
  END IF;

  IF v_active_battle_count > 0 AND v_audio_changed THEN
    RAISE EXCEPTION 'product_audio_locked_by_active_battle';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_product_editability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_product_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sales_count integer := 0;
  v_has_terminated_battle boolean := false;
BEGIN
  SELECT COUNT(*)
  INTO v_sales_count
  FROM public.purchases pu
  WHERE pu.product_id = OLD.id
    AND pu.status IN ('completed', 'refunded');

  IF OLD.product_type = 'beat' THEN
    v_has_terminated_battle := public.product_has_terminated_battle(OLD.id);
  END IF;

  IF v_sales_count > 0 THEN
    RAISE EXCEPTION 'product_has_sales';
  END IF;

  IF v_has_terminated_battle THEN
    RAISE EXCEPTION 'product_has_terminated_battle';
  END IF;

  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."guard_product_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_forum_post_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalculate_forum_topic_stats(NEW.topic_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.topic_id IS DISTINCT FROM NEW.topic_id THEN
      PERFORM public.recalculate_forum_topic_stats(OLD.topic_id);
    END IF;
    PERFORM public.recalculate_forum_topic_stats(NEW.topic_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_forum_topic_stats(OLD.topic_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."handle_forum_post_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    'user'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_producer_tier"("p_user_id" "uuid", "p_min_tier" "public"."producer_tier_type") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
  v_tier public.producer_tier_type;
BEGIN
  IF p_user_id IS NULL OR p_min_tier IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
  ) THEN
    RETURN false;
  END IF;

  SELECT up.producer_tier
  INTO v_tier
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF NOT FOUND OR v_tier IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.producer_tier_rank(v_tier) >= public.producer_tier_rank(p_min_tier);
END;
$$;


ALTER FUNCTION "public"."has_producer_tier"("p_user_id" "uuid", "p_min_tier" "public"."producer_tier_type") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hash_request_value"("p_value" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN encode(extensions.digest(p_value, 'sha256'), 'hex');
  EXCEPTION
    WHEN undefined_function THEN
      RETURN NULL;
  END;
END;
$$;


ALTER FUNCTION "public"."hash_request_value"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_play_count"("p_product_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."increment_play_count"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_account_old_enough"("p_user_id" "uuid" DEFAULT "auth"."uid"(), "p_min_age" interval DEFAULT '24:00:00'::interval) RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = COALESCE(p_user_id, auth.uid())
      AND up.created_at <= now() - COALESCE(p_min_age, interval '24 hours')
  );
$$;


ALTER FUNCTION "public"."is_account_old_enough"("p_user_id" "uuid", "p_min_age" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_producer"("p_user" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  uid uuid := COALESCE(p_user, auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND up.is_producer_active = true
  );
END;
$$;


ALTER FUNCTION "public"."is_active_producer"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND up.role = 'admin'
  );
END;
$$;


ALTER FUNCTION "public"."is_admin"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_confirmed_user"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND (
        up.is_confirmed = true
        OR up.role IN ('confirmed_user', 'producer', 'admin')
      )
  );
END;
$$;


ALTER FUNCTION "public"."is_confirmed_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_user_active"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = COALESCE(p_user_id, auth.uid())
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  );
$$;


ALTER FUNCTION "public"."is_current_user_active"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_email_verified_user"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = v_uid
      AND au.email_confirmed_at IS NOT NULL
  );
END;
$$;


ALTER FUNCTION "public"."is_email_verified_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_valid_product_master_path"("p_producer_id" "uuid", "p_product_id" "uuid", "p_path" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_path text;
BEGIN
  IF p_path IS NULL OR btrim(p_path) = '' THEN
    RETURN true;
  END IF;

  IF p_producer_id IS NULL OR p_product_id IS NULL THEN
    RETURN false;
  END IF;

  v_path := public.normalize_master_storage_path(p_path);

  IF v_path IS NULL THEN
    RETURN false;
  END IF;

  RETURN (
    -- Strict invariant.
    v_path LIKE p_producer_id::text || '/' || p_product_id::text || '/%'
    -- Temporary compatibility for legacy uploads.
    OR v_path LIKE p_producer_id::text || '/audio/%'
  );
END;
$$;


ALTER FUNCTION "public"."is_valid_product_master_path"("p_producer_id" "uuid", "p_product_id" "uuid", "p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_battle_created_at_on_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."lock_battle_created_at_on_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_admin_action_audit"("p_admin_user_id" "uuid" DEFAULT NULL::"uuid", "p_action_type" "text" DEFAULT 'unknown_admin_action'::"text", "p_entity_type" "text" DEFAULT 'other'::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_source" "text" DEFAULT 'rpc'::"text", "p_source_action_id" "uuid" DEFAULT NULL::"uuid", "p_context" "jsonb" DEFAULT '{}'::"jsonb", "p_extra_details" "jsonb" DEFAULT '{}'::"jsonb", "p_success" boolean DEFAULT true, "p_error" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_log_id uuid;
  v_headers jsonb := public.get_request_headers_jsonb();
  v_forwarded_for text;
  v_ip text;
  v_runtime_context jsonb;
  v_actor uuid := auth.uid();
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  v_forwarded_for := COALESCE(v_headers->>'x-forwarded-for', v_headers->>'X-Forwarded-For');
  v_ip := NULLIF(
    split_part(
      COALESCE(v_forwarded_for, v_headers->>'x-real-ip', v_headers->>'X-Real-Ip', ''),
      ',',
      1
    ),
    ''
  );

  v_runtime_context := jsonb_build_object(
    'jwt_role', v_jwt_role,
    'auth_uid', v_actor,
    'jwt_sub', current_setting('request.jwt.claim.sub', true),
    'session_id', COALESCE(auth.jwt()->>'session_id', current_setting('request.jwt.claim.session_id', true)),
    'request_id', COALESCE(v_headers->>'x-request-id', v_headers->>'X-Request-Id'),
    'ip', v_ip,
    'user_agent', COALESCE(v_headers->>'user-agent', v_headers->>'User-Agent')
  );

  INSERT INTO public.admin_action_audit_log (
    admin_user_id,
    action_type,
    entity_type,
    entity_id,
    source,
    source_action_id,
    context,
    extra_details,
    success,
    error,
    created_at
  )
  VALUES (
    COALESCE(p_admin_user_id, v_actor),
    COALESCE(NULLIF(btrim(p_action_type), ''), 'unknown_admin_action'),
    COALESCE(NULLIF(btrim(p_entity_type), ''), 'other'),
    p_entity_id,
    COALESCE(NULLIF(btrim(p_source), ''), 'rpc'),
    p_source_action_id,
    jsonb_build_object(
      'runtime', v_runtime_context,
      'custom', COALESCE(p_context, '{}'::jsonb)
    ),
    COALESCE(p_extra_details, '{}'::jsonb),
    COALESCE(p_success, true),
    p_error,
    now()
  )
  ON CONFLICT (source_action_id) DO UPDATE
  SET context = EXCLUDED.context,
      extra_details = EXCLUDED.extra_details,
      success = EXCLUDED.success,
      error = EXCLUDED.error,
      created_at = EXCLUDED.created_at
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."log_admin_action_audit"("p_admin_user_id" "uuid", "p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_source" "text", "p_source_action_id" "uuid", "p_context" "jsonb", "p_extra_details" "jsonb", "p_success" boolean, "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_action" "text", "p_resource_type" "text", "p_resource_id" "uuid" DEFAULT NULL::"uuid", "p_old_values" "jsonb" DEFAULT NULL::"jsonb", "p_new_values" "jsonb" DEFAULT NULL::"jsonb", "p_ip_address" "inet" DEFAULT NULL::"inet", "p_user_agent" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO audit_logs (
    user_id, action, resource_type, resource_id,
    old_values, new_values, ip_address, user_agent, metadata
  ) VALUES (
    p_user_id, p_action, p_resource_type, p_resource_id,
    p_old_values, p_new_values, p_ip_address, p_user_agent, p_metadata
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_action" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_ip_address" "inet", "p_user_agent" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_fraud_event"("p_event_type" "text", "p_user_id" "uuid" DEFAULT "auth"."uid"(), "p_battle_id" "uuid" DEFAULT NULL::"uuid", "p_post_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event_id uuid;
  v_headers_raw text;
  v_headers jsonb := '{}'::jsonb;
  v_forwarded_for text;
  v_ip text;
  v_user_agent text;
  v_ip_hash text;
  v_ua_hash text;
BEGIN
  v_headers_raw := current_setting('request.headers', true);

  IF v_headers_raw IS NOT NULL AND btrim(v_headers_raw) <> '' THEN
    BEGIN
      v_headers := v_headers_raw::jsonb;
    EXCEPTION
      WHEN OTHERS THEN
        v_headers := '{}'::jsonb;
    END;
  END IF;

  v_forwarded_for := COALESCE(v_headers->>'x-forwarded-for', v_headers->>'X-Forwarded-For');
  v_ip := NULLIF(
    split_part(
      COALESCE(v_forwarded_for, v_headers->>'x-real-ip', v_headers->>'X-Real-Ip', ''),
      ',',
      1
    ),
    ''
  );
  v_user_agent := NULLIF(COALESCE(v_headers->>'user-agent', v_headers->>'User-Agent', ''), '');

  v_ip_hash := public.hash_request_value(v_ip);
  v_ua_hash := public.hash_request_value(v_user_agent);

  INSERT INTO public.fraud_events (
    event_type,
    user_id,
    battle_id,
    post_id,
    ip_hash,
    ua_hash,
    created_at
  )
  VALUES (
    COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown_event'),
    p_user_id,
    p_battle_id,
    p_post_id,
    v_ip_hash,
    v_ua_hash,
    now()
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;


ALTER FUNCTION "public"."log_fraud_event"("p_event_type" "text", "p_user_id" "uuid", "p_battle_id" "uuid", "p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_monitoring_alert"("p_event_type" "text", "p_severity" "text" DEFAULT 'warning'::"text", "p_source" "text" DEFAULT 'system'::"text", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_details" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.monitoring_alert_events (
    event_type,
    severity,
    source,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown_monitoring_event'),
    CASE
      WHEN p_severity IN ('info', 'warning', 'critical') THEN p_severity
      ELSE 'warning'
    END,
    COALESCE(NULLIF(btrim(p_source), ''), 'system'),
    p_entity_type,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;


ALTER FUNCTION "public"."log_monitoring_alert"("p_event_type" "text", "p_severity" "text", "p_source" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_preview_access"("p_user_id" "uuid", "p_product_id" "uuid", "p_preview_type" "text", "p_ip_address" "inet" DEFAULT NULL::"inet", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO preview_access_logs (user_id, product_id, preview_type, ip_address, user_agent)
  VALUES (p_user_id, p_product_id, p_preview_type, p_ip_address, p_user_agent);
END;
$$;


ALTER FUNCTION "public"."log_preview_access"("p_user_id" "uuid", "p_product_id" "uuid", "p_preview_type" "text", "p_ip_address" "inet", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_stripe_event_processed"("p_event_id" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE stripe_events SET
    processed = true,
    processed_at = now(),
    error = p_error
  WHERE id = p_event_id;
END;
$$;


ALTER FUNCTION "public"."mark_stripe_event_processed"("p_event_id" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_master_storage_path"("p_value" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_value text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v_value = '' THEN
    RETURN NULL;
  END IF;

  IF v_value ~* '^https?://' THEN
    v_value := regexp_replace(v_value, '^https?://[^/]+', '');
  END IF;

  v_value := regexp_replace(v_value, '^/storage/v1/object/(public|sign|authenticated)/', '', 'i');
  v_value := regexp_replace(v_value, '^/storage/v1/object/', '', 'i');

  v_value := regexp_replace(v_value, '^/+', '', 'g');
  IF v_value ILIKE 'beats-masters/%' THEN
    v_value := substring(v_value FROM char_length('beats-masters/') + 1);
  END IF;

  v_value := regexp_replace(v_value, '^/+', '', 'g');
  RETURN NULLIF(v_value, '');
END;
$$;


ALTER FUNCTION "public"."normalize_master_storage_path"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_product_version_lineage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  NEW.version_number := GREATEST(COALESCE(NEW.version_number, NEW.version, 1), 1);
  NEW.version := NEW.version_number;

  IF NEW.parent_product_id IS NULL THEN
    NEW.parent_product_id := COALESCE(NEW.original_beat_id, NEW.id);
  END IF;

  NEW.original_beat_id := NEW.parent_product_id;

  IF NEW.status IS NULL OR btrim(NEW.status) = '' THEN
    NEW.status := 'active';
  END IF;

  IF NEW.status = 'archived' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, now());
    NEW.is_published := false;
  ELSE
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_product_version_lineage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_admin_action_audit_monitoring"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_recent_count integer;
BEGIN
  IF NEW.success = false THEN
    PERFORM public.log_monitoring_alert(
      p_event_type => 'admin_action_failed',
      p_severity => 'warning',
      p_source => 'admin_action_audit_log',
      p_entity_type => NEW.entity_type,
      p_entity_id => NEW.entity_id,
      p_details => jsonb_build_object(
        'action_type', NEW.action_type,
        'admin_user_id', NEW.admin_user_id,
        'error', NEW.error,
        'audit_log_id', NEW.id
      )
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_recent_count
  FROM public.admin_action_audit_log aal
  WHERE aal.action_type = NEW.action_type
    AND aal.created_at >= now() - interval '5 minutes';

  IF v_recent_count >= 25 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.monitoring_alert_events mae
      WHERE mae.event_type = 'admin_action_spike'
        AND mae.details->>'action_type' = NEW.action_type
        AND mae.created_at >= now() - interval '5 minutes'
    ) THEN
      PERFORM public.log_monitoring_alert(
        p_event_type => 'admin_action_spike',
        p_severity => 'critical',
        p_source => 'admin_action_audit_log',
        p_entity_type => NEW.entity_type,
        p_entity_id => NEW.entity_id,
        p_details => jsonb_build_object(
          'action_type', NEW.action_type,
          'count_5m', v_recent_count,
          'threshold', 25
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_admin_action_audit_monitoring"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_battle_completed_competitive"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND COALESCE(OLD.status::text, '') <> 'completed' THEN
    BEGIN
      IF NEW.producer1_id IS NOT NULL AND NEW.producer2_id IS NOT NULL THEN
        PERFORM public.update_elo_rating(
          NEW.producer1_id,
          NEW.producer2_id,
          NEW.winner_id
        );
      END IF;

      PERFORM public.check_and_assign_badges(NEW.producer1_id);
      PERFORM public.check_and_assign_badges(NEW.producer2_id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'on_battle_completed_competitive failed for battle %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_battle_completed_competitive"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_battle_completed_reputation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND COALESCE(OLD.status::text, '') <> 'completed' THEN
    PERFORM public.apply_reputation_event_internal(
      p_user_id => NEW.producer1_id,
      p_source => 'battles',
      p_event_type => 'battle_participation',
      p_entity_type => 'battle',
      p_entity_id => NEW.id,
      p_delta => NULL,
      p_metadata => jsonb_build_object(
        'battle_id', NEW.id,
        'role', 'producer1'
      ),
      p_idempotency_key => 'battle_participation:' || NEW.id::text || ':' || NEW.producer1_id::text
    );

    IF NEW.producer2_id IS NOT NULL THEN
      PERFORM public.apply_reputation_event_internal(
        p_user_id => NEW.producer2_id,
        p_source => 'battles',
        p_event_type => 'battle_participation',
        p_entity_type => 'battle',
        p_entity_id => NEW.id,
        p_delta => NULL,
        p_metadata => jsonb_build_object(
          'battle_id', NEW.id,
          'role', 'producer2'
        ),
        p_idempotency_key => 'battle_participation:' || NEW.id::text || ':' || NEW.producer2_id::text
      );
    END IF;

    IF NEW.winner_id IS NOT NULL THEN
      PERFORM public.apply_reputation_event_internal(
        p_user_id => NEW.winner_id,
        p_source => 'battles',
        p_event_type => 'battle_won',
        p_entity_type => 'battle',
        p_entity_id => NEW.id,
        p_delta => NULL,
        p_metadata => jsonb_build_object(
          'battle_id', NEW.id,
          'winner_id', NEW.winner_id
        ),
        p_idempotency_key => 'battle_won:' || NEW.id::text || ':' || NEW.winner_id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_battle_completed_reputation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_forum_post_like_reputation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_post_user_id uuid;
BEGIN
  SELECT fp.user_id
  INTO v_post_user_id
  FROM public.forum_posts fp
  WHERE fp.id = NEW.post_id
  LIMIT 1;

  IF v_post_user_id IS NULL OR v_post_user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_reputation_event_internal(
    p_user_id => v_post_user_id,
    p_source => 'forum',
    p_event_type => 'forum_post_liked',
    p_entity_type => 'forum_post',
    p_entity_id => NEW.post_id,
    p_delta => NULL,
    p_metadata => jsonb_build_object(
      'liked_by_user_id', NEW.user_id,
      'post_id', NEW.post_id,
      'source_table', TG_TABLE_NAME
    ),
    p_idempotency_key => 'forum_post_liked:' || NEW.post_id::text || ':' || NEW.user_id::text
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_forum_post_like_reputation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_rpc_rate_limit_hit_create_alert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.log_monitoring_alert(
    p_event_type => 'rpc_rate_limit_exceeded',
    p_severity => CASE
      WHEN NEW.observed_count >= (NEW.allowed_per_minute * 2) THEN 'critical'
      ELSE 'warning'
    END,
    p_source => 'rpc_rate_limit_hits',
    p_entity_type => 'rpc',
    p_entity_id => NULL,
    p_details => jsonb_build_object(
      'rpc_name', NEW.rpc_name,
      'user_id', NEW.user_id,
      'scope_key', NEW.scope_key,
      'allowed_per_minute', NEW.allowed_per_minute,
      'observed_count', NEW.observed_count,
      'hit_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_rpc_rate_limit_hit_create_alert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."populate_purchase_snapshots"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_producer_display_name text;
  v_license_name text;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = NEW.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  SELECT COALESCE(NULLIF(up.full_name, ''), NULLIF(up.username, ''), up.email, '')
  INTO v_producer_display_name
  FROM public.user_profiles up
  WHERE up.id = NEW.producer_id;

  IF NEW.license_id IS NOT NULL THEN
    SELECT l.name
    INTO v_license_name
    FROM public.licenses l
    WHERE l.id = NEW.license_id;
  END IF;

  NEW.beat_title_snapshot := COALESCE(NULLIF(btrim(NEW.beat_title_snapshot), ''), v_product.title);
  NEW.beat_slug_snapshot := COALESCE(NULLIF(btrim(NEW.beat_slug_snapshot), ''), v_product.slug);
  NEW.audio_path_snapshot := COALESCE(
    NULLIF(btrim(NEW.audio_path_snapshot), ''),
    NULLIF(btrim(COALESCE(v_product.master_path, '')), ''),
    NULLIF(btrim(COALESCE(v_product.master_url, '')), ''),
    NULLIF(btrim(COALESCE(v_product.watermarked_path, '')), ''),
    NULLIF(btrim(COALESCE(v_product.preview_url, '')), '')
  );
  NEW.cover_image_url_snapshot := COALESCE(
    NULLIF(btrim(NEW.cover_image_url_snapshot), ''),
    NULLIF(btrim(COALESCE(v_product.cover_image_url, '')), '')
  );
  NEW.beat_version_snapshot := COALESCE(NEW.beat_version_snapshot, v_product.version, 1);
  NEW.price_snapshot := COALESCE(NEW.price_snapshot, NEW.amount, v_product.price);
  NEW.currency_snapshot := COALESCE(NULLIF(btrim(NEW.currency_snapshot), ''), NEW.currency);
  NEW.producer_display_name_snapshot := COALESCE(
    NULLIF(btrim(NEW.producer_display_name_snapshot), ''),
    NULLIF(btrim(COALESCE(v_producer_display_name, '')), '')
  );
  NEW.license_type_snapshot := COALESCE(
    NULLIF(btrim(NEW.license_type_snapshot), ''),
    NULLIF(btrim(COALESCE(NEW.license_type, '')), '')
  );
  NEW.license_name_snapshot := COALESCE(
    NULLIF(btrim(NEW.license_name_snapshot), ''),
    NULLIF(btrim(COALESCE(v_license_name, '')), ''),
    NULLIF(btrim(COALESCE(NEW.license_type, '')), '')
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."populate_purchase_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_product_preview_processing"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.product_type <> 'beat' THEN
    RETURN NEW;
  END IF;

  NEW.watermarked_bucket := COALESCE(NULLIF(btrim(COALESCE(NEW.watermarked_bucket, '')), ''), 'beats-watermarked');
  NEW.preview_version := GREATEST(COALESCE(NEW.preview_version, 1), 1);

  IF TG_OP = 'INSERT' THEN
    NEW.processing_status := COALESCE(NULLIF(btrim(COALESCE(NEW.processing_status, '')), ''), 'pending');
    NEW.processing_error := NULL;
    IF NEW.processing_status <> 'done' THEN
      NEW.processed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.master_path IS DISTINCT FROM OLD.master_path
     OR NEW.master_url IS DISTINCT FROM OLD.master_url THEN
    NEW.preview_version := GREATEST(COALESCE(OLD.preview_version, 1), 1) + 1;
    NEW.processing_status := 'pending';
    NEW.processing_error := NULL;
    NEW.processed_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.is_published = false
     AND NEW.is_published = true
     AND NEW.deleted_at IS NULL
     AND coalesce(nullif(btrim(COALESCE(NEW.watermarked_path, '')), ''), nullif(btrim(COALESCE(NEW.preview_url, '')), ''), nullif(btrim(COALESCE(NEW.exclusive_preview_url, '')), '')) IS NULL THEN
    NEW.processing_status := 'pending';
    NEW.processing_error := NULL;
    NEW.processed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prepare_product_preview_processing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_legacy_battle_status_assignments"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text IN ('pending', 'approved', 'voting') THEN
    RAISE EXCEPTION 'legacy_battle_status_transition_forbidden';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_legacy_battle_status_assignments"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_legacy_battle_status_assignments"() IS 'Blocks only transitions into legacy statuses pending/approved/voting. Allows non-status updates and transitions out of legacy statuses.';



CREATE OR REPLACE FUNCTION "public"."process_ai_comment_moderation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_decision jsonb;
  v_score numeric(5,4);
  v_classification text;
  v_action_id uuid;
BEGIN
  v_decision := public.classify_battle_comment_rule_based(NEW.content);
  v_score := COALESCE((v_decision->>'score')::numeric, 0.0000);
  v_classification := COALESCE(v_decision->>'classification', 'safe');

  INSERT INTO public.ai_admin_actions (
    action_type,
    entity_type,
    entity_id,
    ai_decision,
    confidence_score,
    reason,
    status,
    human_override,
    reversible,
    executed_at,
    executed_by,
    error
  ) VALUES (
    'comment_moderation',
    'comment',
    NEW.id,
    v_decision,
    v_score,
    COALESCE(v_decision->>'reason', 'rule_based_scan'),
    'proposed',
    false,
    true,
    NULL,
    NULL,
    NULL
  ) RETURNING id INTO v_action_id;

  IF v_classification IN ('toxic', 'spam') AND v_score >= 0.9500 THEN
    UPDATE public.battle_comments
    SET is_hidden = true,
        hidden_reason = 'auto_moderated'
    WHERE id = NEW.id
      AND is_hidden = false;

    UPDATE public.ai_admin_actions
    SET status = 'executed',
        reason = 'Auto-moderated by rule-based policy.',
        executed_at = now(),
        ai_decision = ai_decision || jsonb_build_object(
          'applied_action', 'hide',
          'applied_hidden_reason', 'auto_moderated'
        )
    WHERE id = v_action_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."process_ai_comment_moderation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."producer_publish_battle"("p_battle_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.producer1_id != v_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_battle.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  IF v_battle.producer2_id IS NULL
     OR v_battle.product1_id IS NULL
     OR v_battle.product2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready';
  END IF;

  UPDATE public.battles
  SET status = 'active',
      starts_at = COALESCE(starts_at, now()),
      updated_at = now()
  WHERE id = p_battle_id;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."producer_publish_battle"("p_battle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."producer_start_battle_voting"("p_battle_id" "uuid", "p_voting_duration_hours" integer DEFAULT 72) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_hours integer := GREATEST(1, LEAST(COALESCE(p_voting_duration_hours, 72), 720));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.producer1_id != v_actor THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_battle.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'invalid_status_transition';
  END IF;

  IF v_battle.producer2_id IS NULL
     OR v_battle.product1_id IS NULL
     OR v_battle.product2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready';
  END IF;

  UPDATE public.battles
  SET status = 'voting',
      starts_at = COALESCE(starts_at, now()),
      voting_ends_at = COALESCE(voting_ends_at, now() + make_interval(hours => v_hours)),
      updated_at = now()
  WHERE id = p_battle_id;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."producer_start_battle_voting"("p_battle_id" "uuid", "p_voting_duration_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."producer_tier_rank"("p_tier" "public"."producer_tier_type") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE p_tier
    WHEN 'user'::public.producer_tier_type THEN 0
    WHEN 'producteur'::public.producer_tier_type THEN 1
    WHEN 'elite'::public.producer_tier_type THEN 2
    ELSE 0
  END
$$;


ALTER FUNCTION "public"."producer_tier_rank"("p_tier" "public"."producer_tier_type") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_has_terminated_battle"("p_product_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.battles b
    WHERE b.status = 'completed'
      AND (
        b.product1_id = p_product_id
        OR b.product2_id = p_product_id
      )
  );
$$;


ALTER FUNCTION "public"."product_has_terminated_battle"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_engagement"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_score integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  UPDATE public.user_profiles up
  SET engagement_score = (COALESCE(up.battles_completed, 0) * 2) - (COALESCE(up.battle_refusal_count, 0) * 1)
  WHERE up.id = p_user_id
  RETURNING up.engagement_score INTO v_score;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  RETURN v_score;
END;
$$;


ALTER FUNCTION "public"."recalculate_engagement"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_forum_topic_stats"("p_topic_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_created_at timestamptz;
  v_post_count integer;
  v_last_post_at timestamptz;
BEGIN
  IF p_topic_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ft.created_at
  INTO v_created_at
  FROM public.forum_topics ft
  WHERE ft.id = p_topic_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE fp.is_deleted = false AND fp.is_visible = true),
    MAX(fp.created_at) FILTER (WHERE fp.is_deleted = false AND fp.is_visible = true)
  INTO v_post_count, v_last_post_at
  FROM public.forum_posts fp
  WHERE fp.topic_id = p_topic_id;

  UPDATE public.forum_topics
  SET
    post_count = COALESCE(v_post_count, 0),
    last_post_at = COALESCE(v_last_post_at, v_created_at)
  WHERE id = p_topic_id;
END;
$$;


ALTER FUNCTION "public"."recalculate_forum_topic_stats"("p_topic_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_battle_vote"("p_battle_id" "uuid", "p_user_id" "uuid", "p_voted_for_producer_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_battle public.battles%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'vote_user_mismatch';
  END IF;

  IF NOT public.is_email_verified_user(p_user_id) THEN
    RAISE EXCEPTION 'vote_not_allowed_unverified_email';
  END IF;

  IF NOT public.is_account_old_enough(v_actor, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_actor, 'record_battle_vote') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'active' THEN
    RAISE EXCEPTION 'battle_not_open_for_voting';
  END IF;

  IF v_battle.starts_at IS NULL OR now() < v_battle.starts_at THEN
    RAISE EXCEPTION 'battle_not_started';
  END IF;

  IF v_battle.voting_ends_at IS NULL OR now() >= v_battle.voting_ends_at THEN
    RAISE EXCEPTION 'battle_voting_expired';
  END IF;

  IF v_battle.producer1_id IS NULL OR v_battle.producer2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready_for_voting';
  END IF;

  IF p_voted_for_producer_id != v_battle.producer1_id
     AND p_voted_for_producer_id != v_battle.producer2_id THEN
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_actor = v_battle.producer1_id
     OR v_actor = v_battle.producer2_id THEN
    RAISE EXCEPTION 'participants_cannot_vote';
  END IF;

  IF p_voted_for_producer_id = v_actor THEN
    RAISE EXCEPTION 'self_vote_not_allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes
    WHERE battle_id = p_battle_id
      AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_voted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes bv
    WHERE bv.user_id = v_actor
      AND bv.created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'vote_cooldown';
  END IF;

  INSERT INTO public.battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, v_actor, p_voted_for_producer_id);

  IF p_voted_for_producer_id = v_battle.producer1_id THEN
    UPDATE public.battles
    SET votes_producer1 = votes_producer1 + 1
    WHERE id = p_battle_id;
  ELSE
    UPDATE public.battles
    SET votes_producer2 = votes_producer2 + 1
    WHERE id = p_battle_id;
  END IF;

  PERFORM public.log_fraud_event('battle_vote', v_actor, p_battle_id, NULL);

  RETURN true;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;


ALTER FUNCTION "public"."record_battle_vote"("p_battle_id" "uuid", "p_user_id" "uuid", "p_voted_for_producer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_beat_from_sale"("p_beat_id" "uuid") RETURNS "public"."products"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT * FROM public.rpc_archive_product(p_beat_id);
$$;


ALTER FUNCTION "public"."remove_beat_from_sale"("p_beat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reputation_calculate_level"("p_xp" bigint) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT GREATEST(1, floor(sqrt(GREATEST(COALESCE(p_xp, 0), 0)::numeric / 25.0))::integer + 1);
$$;


ALTER FUNCTION "public"."reputation_calculate_level"("p_xp" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reputation_calculate_rank_tier"("p_xp" bigint) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN COALESCE(p_xp, 0) >= 2000 THEN 'diamond'
    WHEN COALESCE(p_xp, 0) >= 1000 THEN 'platinum'
    WHEN COALESCE(p_xp, 0) >= 400 THEN 'gold'
    WHEN COALESCE(p_xp, 0) >= 120 THEN 'silver'
    ELSE 'bronze'
  END;
$$;


ALTER FUNCTION "public"."reputation_calculate_rank_tier"("p_xp" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reputation_rank_tier_value"("p_rank_tier" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE lower(COALESCE(p_rank_tier, 'bronze'))
    WHEN 'diamond' THEN 5
    WHEN 'platinum' THEN 4
    WHEN 'gold' THEN 3
    WHEN 'silver' THEN 2
    ELSE 1
  END;
$$;


ALTER FUNCTION "public"."reputation_rank_tier_value"("p_rank_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reputation_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."reputation_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_elo_for_new_season"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_active_season uuid;
  v_updated integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  v_active_season := public.get_active_season();

  IF v_active_season IS NULL THEN
    RAISE EXCEPTION 'no_active_season';
  END IF;

  INSERT INTO public.season_results (season_id, user_id, final_elo, rank_position, wins, losses)
  SELECT
    v_active_season,
    lp.user_id,
    lp.elo_rating,
    lp.rank_position::integer,
    lp.battle_wins,
    lp.battle_losses
  FROM public.leaderboard_producers lp
  ON CONFLICT (season_id, user_id)
  DO UPDATE SET
    final_elo = EXCLUDED.final_elo,
    rank_position = EXCLUDED.rank_position,
    wins = EXCLUDED.wins,
    losses = EXCLUDED.losses,
    created_at = now();

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM public.season_results sr
  JOIN public.producer_badges pb ON pb.name = 'Season Champion'
  WHERE sr.season_id = v_active_season
    AND sr.rank_position = 1
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM public.season_results sr
  JOIN public.producer_badges pb ON pb.name = 'Top 10 Season'
  WHERE sr.season_id = v_active_season
    AND sr.rank_position <= 10
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_badges (user_id, badge_id)
  SELECT sr.user_id, pb.id
  FROM public.season_results sr
  JOIN public.producer_badges pb ON pb.name = 'Top 100 Season'
  WHERE sr.season_id = v_active_season
    AND sr.rank_position <= 100
  ON CONFLICT DO NOTHING;

  UPDATE public.user_profiles up
  SET
    elo_rating = GREATEST(
      100,
      round(
        1200 + ((COALESCE(up.elo_rating, 1200) - 1200) * 0.5)
      )::integer
    ),
    updated_at = now()
  WHERE up.role IN ('producer', 'admin')
    AND up.is_producer_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."reset_elo_for_new_season"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_to_battle"("p_battle_id" "uuid", "p_accept" boolean, "p_reason" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.producer2_id IS NULL OR v_battle.producer2_id != v_actor THEN
    RAISE EXCEPTION 'only_invited_producer_can_respond';
  END IF;

  IF v_battle.status != 'pending_acceptance' THEN
    RAISE EXCEPTION 'battle_not_waiting_for_response';
  END IF;

  IF v_battle.accepted_at IS NOT NULL OR v_battle.rejected_at IS NOT NULL THEN
    RAISE EXCEPTION 'response_already_recorded';
  END IF;

  IF p_accept THEN
    UPDATE public.battles
    SET status = 'awaiting_admin',
        accepted_at = now(),
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_battle_id;
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'rejection_reason_required';
    END IF;

    IF NOT public.check_daily_battle_refusals(v_actor) THEN
      RAISE EXCEPTION 'Daily battle refusal limit reached (5 per day)';
    END IF;

    UPDATE public.battles
    SET status = 'rejected',
        rejected_at = now(),
        accepted_at = NULL,
        rejection_reason = v_reason,
        updated_at = now()
    WHERE id = p_battle_id;

    UPDATE public.user_profiles
    SET battle_refusal_count = COALESCE(battle_refusal_count, 0) + 1,
        updated_at = now()
    WHERE id = v_actor;

    PERFORM public.recalculate_engagement(v_actor);
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."respond_to_battle"("p_battle_id" "uuid", "p_accept" boolean, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_admin_get_beat_feedback_overview"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_battle_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("battle_id" "uuid", "battle_slug" "text", "battle_title" "text", "battle_status" "public"."battle_status", "product_id" "uuid", "product_title" "text", "producer_id" "uuid", "producer_username" "text", "quality_index" numeric, "preference_score" numeric, "artistic_score" numeric, "coherence_score" numeric, "credibility_score" numeric, "votes_total" bigint, "votes_for_product" bigint, "win_rate" numeric, "total_feedback" bigint, "top_criteria" "jsonb", "structure_score" numeric, "melody_score" numeric, "rhythm_score" numeric, "sound_design_score" numeric, "mix_score" numeric, "identity_score" numeric, "computed_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_user_id)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
  WITH candidate_products AS (
    SELECT
      b.id AS battle_id,
      b.slug AS battle_slug,
      b.title AS battle_title,
      b.status AS battle_status,
      cp.slot,
      cp.product_id,
      p.title AS product_title,
      p.producer_id,
      ppp.username AS producer_username,
      COALESCE(b.votes_producer1, 0)::bigint AS votes_producer1,
      COALESCE(b.votes_producer2, 0)::bigint AS votes_producer2,
      b.updated_at AS battle_updated_at
    FROM public.battles b
    JOIN LATERAL (
      VALUES
        (1, b.product1_id),
        (2, b.product2_id)
    ) AS cp(slot, product_id)
      ON cp.product_id IS NOT NULL
    JOIN public.products p
      ON p.id = cp.product_id
    LEFT JOIN public.public_producer_profiles ppp
      ON ppp.user_id = p.producer_id
    WHERE p_battle_id IS NULL OR b.id = p_battle_id
  ),
  joined AS (
    SELECT
      cp.*,
      qs.quality_index,
      qs.preference_score,
      qs.artistic_score,
      qs.coherence_score,
      qs.credibility_score,
      qs.votes_total,
      qs.votes_for_product,
      qs.win_rate,
      qs.computed_at
    FROM candidate_products cp
    LEFT JOIN public.battle_quality_snapshots qs
      ON qs.battle_id = cp.battle_id
     AND qs.product_id = cp.product_id
  )
  SELECT
    j.battle_id,
    j.battle_slug,
    j.battle_title,
    j.battle_status,
    j.product_id,
    j.product_title,
    j.producer_id,
    j.producer_username,
    COALESCE(j.quality_index, 0::numeric) AS quality_index,
    COALESCE(j.preference_score, 0::numeric) AS preference_score,
    COALESCE(j.artistic_score, 0::numeric) AS artistic_score,
    COALESCE(j.coherence_score, 0::numeric) AS coherence_score,
    COALESCE(j.credibility_score, 0::numeric) AS credibility_score,
    COALESCE(j.votes_total, (j.votes_producer1 + j.votes_producer2))::bigint AS votes_total,
    COALESCE(
      j.votes_for_product,
      CASE WHEN j.slot = 1 THEN j.votes_producer1 ELSE j.votes_producer2 END
    )::bigint AS votes_for_product,
    COALESCE(
      j.win_rate,
      CASE
        WHEN (j.votes_producer1 + j.votes_producer2) > 0 THEN
          ROUND(
            (
              (CASE WHEN j.slot = 1 THEN j.votes_producer1 ELSE j.votes_producer2 END)::numeric
              / (j.votes_producer1 + j.votes_producer2)::numeric
            ) * 100,
            3
          )
        ELSE 0::numeric
      END
    ) AS win_rate,
    COALESCE(s.total_feedback, 0)::bigint AS total_feedback,
    COALESCE(tc.top_criteria, '[]'::jsonb) AS top_criteria,
    COALESCE(s.structure_score, 0::numeric) AS structure_score,
    COALESCE(s.melody_score, 0::numeric) AS melody_score,
    COALESCE(s.rhythm_score, 0::numeric) AS rhythm_score,
    COALESCE(s.sound_design_score, 0::numeric) AS sound_design_score,
    COALESCE(s.mix_score, 0::numeric) AS mix_score,
    COALESCE(s.identity_score, 0::numeric) AS identity_score,
    COALESCE(j.computed_at, j.battle_updated_at) AS computed_at
  FROM joined j
  LEFT JOIN public.admin_beat_feedback_scores s
    ON s.product_id = j.product_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'criterion', c.criterion,
        'count', c.criterion_count,
        'rank', c.rank
      )
      ORDER BY c.rank ASC
    ) AS top_criteria
    FROM public.admin_beat_feedback_top_criteria c
    WHERE c.product_id = j.product_id
      AND c.rank <= 6
  ) tc ON true
  ORDER BY COALESCE(j.quality_index, 0::numeric) DESC, COALESCE(j.computed_at, j.battle_updated_at) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


ALTER FUNCTION "public"."rpc_admin_get_beat_feedback_overview"("p_limit" integer, "p_offset" integer, "p_battle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_admin_get_reputation_overview"("p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS TABLE("user_id" "uuid", "username" "text", "email" "text", "role" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "xp" bigint, "level" integer, "rank_tier" "text", "forum_xp" bigint, "battle_xp" bigint, "commerce_xp" bigint, "reputation_score" numeric, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_search text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.username,
    up.email,
    up.role::text,
    up.avatar_url,
    up.producer_tier,
    ur.xp,
    ur.level,
    ur.rank_tier,
    ur.forum_xp,
    ur.battle_xp,
    ur.commerce_xp,
    ur.reputation_score,
    ur.updated_at
  FROM public.user_profiles up
  JOIN public.user_reputation ur ON ur.user_id = up.id
  WHERE (
    v_search IS NULL
    OR lower(COALESCE(up.username, '')) LIKE '%' || v_search || '%'
    OR lower(COALESCE(up.email, '')) LIKE '%' || v_search || '%'
  )
  ORDER BY ur.xp DESC, up.created_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;


ALTER FUNCTION "public"."rpc_admin_get_reputation_overview"("p_search" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_apply_reputation_event"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_delta" integer DEFAULT NULL::integer, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS TABLE("applied" boolean, "event_id" "uuid", "xp" bigint, "level" integer, "rank_tier" "text", "forum_xp" bigint, "battle_xp" bigint, "commerce_xp" bigint, "reputation_score" numeric, "skipped_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_actor)) THEN
    RAISE EXCEPTION 'service_role_or_admin_required';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.apply_reputation_event_internal(
    p_user_id => p_user_id,
    p_source => p_source,
    p_event_type => p_event_type,
    p_entity_type => p_entity_type,
    p_entity_id => p_entity_id,
    p_delta => p_delta,
    p_metadata => p_metadata,
    p_idempotency_key => p_idempotency_key
  );
END;
$$;


ALTER FUNCTION "public"."rpc_apply_reputation_event"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_archive_product"("p_product_id" "uuid") RETURNS "public"."products"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND product_type = 'beat'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF v_actor IS NULL OR v_product.producer_id <> v_actor THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  UPDATE public.products
  SET
    status = 'archived',
    archived_at = COALESCE(archived_at, now()),
    is_published = false,
    updated_at = now()
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  RETURN v_product;
END;
$$;


ALTER FUNCTION "public"."rpc_archive_product"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_check_contract_url_rate_limit"("p_purchase_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, auth.uid());
  v_window_start timestamptz := date_trunc('minute', now());
  v_rule public.rpc_rate_limit_rules%ROWTYPE;
  v_allowed integer := 2;
  v_request_count integer := 0;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'purchase_required';
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_rule
  FROM public.rpc_rate_limit_rules
  WHERE rpc_name = 'get_contract_url_purchase';

  IF FOUND THEN
    IF COALESCE(v_rule.is_enabled, true) = false THEN
      RETURN true;
    END IF;

    v_allowed := GREATEST(1, COALESCE(v_rule.allowed_per_minute, v_allowed));
  END IF;

  INSERT INTO public.contract_url_rate_limit_counters (
    purchase_id,
    user_id,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (
    p_purchase_id,
    v_user_id,
    v_window_start,
    1,
    now()
  )
  ON CONFLICT (purchase_id, user_id, window_started_at)
  DO UPDATE
    SET request_count = public.contract_url_rate_limit_counters.request_count + 1,
        updated_at = now()
  RETURNING request_count INTO v_request_count;

  IF v_request_count > v_allowed THEN
    INSERT INTO public.rpc_rate_limit_hits (
      rpc_name,
      user_id,
      scope_key,
      allowed_per_minute,
      observed_count,
      context
    )
    VALUES (
      'get_contract_url_purchase',
      v_user_id,
      concat_ws(':', p_purchase_id::text, v_user_id::text),
      v_allowed,
      v_request_count,
      jsonb_build_object(
        'purchase_id', p_purchase_id,
        'source', 'rpc_check_contract_url_rate_limit'
      )
    );

    RETURN false;
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."rpc_check_contract_url_rate_limit"("p_purchase_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_compute_battle_quality_snapshot"("p_battle_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', '');
  v_battle public.battles%ROWTYPE;
  v_alpha numeric := 2;
  v_beta numeric := 2;
  v_rows integer := 0;
BEGIN
  IF NOT (v_jwt_role = 'service_role' OR public.is_admin(v_user_id)) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_battle_id IS NULL THEN
    RAISE EXCEPTION 'battle_required';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  PERFORM set_config('app.battle_quality_snapshot_rpc', '1', true);

  WITH products_to_score AS (
    SELECT v_battle.product1_id AS product_id, 1 AS slot
    WHERE v_battle.product1_id IS NOT NULL

    UNION ALL

    SELECT v_battle.product2_id AS product_id, 2 AS slot
    WHERE v_battle.product2_id IS NOT NULL
  ),
  metrics AS (
    SELECT
      pts.product_id,
      (COALESCE(v_battle.votes_producer1, 0) + COALESCE(v_battle.votes_producer2, 0))::bigint AS votes_total,
      CASE
        WHEN pts.slot = 1 THEN COALESCE(v_battle.votes_producer1, 0)::bigint
        ELSE COALESCE(v_battle.votes_producer2, 0)::bigint
      END AS votes_for_product,
      COALESCE(fe.total_feedback, 0)::bigint AS total_feedback,
      COALESCE(fe.top_share, 0::numeric) AS top_share,
      COALESCE(fe.weighted_share, 0::numeric) AS weighted_share
    FROM products_to_score pts
    LEFT JOIN LATERAL (
      WITH grouped_feedback AS (
        SELECT
          bf.criterion,
          COUNT(*)::numeric AS criterion_count
        FROM public.battle_vote_feedback bf
        WHERE bf.battle_id = p_battle_id
          AND bf.winner_product_id = pts.product_id
        GROUP BY bf.criterion
      ),
      agg AS (
        SELECT
          COALESCE(SUM(gf.criterion_count), 0::numeric) AS total_feedback,
          COALESCE(MAX(gf.criterion_count), 0::numeric) AS top_feedback,
          COALESCE(SUM(
            gf.criterion_count * CASE gf.criterion
              WHEN 'originality' THEN 1.3
              WHEN 'artistic_vibe' THEN 1.3
              WHEN 'melody' THEN 1.2
              WHEN 'ambience' THEN 1.2
              WHEN 'groove' THEN 1.0
              WHEN 'drums' THEN 1.0
              WHEN 'energy' THEN 1.0
              WHEN 'mix' THEN 0.9
              WHEN 'sound_design' THEN 0.9
              ELSE 1.0
            END
          ), 0::numeric) AS weighted_count
        FROM grouped_feedback gf
      )
      SELECT
        agg.total_feedback,
        CASE
          WHEN agg.total_feedback > 0 THEN agg.top_feedback / agg.total_feedback
          ELSE 0::numeric
        END AS top_share,
        CASE
          WHEN agg.total_feedback > 0 THEN LEAST(1::numeric, agg.weighted_count / (agg.total_feedback * 1.3))
          ELSE 0::numeric
        END AS weighted_share
      FROM agg
    ) fe ON true
  ),
  scores AS (
    SELECT
      m.product_id,
      m.votes_total,
      m.votes_for_product,
      CASE
        WHEN m.votes_total > 0 THEN ROUND((m.votes_for_product::numeric / m.votes_total::numeric) * 100, 3)
        ELSE 0::numeric
      END AS win_rate,
      ROUND(((m.votes_for_product::numeric + v_alpha) / (m.votes_total::numeric + v_alpha + v_beta)) * 100, 3) AS preference_score,
      ROUND(m.weighted_share * 100, 3) AS artistic_score,
      ROUND(
        CASE
          WHEN m.total_feedback < 5 THEN 0::numeric
          ELSE LEAST(1::numeric, m.top_share / 0.35) * 100
        END,
        3
      ) AS coherence_score,
      50::numeric AS credibility_score,
      m.total_feedback,
      m.top_share,
      m.weighted_share
    FROM metrics m
  ),
  upserted AS (
    INSERT INTO public.battle_quality_snapshots (
      battle_id,
      product_id,
      computed_at,
      votes_total,
      votes_for_product,
      win_rate,
      preference_score,
      artistic_score,
      coherence_score,
      credibility_score,
      quality_index,
      meta,
      created_at,
      updated_at
    )
    SELECT
      p_battle_id,
      s.product_id,
      now(),
      s.votes_total,
      s.votes_for_product,
      s.win_rate,
      s.preference_score,
      s.artistic_score,
      s.coherence_score,
      s.credibility_score,
      ROUND(
        (0.45 * s.preference_score)
        + (0.30 * s.artistic_score)
        + (0.15 * s.coherence_score)
        + (0.10 * s.credibility_score),
        3
      ) AS quality_index,
      jsonb_build_object(
        'alpha', v_alpha,
        'beta', v_beta,
        'total_feedback', s.total_feedback,
        'top_share', s.top_share,
        'weighted_share', s.weighted_share,
        'weights', jsonb_build_object(
          'preference', 0.45,
          'artistic', 0.30,
          'coherence', 0.15,
          'credibility', 0.10
        )
      ),
      now(),
      now()
    FROM scores s
    ON CONFLICT (battle_id, product_id)
    DO UPDATE SET
      computed_at = EXCLUDED.computed_at,
      votes_total = EXCLUDED.votes_total,
      votes_for_product = EXCLUDED.votes_for_product,
      win_rate = EXCLUDED.win_rate,
      preference_score = EXCLUDED.preference_score,
      artistic_score = EXCLUDED.artistic_score,
      coherence_score = EXCLUDED.coherence_score,
      credibility_score = EXCLUDED.credibility_score,
      quality_index = EXCLUDED.quality_index,
      meta = EXCLUDED.meta,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rows FROM upserted;

  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."rpc_compute_battle_quality_snapshot"("p_battle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_contact_submit_rate_limit"("p_ip_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ip_hash text := btrim(COALESCE(p_ip_hash, ''));
  v_window_start timestamptz;
  v_counter integer := 0;
BEGIN
  IF v_ip_hash = '' THEN
    RAISE EXCEPTION 'invalid_ip_hash';
  END IF;

  v_window_start := date_trunc('hour', now())
    + floor(extract(minute from now()) / 10)::int * interval '10 minutes';

  INSERT INTO public.contact_submit_rate_limit (
    ip_hash,
    window_start,
    counter,
    updated_at
  )
  VALUES (
    v_ip_hash,
    v_window_start,
    1,
    now()
  )
  ON CONFLICT (ip_hash, window_start)
  DO UPDATE
    SET counter = public.contact_submit_rate_limit.counter + 1,
        updated_at = now()
  RETURNING counter INTO v_counter;

  IF v_counter > 5 THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  DELETE FROM public.contact_submit_rate_limit
  WHERE window_start < now() - interval '2 days';

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."rpc_contact_submit_rate_limit"("p_ip_hash" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "content" "text" NOT NULL,
    "is_hidden" boolean DEFAULT false NOT NULL,
    "hidden_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "battle_comments_content_check" CHECK (("length"("content") <= 1000))
);


ALTER TABLE "public"."battle_comments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_battle_comment"("p_battle_id" "uuid", "p_content" "text") RETURNS "public"."battle_comments"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_row public.battle_comments;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_create_battle_comment') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_comment';
  END IF;

  IF char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long';
  END IF;

  -- Gate direct inserts: only this RPC sets this flag for the current transaction.
  PERFORM set_config('app.battle_comment_rpc', '1', true);

  INSERT INTO public.battle_comments (battle_id, user_id, content)
  VALUES (p_battle_id, v_user_id, v_content)
  RETURNING * INTO v_row;

  PERFORM public.log_fraud_event('battle_comment', v_user_id, p_battle_id, NULL);

  RETURN v_row;
END;
$$;


ALTER FUNCTION "public"."rpc_create_battle_comment"("p_battle_id" "uuid", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_product_version"("p_product_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.products%ROWTYPE;
  v_root_id uuid;
  v_next_version integer;
  v_new_product_id uuid;
BEGIN
  SELECT *
  INTO v_source
  FROM public.products
  WHERE id = p_product_id
    AND product_type = 'beat'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF v_actor IS NULL OR v_source.producer_id <> v_actor THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  v_root_id := COALESCE(v_source.parent_product_id, v_source.id);

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.products
  WHERE parent_product_id = v_root_id
    AND deleted_at IS NULL;

  UPDATE public.products
  SET
    status = 'archived',
    archived_at = COALESCE(archived_at, now()),
    is_published = false,
    updated_at = now()
  WHERE parent_product_id = v_root_id
    AND status = 'active'
    AND deleted_at IS NULL;

  INSERT INTO public.products (
    producer_id,
    title,
    slug,
    description,
    product_type,
    genre_id,
    mood_id,
    bpm,
    key_signature,
    price,
    cover_image_url,
    is_exclusive,
    is_sold,
    sold_at,
    sold_to_user_id,
    is_published,
    play_count,
    tags,
    duration_seconds,
    file_format,
    license_terms,
    watermark_profile_id,
    deleted_at,
    master_path,
    master_url,
    watermarked_path,
    preview_url,
    exclusive_preview_url,
    watermarked_bucket,
    processing_status,
    processing_error,
    processed_at,
    preview_signature,
    last_watermark_hash,
    preview_version,
    status,
    version,
    version_number,
    parent_product_id,
    original_beat_id,
    archived_at
  )
  VALUES (
    v_source.producer_id,
    v_source.title,
    format('%s-v%s-%s', v_source.slug, v_next_version, substr(gen_random_uuid()::text, 1, 8)),
    v_source.description,
    v_source.product_type,
    v_source.genre_id,
    v_source.mood_id,
    v_source.bpm,
    v_source.key_signature,
    v_source.price,
    v_source.cover_image_url,
    v_source.is_exclusive,
    false,
    NULL,
    NULL,
    false,
    0,
    v_source.tags,
    v_source.duration_seconds,
    v_source.file_format,
    v_source.license_terms,
    v_source.watermark_profile_id,
    NULL,
    v_source.master_path,
    v_source.master_url,
    NULL,
    NULL,
    NULL,
    v_source.watermarked_bucket,
    'pending',
    NULL,
    NULL,
    NULL,
    NULL,
    1,
    'active',
    v_next_version,
    v_next_version,
    v_root_id,
    v_root_id,
    NULL
  )
  RETURNING id INTO v_new_product_id;

  RETURN v_new_product_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_product_version"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_delete_product_if_no_sales"("p_product_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_sales_count integer := 0;
  v_has_terminated_battle boolean := false;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND product_type = 'beat'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF v_actor IS NULL OR v_product.producer_id <> v_actor THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  SELECT COUNT(*)
  INTO v_sales_count
  FROM public.purchases pu
  WHERE pu.product_id = p_product_id
    AND pu.status IN ('completed', 'refunded');

  IF v_sales_count > 0 THEN
    RAISE EXCEPTION 'product_has_sales';
  END IF;

  v_has_terminated_battle := public.product_has_terminated_battle(p_product_id);

  IF v_has_terminated_battle THEN
    RAISE EXCEPTION 'product_has_terminated_battle';
  END IF;

  DELETE FROM public.products
  WHERE id = p_product_id
    AND producer_id = v_actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_failed';
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'product_id', v_product.id
  );
END;
$$;


ALTER FUNCTION "public"."rpc_delete_product_if_no_sales"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_forum_create_post"("p_user_id" "uuid", "p_topic_id" "uuid", "p_content" "text", "p_source" "text", "p_moderation_status" "text" DEFAULT 'allowed'::"text", "p_is_visible" boolean DEFAULT true, "p_is_flagged" boolean DEFAULT false, "p_moderation_score" numeric DEFAULT NULL::numeric, "p_moderation_reason" "text" DEFAULT NULL::"text", "p_moderation_model" "text" DEFAULT NULL::"text", "p_is_ai_generated" boolean DEFAULT false, "p_ai_agent_name" "text" DEFAULT NULL::"text", "p_source_post_id" "uuid" DEFAULT NULL::"uuid", "p_raw_response" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("post_id" "uuid", "topic_id" "uuid", "topic_slug" "text", "category_slug" "text", "moderation_status" "text", "is_visible" boolean, "is_flagged" boolean, "is_ai_generated" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_topic public.forum_topics%ROWTYPE;
  v_category public.forum_categories%ROWTYPE;
  v_post_id uuid;
BEGIN
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  IF p_topic_id IS NULL THEN
    RAISE EXCEPTION 'topic_required';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'content_required';
  END IF;

  SELECT *
  INTO v_topic
  FROM public.forum_topics
  WHERE id = p_topic_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic_not_found';
  END IF;

  IF v_topic.is_deleted THEN
    RAISE EXCEPTION 'topic_deleted';
  END IF;

  IF NOT public.forum_can_write_topic(v_topic.id, p_user_id) THEN
    RAISE EXCEPTION 'topic_write_denied';
  END IF;

  SELECT *
  INTO v_category
  FROM public.forum_categories
  WHERE id = v_topic.category_id
  LIMIT 1;

  INSERT INTO public.forum_posts (
    topic_id,
    user_id,
    content,
    moderation_status,
    is_visible,
    is_flagged,
    moderation_score,
    moderation_reason,
    moderated_at,
    moderation_model,
    is_ai_generated,
    ai_agent_name,
    source_post_id
  )
  VALUES (
    v_topic.id,
    p_user_id,
    btrim(p_content),
    COALESCE(NULLIF(btrim(COALESCE(p_moderation_status, '')), ''), 'allowed'),
    COALESCE(p_is_visible, true),
    COALESCE(p_is_flagged, false),
    p_moderation_score,
    p_moderation_reason,
    now(),
    p_moderation_model,
    COALESCE(p_is_ai_generated, false),
    p_ai_agent_name,
    p_source_post_id
  )
  RETURNING id INTO v_post_id;

  IF COALESCE(p_is_ai_generated, false) THEN
    UPDATE public.forum_topics
    SET last_ai_reply_at = now()
    WHERE id = v_topic.id;
  END IF;

  INSERT INTO public.forum_moderation_logs (
    post_id,
    topic_id,
    source,
    model,
    score,
    decision,
    reason,
    raw_response
  )
  VALUES (
    v_post_id,
    v_topic.id,
    COALESCE(NULLIF(btrim(COALESCE(p_source, '')), ''), 'forum_rpc'),
    p_moderation_model,
    p_moderation_score,
    COALESCE(NULLIF(btrim(COALESCE(p_moderation_status, '')), ''), 'allowed'),
    p_moderation_reason,
    COALESCE(p_raw_response, '{}'::jsonb)
  );

  RETURN QUERY
  SELECT
    v_post_id,
    v_topic.id,
    v_topic.slug,
    v_category.slug,
    COALESCE(NULLIF(btrim(COALESCE(p_moderation_status, '')), ''), 'allowed'),
    COALESCE(p_is_visible, true),
    COALESCE(p_is_flagged, false),
    COALESCE(p_is_ai_generated, false);
END;
$$;


ALTER FUNCTION "public"."rpc_forum_create_post"("p_user_id" "uuid", "p_topic_id" "uuid", "p_content" "text", "p_source" "text", "p_moderation_status" "text", "p_is_visible" boolean, "p_is_flagged" boolean, "p_moderation_score" numeric, "p_moderation_reason" "text", "p_moderation_model" "text", "p_is_ai_generated" boolean, "p_ai_agent_name" "text", "p_source_post_id" "uuid", "p_raw_response" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_forum_create_topic"("p_user_id" "uuid", "p_category_slug" "text", "p_title" "text", "p_topic_slug" "text", "p_content" "text", "p_source" "text", "p_moderation_status" "text" DEFAULT 'allowed'::"text", "p_is_visible" boolean DEFAULT true, "p_is_flagged" boolean DEFAULT false, "p_moderation_score" numeric DEFAULT NULL::numeric, "p_moderation_reason" "text" DEFAULT NULL::"text", "p_moderation_model" "text" DEFAULT NULL::"text", "p_is_ai_generated" boolean DEFAULT false, "p_ai_agent_name" "text" DEFAULT NULL::"text", "p_source_post_id" "uuid" DEFAULT NULL::"uuid", "p_raw_response" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("topic_id" "uuid", "topic_slug" "text", "category_id" "uuid", "category_slug" "text", "post_id" "uuid", "moderation_status" "text", "is_visible" boolean, "is_flagged" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_category public.forum_categories%ROWTYPE;
  v_topic_id uuid;
  v_post_id uuid;
BEGIN
  IF v_jwt_role <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required';
  END IF;

  IF p_category_slug IS NULL OR btrim(p_category_slug) = '' THEN
    RAISE EXCEPTION 'category_required';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'title_required';
  END IF;

  IF p_topic_slug IS NULL OR btrim(p_topic_slug) = '' THEN
    RAISE EXCEPTION 'topic_slug_required';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'content_required';
  END IF;

  SELECT *
  INTO v_category
  FROM public.forum_categories
  WHERE slug = p_category_slug
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  IF NOT public.forum_can_access_category(v_category.id, p_user_id) THEN
    RAISE EXCEPTION 'category_access_denied';
  END IF;

  INSERT INTO public.forum_topics (
    category_id,
    user_id,
    title,
    slug
  )
  VALUES (
    v_category.id,
    p_user_id,
    btrim(p_title),
    btrim(p_topic_slug)
  )
  RETURNING id INTO v_topic_id;

  INSERT INTO public.forum_posts (
    topic_id,
    user_id,
    content,
    moderation_status,
    is_visible,
    is_flagged,
    moderation_score,
    moderation_reason,
    moderated_at,
    moderation_model,
    is_ai_generated,
    ai_agent_name,
    source_post_id
  )
  VALUES (
    v_topic_id,
    p_user_id,
    btrim(p_content),
    COALESCE(NULLIF(btrim(COALESCE(p_moderation_status, '')), ''), 'allowed'),
    COALESCE(p_is_visible, true),
    COALESCE(p_is_flagged, false),
    p_moderation_score,
    p_moderation_reason,
    now(),
    p_moderation_model,
    COALESCE(p_is_ai_generated, false),
    p_ai_agent_name,
    p_source_post_id
  )
  RETURNING id INTO v_post_id;

  IF COALESCE(p_is_ai_generated, false) THEN
    UPDATE public.forum_topics
    SET last_ai_reply_at = now()
    WHERE id = v_topic_id;
  END IF;

  INSERT INTO public.forum_moderation_logs (
    post_id,
    topic_id,
    source,
    model,
    score,
    decision,
    reason,
    raw_response
  )
  VALUES (
    v_post_id,
    v_topic_id,
    COALESCE(NULLIF(btrim(COALESCE(p_source, '')), ''), 'forum_rpc'),
    p_moderation_model,
    p_moderation_score,
    COALESCE(NULLIF(btrim(COALESCE(p_moderation_status, '')), ''), 'allowed'),
    p_moderation_reason,
    COALESCE(p_raw_response, '{}'::jsonb)
  );

  RETURN QUERY
  SELECT
    v_topic_id,
    p_topic_slug,
    v_category.id,
    v_category.slug,
    v_post_id,
    COALESCE(NULLIF(btrim(COALESCE(p_moderation_status, '')), ''), 'allowed'),
    COALESCE(p_is_visible, true),
    COALESCE(p_is_flagged, false);
END;
$$;


ALTER FUNCTION "public"."rpc_forum_create_topic"("p_user_id" "uuid", "p_category_slug" "text", "p_title" "text", "p_topic_slug" "text", "p_content" "text", "p_source" "text", "p_moderation_status" "text", "p_is_visible" boolean, "p_is_flagged" boolean, "p_moderation_score" numeric, "p_moderation_reason" "text", "p_moderation_model" "text", "p_is_ai_generated" boolean, "p_ai_agent_name" "text", "p_source_post_id" "uuid", "p_raw_response" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_leaderboard"("p_period" "text" DEFAULT 'week'::"text", "p_source" "text" DEFAULT 'overall'::"text", "p_limit" integer DEFAULT 10) RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "xp" bigint, "level" integer, "rank_tier" "text", "forum_xp" bigint, "battle_xp" bigint, "commerce_xp" bigint, "reputation_score" numeric, "period_xp" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH params AS (
    SELECT
      CASE lower(COALESCE(p_period, 'week'))
        WHEN 'month' THEN now() - interval '30 days'
        ELSE now() - interval '7 days'
      END AS period_start,
      CASE lower(COALESCE(p_source, 'overall'))
        WHEN 'forum' THEN 'forum'
        WHEN 'battle' THEN 'battles'
        WHEN 'battles' THEN 'battles'
        WHEN 'commerce' THEN 'commerce'
        ELSE 'overall'
      END AS source_filter,
      GREATEST(1, LEAST(COALESCE(p_limit, 10), 100)) AS row_limit
  ),
  event_scores AS (
    SELECT
      re.user_id,
      COALESCE(sum(re.delta_xp), 0)::bigint AS period_xp
    FROM public.reputation_events re
    CROSS JOIN params p
    WHERE re.created_at >= p.period_start
      AND (
        p.source_filter = 'overall'
        OR re.source = p.source_filter
      )
    GROUP BY re.user_id
  )
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    ur.xp,
    ur.level,
    ur.rank_tier,
    ur.forum_xp,
    ur.battle_xp,
    ur.commerce_xp,
    ur.reputation_score,
    COALESCE(es.period_xp, 0) AS period_xp
  FROM public.user_reputation ur
  JOIN public.user_profiles up ON up.id = ur.user_id
  LEFT JOIN event_scores es ON es.user_id = ur.user_id
  CROSS JOIN params p
  WHERE up.username IS NOT NULL
  ORDER BY
    COALESCE(es.period_xp, 0) DESC,
    CASE p.source_filter
      WHEN 'forum' THEN ur.forum_xp
      WHEN 'battles' THEN ur.battle_xp
      WHEN 'commerce' THEN ur.commerce_xp
      ELSE ur.xp
    END DESC,
    ur.xp DESC,
    up.created_at ASC
  LIMIT (SELECT row_limit FROM params);
$$;


ALTER FUNCTION "public"."rpc_get_leaderboard"("p_period" "text", "p_source" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_like_forum_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inserted_rows integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'post_id_required';
  END IF;

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_like_forum_post') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  -- Gate direct inserts: only this RPC sets this flag for the current transaction.
  PERFORM set_config('app.forum_like_rpc', '1', true);

  IF to_regclass('public.forum_post_likes') IS NOT NULL THEN
    INSERT INTO public.forum_post_likes (post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  ELSIF to_regclass('public.forum_likes') IS NOT NULL THEN
    INSERT INTO public.forum_likes (post_id, user_id)
    VALUES (p_post_id, v_user_id)
    ON CONFLICT (post_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_rows = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'likes_table_not_found';
  END IF;

  IF v_inserted_rows > 0 THEN
    PERFORM public.log_fraud_event('forum_like', v_user_id, NULL, p_post_id);
  END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_like_forum_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_publish_product_version"("p_source_product_id" "uuid", "p_new_data" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."products"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.products%ROWTYPE;
  v_root_id uuid;
  v_next_version integer;
  v_new_product public.products%ROWTYPE;
BEGIN
  SELECT *
  INTO v_source
  FROM public.products
  WHERE id = p_source_product_id
    AND product_type = 'beat'
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF v_actor IS NULL OR v_source.producer_id <> v_actor THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  v_root_id := COALESCE(v_source.parent_product_id, v_source.id);

  PERFORM 1
  FROM public.products
  WHERE parent_product_id = v_root_id
    AND product_type = 'beat'
    AND deleted_at IS NULL
  FOR UPDATE;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.products
  WHERE parent_product_id = v_root_id
    AND product_type = 'beat'
    AND deleted_at IS NULL;

  INSERT INTO public.products (
    producer_id,
    title,
    slug,
    description,
    product_type,
    genre_id,
    mood_id,
    bpm,
    key_signature,
    price,
    cover_image_url,
    is_exclusive,
    is_sold,
    sold_at,
    sold_to_user_id,
    is_published,
    play_count,
    tags,
    duration_seconds,
    file_format,
    license_terms,
    watermark_profile_id,
    deleted_at,
    master_path,
    master_url,
    watermarked_path,
    preview_url,
    exclusive_preview_url,
    watermarked_bucket,
    processing_status,
    processing_error,
    processed_at,
    preview_signature,
    last_watermark_hash,
    preview_version,
    status,
    version,
    version_number,
    parent_product_id,
    original_beat_id,
    archived_at
  )
  VALUES (
    v_source.producer_id,
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'title', '')), ''), v_source.title),
    NULLIF(btrim(COALESCE(p_new_data->>'slug', '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'description', '')), ''), v_source.description),
    'beat',
    COALESCE(NULLIF(COALESCE(p_new_data->>'genre_id', ''), '')::uuid, v_source.genre_id),
    COALESCE(NULLIF(COALESCE(p_new_data->>'mood_id', ''), '')::uuid, v_source.mood_id),
    COALESCE(NULLIF(COALESCE(p_new_data->>'bpm', ''), '')::integer, v_source.bpm),
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'key_signature', '')), ''), v_source.key_signature),
    COALESCE(NULLIF(COALESCE(p_new_data->>'price', ''), '')::integer, v_source.price),
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'cover_image_url', '')), ''), v_source.cover_image_url),
    COALESCE(NULLIF(COALESCE(p_new_data->>'is_exclusive', ''), '')::boolean, v_source.is_exclusive),
    false,
    NULL,
    NULL,
    true,
    0,
    CASE
      WHEN jsonb_typeof(p_new_data->'tags') = 'array' THEN ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(p_new_data->'tags', '[]'::jsonb))
      )
      ELSE v_source.tags
    END,
    COALESCE(NULLIF(COALESCE(p_new_data->>'duration_seconds', ''), '')::integer, v_source.duration_seconds),
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'file_format', '')), ''), v_source.file_format),
    COALESCE(p_new_data->'license_terms', v_source.license_terms),
    v_source.watermark_profile_id,
    NULL,
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'master_path', '')), ''), v_source.master_path),
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'master_url', '')), ''), v_source.master_url),
    NULL,
    NULL,
    NULL,
    COALESCE(NULLIF(btrim(COALESCE(p_new_data->>'watermarked_bucket', '')), ''), v_source.watermarked_bucket),
    'pending',
    NULL,
    NULL,
    NULL,
    NULL,
    1,
    'archived',
    v_next_version,
    v_next_version,
    v_root_id,
    v_root_id,
    now()
  )
  RETURNING * INTO v_new_product;

  UPDATE public.products
  SET
    status = 'archived',
    archived_at = COALESCE(archived_at, now()),
    is_published = false,
    updated_at = now()
  WHERE parent_product_id = v_root_id
    AND status = 'active'
    AND product_type = 'beat'
    AND deleted_at IS NULL;

  UPDATE public.products
  SET
    status = 'active',
    archived_at = NULL,
    is_published = true,
    updated_at = now()
  WHERE id = v_new_product.id
  RETURNING * INTO v_new_product;

  RETURN v_new_product;
END;
$$;


ALTER FUNCTION "public"."rpc_publish_product_version"("p_source_product_id" "uuid", "p_new_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_submit_battle_vote_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_vote public.battle_votes%ROWTYPE;
  v_battle public.battles%ROWTYPE;
  v_winner_product_id uuid;
  v_raw_criteria text[] := COALESCE(p_criteria, ARRAY[]::text[]);
  v_criteria text[];
  v_invalid_criteria text[];
  v_inserted_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_battle_id IS NULL OR p_winner_producer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_feedback_payload';
  END IF;

  IF COALESCE(array_length(v_raw_criteria, 1), 0) = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  IF COALESCE(array_length(v_raw_criteria, 1), 0) > 3 THEN
    RAISE EXCEPTION 'feedback_max_3_criteria';
  END IF;

  SELECT array_agg(DISTINCT normalized.criterion ORDER BY normalized.criterion)
  INTO v_criteria
  FROM (
    SELECT lower(btrim(raw_value)) AS criterion
    FROM unnest(v_raw_criteria) AS raw_value
    WHERE btrim(COALESCE(raw_value, '')) <> ''
  ) AS normalized;

  IF COALESCE(array_length(v_criteria, 1), 0) = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  IF COALESCE(array_length(v_criteria, 1), 0) > 3 THEN
    RAISE EXCEPTION 'feedback_max_3_criteria';
  END IF;

  SELECT array_agg(c)
  INTO v_invalid_criteria
  FROM unnest(v_criteria) AS c
  WHERE c NOT IN (
    'groove',
    'melody',
    'ambience',
    'sound_design',
    'drums',
    'mix',
    'originality',
    'energy',
    'artistic_vibe'
  );

  IF COALESCE(array_length(v_invalid_criteria, 1), 0) > 0 THEN
    RAISE EXCEPTION 'feedback_invalid_criterion';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_submit_battle_vote_feedback') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  SELECT *
  INTO v_vote
  FROM public.battle_votes
  WHERE battle_id = p_battle_id
    AND user_id = v_user_id
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vote_not_found';
  END IF;

  IF v_vote.voted_for_producer_id IS DISTINCT FROM p_winner_producer_id THEN
    RAISE EXCEPTION 'feedback_winner_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_vote_feedback bvf
    WHERE bvf.vote_id = v_vote.id
  ) THEN
    RAISE EXCEPTION 'feedback_already_submitted';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF p_winner_producer_id = v_battle.producer1_id THEN
    v_winner_product_id := v_battle.product1_id;
  ELSIF p_winner_producer_id = v_battle.producer2_id THEN
    v_winner_product_id := v_battle.product2_id;
  ELSE
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_winner_product_id IS NULL THEN
    RAISE EXCEPTION 'winner_product_not_found';
  END IF;

  PERFORM set_config('app.battle_vote_feedback_rpc', '1', true);
  PERFORM set_config('app.user_music_pref_rpc', '1', true);

  INSERT INTO public.battle_vote_feedback (
    vote_id,
    battle_id,
    winner_product_id,
    user_id,
    criterion
  )
  SELECT
    v_vote.id,
    p_battle_id,
    v_winner_product_id,
    v_user_id,
    criterion
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (vote_id, criterion) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  INSERT INTO public.user_music_preferences (
    user_id,
    criterion,
    score,
    updated_at
  )
  SELECT
    v_user_id,
    criterion,
    1,
    now()
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (user_id, criterion)
  DO UPDATE SET
    score = public.user_music_preferences.score + 1,
    updated_at = now();

  RETURN v_inserted_count;
END;
$$;


ALTER FUNCTION "public"."rpc_submit_battle_vote_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_vote_with_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_battle public.battles%ROWTYPE;
  v_vote_id uuid;
  v_winner_product_id uuid;
  v_raw_criteria text[] := COALESCE(p_criteria, ARRAY[]::text[]);
  v_criteria text[];
  v_invalid_criteria text[];
  v_feedback_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_battle_id IS NULL OR p_winner_producer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_feedback_payload';
  END IF;

  IF NOT public.is_email_verified_user(v_user_id) THEN
    RAISE EXCEPTION 'vote_not_allowed_unverified_email';
  END IF;

  IF NOT public.is_account_old_enough(v_user_id, interval '24 hours') THEN
    RAISE EXCEPTION 'account_too_new';
  END IF;

  IF NOT public.check_rpc_rate_limit(v_user_id, 'rpc_vote_with_feedback') THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;

  IF COALESCE(array_length(v_raw_criteria, 1), 0) = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  IF COALESCE(array_length(v_raw_criteria, 1), 0) > 3 THEN
    RAISE EXCEPTION 'feedback_max_3_criteria';
  END IF;

  SELECT array_agg(DISTINCT normalized.criterion ORDER BY normalized.criterion)
  INTO v_criteria
  FROM (
    SELECT lower(btrim(raw_value)) AS criterion
    FROM unnest(v_raw_criteria) AS raw_value
    WHERE btrim(COALESCE(raw_value, '')) <> ''
  ) AS normalized;

  IF COALESCE(array_length(v_criteria, 1), 0) = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  IF COALESCE(array_length(v_criteria, 1), 0) > 3 THEN
    RAISE EXCEPTION 'feedback_max_3_criteria';
  END IF;

  SELECT array_agg(c)
  INTO v_invalid_criteria
  FROM unnest(v_criteria) AS c
  WHERE c NOT IN (
    'groove',
    'melody',
    'ambience',
    'sound_design',
    'drums',
    'mix',
    'originality',
    'energy',
    'artistic_vibe'
  );

  IF COALESCE(array_length(v_invalid_criteria, 1), 0) > 0 THEN
    RAISE EXCEPTION 'feedback_invalid_criterion';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF v_battle.status != 'active' THEN
    RAISE EXCEPTION 'battle_not_open_for_voting';
  END IF;

  IF v_battle.starts_at IS NULL OR now() < v_battle.starts_at THEN
    RAISE EXCEPTION 'battle_not_started';
  END IF;

  IF v_battle.voting_ends_at IS NULL OR now() >= v_battle.voting_ends_at THEN
    RAISE EXCEPTION 'battle_voting_expired';
  END IF;

  IF v_battle.producer1_id IS NULL OR v_battle.producer2_id IS NULL THEN
    RAISE EXCEPTION 'battle_not_ready_for_voting';
  END IF;

  IF p_winner_producer_id != v_battle.producer1_id
     AND p_winner_producer_id != v_battle.producer2_id THEN
    RAISE EXCEPTION 'invalid_vote_target';
  END IF;

  IF v_user_id = v_battle.producer1_id
     OR v_user_id = v_battle.producer2_id THEN
    RAISE EXCEPTION 'participants_cannot_vote';
  END IF;

  IF p_winner_producer_id = v_user_id THEN
    RAISE EXCEPTION 'self_vote_not_allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes bv
    WHERE bv.battle_id = p_battle_id
      AND bv.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'already_voted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battle_votes bv
    WHERE bv.user_id = v_user_id
      AND bv.created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'vote_cooldown';
  END IF;

  IF p_winner_producer_id = v_battle.producer1_id THEN
    v_winner_product_id := v_battle.product1_id;
  ELSE
    v_winner_product_id := v_battle.product2_id;
  END IF;

  IF v_winner_product_id IS NULL THEN
    RAISE EXCEPTION 'winner_product_not_found';
  END IF;

  -- Gate direct inserts: only this RPC enables write paths for this transaction.
  PERFORM set_config('app.battle_vote_rpc', '1', true);
  PERFORM set_config('app.battle_vote_feedback_rpc', '1', true);
  PERFORM set_config('app.user_music_pref_rpc', '1', true);

  INSERT INTO public.battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, v_user_id, p_winner_producer_id)
  RETURNING id INTO v_vote_id;

  IF p_winner_producer_id = v_battle.producer1_id THEN
    UPDATE public.battles
    SET votes_producer1 = votes_producer1 + 1
    WHERE id = p_battle_id;
  ELSE
    UPDATE public.battles
    SET votes_producer2 = votes_producer2 + 1
    WHERE id = p_battle_id;
  END IF;

  INSERT INTO public.battle_vote_feedback (
    vote_id,
    battle_id,
    winner_product_id,
    user_id,
    criterion
  )
  SELECT
    v_vote_id,
    p_battle_id,
    v_winner_product_id,
    v_user_id,
    criterion
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (vote_id, criterion) DO NOTHING;

  GET DIAGNOSTICS v_feedback_count = ROW_COUNT;

  IF v_feedback_count = 0 THEN
    RAISE EXCEPTION 'feedback_empty';
  END IF;

  INSERT INTO public.user_music_preferences (
    user_id,
    criterion,
    score,
    updated_at
  )
  SELECT
    v_user_id,
    criterion,
    1,
    now()
  FROM unnest(v_criteria) AS criterion
  ON CONFLICT (user_id, criterion)
  DO UPDATE SET
    score = public.user_music_preferences.score + 1,
    updated_at = now();

  PERFORM public.log_fraud_event('battle_vote', v_user_id, p_battle_id, NULL);

  RETURN jsonb_build_object(
    'vote_id', v_vote_id,
    'battle_id', p_battle_id,
    'feedback_count', v_feedback_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_voted';
END;
$$;


ALTER FUNCTION "public"."rpc_vote_with_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_producer_subscription_flags"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  NEW.is_producer_active :=
    (NEW.subscription_status IN ('active','trialing'))
    AND (NEW.current_period_end > now());
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_producer_subscription_flags"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."should_flag_battle_refusal_risk"("p_user_id" "uuid", "p_threshold" integer DEFAULT 5) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_refusals integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.battle_refusal_count, 0)
  INTO v_refusals
  FROM public.user_profiles up
  WHERE up.id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Intentionally informational only for now (not auto-enforced in policies).
  RETURN v_refusals >= GREATEST(1, COALESCE(p_threshold, 5));
END;
$$;


ALTER FUNCTION "public"."should_flag_battle_refusal_risk"("p_user_id" "uuid", "p_threshold" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suggest_opponents"("p_user_id" "uuid") RETURNS TABLE("user_id" "uuid", "username" "text", "avatar_url" "text", "producer_tier" "public"."producer_tier_type", "elo_rating" integer, "battle_wins" integer, "battle_losses" integer, "battle_draws" integer, "elo_diff" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_user_rating integer := 1200;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND v_actor = p_user_id)
    OR public.is_admin(v_actor)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_user_rating
  FROM public.user_profiles up
  WHERE up.id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(up.elo_rating, 1200) AS elo_rating,
    COALESCE(up.battle_wins, 0) AS battle_wins,
    COALESCE(up.battle_losses, 0) AS battle_losses,
    COALESCE(up.battle_draws, 0) AS battle_draws,
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role IN ('producer', 'admin')
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 400
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(up.elo_rating, 1200) AS elo_rating,
    COALESCE(up.battle_wins, 0) AS battle_wins,
    COALESCE(up.battle_losses, 0) AS battle_losses,
    COALESCE(up.battle_draws, 0) AS battle_draws,
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role IN ('producer', 'admin')
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 600
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.username,
    up.avatar_url,
    up.producer_tier,
    COALESCE(up.elo_rating, 1200) AS elo_rating,
    COALESCE(up.battle_wins, 0) AS battle_wins,
    COALESCE(up.battle_losses, 0) AS battle_losses,
    COALESCE(up.battle_draws, 0) AS battle_draws,
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating)::integer AS elo_diff
  FROM public.user_profiles up
  WHERE up.id <> p_user_id
    AND up.is_producer_active = true
    AND up.role IN ('producer', 'admin')
    AND ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) <= 800
  ORDER BY
    ABS(COALESCE(up.elo_rating, 1200) - v_user_rating) ASC,
    COALESCE(up.elo_rating, 1200) DESC,
    up.username ASC NULLS LAST
  LIMIT 10;
END;
$$;


ALTER FUNCTION "public"."suggest_opponents"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_executed_ai_actions_to_admin_action_audit_log"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.status <> 'executed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'executed' THEN
    RETURN NEW;
  END IF;

  PERFORM public.log_admin_action_audit(
    p_admin_user_id => NEW.executed_by,
    p_action_type => NEW.action_type,
    p_entity_type => NEW.entity_type,
    p_entity_id => NEW.entity_id,
    p_source => 'ai_admin_actions',
    p_source_action_id => NEW.id,
    p_context => jsonb_build_object(
      'trigger_operation', TG_OP,
      'executed_at', NEW.executed_at,
      'confidence_score', NEW.confidence_score,
      'human_override', NEW.human_override,
      'reversible', NEW.reversible
    ),
    p_extra_details => COALESCE(NEW.ai_decision, '{}'::jsonb) || jsonb_build_object(
      'reason', NEW.reason
    ),
    p_success => true,
    p_error => NEW.error
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_executed_ai_actions_to_admin_action_audit_log"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_profile_producer_flag"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.user_profiles
    SET is_producer_active = NEW.is_producer_active,
        updated_at = now()
    WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_profile_producer_flag"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_reputation_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.ensure_user_reputation_row(NEW.id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_reputation_row"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_elo_rating"("p_player1" "uuid", "p_player2" "uuid", "p_winner" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rating1 integer := 1200;
  v_rating2 integer := 1200;
  v_expected1 numeric := 0.5;
  v_expected2 numeric := 0.5;
  v_score1 numeric := 0.5;
  v_score2 numeric := 0.5;
  v_k numeric := 32;
  v_new1 integer := 1200;
  v_new2 integer := 1200;
BEGIN
  IF p_player1 IS NULL OR p_player2 IS NULL OR p_player1 = p_player2 THEN
    RETURN false;
  END IF;

  IF p_winner IS NOT NULL
     AND p_winner <> p_player1
     AND p_winner <> p_player2 THEN
    RAISE EXCEPTION 'invalid_winner_for_elo';
  END IF;

  PERFORM 1
  FROM public.user_profiles up
  WHERE up.id IN (p_player1, p_player2)
  ORDER BY up.id
  FOR UPDATE;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_rating1
  FROM public.user_profiles up
  WHERE up.id = p_player1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(up.elo_rating, 1200)
  INTO v_rating2
  FROM public.user_profiles up
  WHERE up.id = p_player2;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_winner = p_player1 THEN
    v_score1 := 1;
    v_score2 := 0;
  ELSIF p_winner = p_player2 THEN
    v_score1 := 0;
    v_score2 := 1;
  ELSE
    v_score1 := 0.5;
    v_score2 := 0.5;
  END IF;

  v_expected1 := 1 / (1 + power(10::numeric, (v_rating2 - v_rating1)::numeric / 400));
  v_expected2 := 1 / (1 + power(10::numeric, (v_rating1 - v_rating2)::numeric / 400));

  v_new1 := GREATEST(100, round(v_rating1 + (v_k * (v_score1 - v_expected1)))::integer);
  v_new2 := GREATEST(100, round(v_rating2 + (v_k * (v_score2 - v_expected2)))::integer);

  UPDATE public.user_profiles
  SET
    elo_rating = v_new1,
    battle_wins = COALESCE(battle_wins, 0) + CASE WHEN p_winner = p_player1 THEN 1 ELSE 0 END,
    battle_losses = COALESCE(battle_losses, 0) + CASE WHEN p_winner = p_player2 THEN 1 ELSE 0 END,
    battle_draws = COALESCE(battle_draws, 0) + CASE WHEN p_winner IS NULL THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE id = p_player1;

  UPDATE public.user_profiles
  SET
    elo_rating = v_new2,
    battle_wins = COALESCE(battle_wins, 0) + CASE WHEN p_winner = p_player2 THEN 1 ELSE 0 END,
    battle_losses = COALESCE(battle_losses, 0) + CASE WHEN p_winner = p_player1 THEN 1 ELSE 0 END,
    battle_draws = COALESCE(battle_draws, 0) + CASE WHEN p_winner IS NULL THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE id = p_player2;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."update_elo_rating"("p_player1" "uuid", "p_player2" "uuid", "p_winner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_battle_product_snapshot"("p_battle_id" "uuid", "p_slot" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_battle public.battles%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_producer_id uuid;
BEGIN
  IF p_slot NOT IN ('producer1', 'producer2') THEN
    RAISE EXCEPTION 'invalid_battle_snapshot_slot';
  END IF;

  SELECT *
  INTO v_battle
  FROM public.battles
  WHERE id = p_battle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'battle_not_found';
  END IF;

  IF p_slot = 'producer1' THEN
    v_product_id := v_battle.product1_id;
    v_producer_id := v_battle.producer1_id;
  ELSE
    v_product_id := v_battle.product2_id;
    v_producer_id := v_battle.producer2_id;
  END IF;

  IF v_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = v_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.battle_product_snapshots (
    battle_id,
    slot,
    product_id,
    producer_id,
    title_snapshot,
    preview_url_snapshot
  )
  VALUES (
    p_battle_id,
    p_slot,
    v_product.id,
    COALESCE(v_product.producer_id, v_producer_id),
    NULLIF(btrim(COALESCE(v_product.title, '')), ''),
    NULLIF(btrim(COALESCE(v_product.preview_url, '')), '')
  )
  ON CONFLICT (battle_id, slot)
  DO UPDATE
  SET
    product_id = COALESCE(EXCLUDED.product_id, battle_product_snapshots.product_id),
    producer_id = COALESCE(EXCLUDED.producer_id, battle_product_snapshots.producer_id),
    title_snapshot = COALESCE(EXCLUDED.title_snapshot, battle_product_snapshots.title_snapshot),
    preview_url_snapshot = COALESCE(EXCLUDED.preview_url_snapshot, battle_product_snapshots.preview_url_snapshot),
    updated_at = now();
END;
$$;


ALTER FUNCTION "public"."upsert_battle_product_snapshot"("p_battle_id" "uuid", "p_slot" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_entitlement"("p_user_id" "uuid", "p_product_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM entitlements 
    WHERE user_id = p_user_id 
    AND product_id = p_product_id 
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );
END;
$$;


ALTER FUNCTION "public"."user_has_entitlement"("p_user_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_action_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_user_id" "uuid",
    "action_type" "text" NOT NULL,
    "entity_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "entity_id" "uuid",
    "source" "text" DEFAULT 'rpc'::"text" NOT NULL,
    "source_action_id" "uuid",
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "extra_details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "success" boolean DEFAULT true NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_action_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_quality_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "votes_total" bigint DEFAULT 0 NOT NULL,
    "votes_for_product" bigint DEFAULT 0 NOT NULL,
    "win_rate" numeric(6,3) DEFAULT 0 NOT NULL,
    "preference_score" numeric(6,3) DEFAULT 0 NOT NULL,
    "artistic_score" numeric(6,3) DEFAULT 0 NOT NULL,
    "coherence_score" numeric(6,3) DEFAULT 0 NOT NULL,
    "credibility_score" numeric(6,3) DEFAULT 0 NOT NULL,
    "quality_index" numeric(6,3) DEFAULT 0 NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "battle_quality_snapshots_non_negative_votes" CHECK ((("votes_total" >= 0) AND ("votes_for_product" >= 0))),
    CONSTRAINT "battle_quality_snapshots_scores_range" CHECK (((("win_rate" >= (0)::numeric) AND ("win_rate" <= (100)::numeric)) AND (("preference_score" >= (0)::numeric) AND ("preference_score" <= (100)::numeric)) AND (("artistic_score" >= (0)::numeric) AND ("artistic_score" <= (100)::numeric)) AND (("coherence_score" >= (0)::numeric) AND ("coherence_score" <= (100)::numeric)) AND (("credibility_score" >= (0)::numeric) AND ("credibility_score" <= (100)::numeric)) AND (("quality_index" >= (0)::numeric) AND ("quality_index" <= (100)::numeric))))
);


ALTER TABLE "public"."battle_quality_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "producer1_id" "uuid" NOT NULL,
    "producer2_id" "uuid",
    "product1_id" "uuid",
    "product2_id" "uuid",
    "status" "public"."battle_status" DEFAULT 'pending'::"public"."battle_status" NOT NULL,
    "starts_at" timestamp with time zone,
    "voting_ends_at" timestamp with time zone,
    "winner_id" "uuid",
    "votes_producer1" integer DEFAULT 0 NOT NULL,
    "votes_producer2" integer DEFAULT 0 NOT NULL,
    "featured" boolean DEFAULT false NOT NULL,
    "prize_description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "admin_validated_at" timestamp with time zone,
    "rejection_reason" "text",
    "response_deadline" timestamp with time zone,
    "submission_deadline" timestamp with time zone,
    "custom_duration_days" integer,
    "extension_count" integer DEFAULT 0,
    CONSTRAINT "battles_accept_reject_mutually_exclusive" CHECK ((NOT (("accepted_at" IS NOT NULL) AND ("rejected_at" IS NOT NULL)))),
    CONSTRAINT "battles_custom_duration_positive" CHECK ((("custom_duration_days" IS NULL) OR ("custom_duration_days" > 0))),
    CONSTRAINT "different_producers" CHECK (("producer1_id" <> "producer2_id"))
);


ALTER TABLE "public"."battles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."battles"."status" IS 'Official flow: pending_acceptance -> awaiting_admin -> active -> completed; rejection path: pending_acceptance -> rejected; cancel path: non-terminal -> cancelled. Legacy statuses pending/approved/voting are kept for backward compatibility and blocked for new assignments/transitions.';



CREATE OR REPLACE VIEW "public"."public_producer_profiles" WITH ("security_invoker"='true') AS
 SELECT "up"."id" AS "user_id",
    "public"."get_public_profile_label"("up".*) AS "username",
        CASE
            WHEN ((COALESCE("up"."is_deleted", false) = true) OR ("up"."deleted_at" IS NOT NULL)) THEN NULL::"text"
            ELSE "up"."avatar_url"
        END AS "avatar_url",
    "up"."producer_tier",
        CASE
            WHEN ((COALESCE("up"."is_deleted", false) = true) OR ("up"."deleted_at" IS NOT NULL)) THEN NULL::"text"
            ELSE "up"."bio"
        END AS "bio",
        CASE
            WHEN ((COALESCE("up"."is_deleted", false) = true) OR ("up"."deleted_at" IS NOT NULL)) THEN '{}'::"jsonb"
            ELSE COALESCE("up"."social_links", '{}'::"jsonb")
        END AS "social_links",
    COALESCE("ur"."xp", (0)::bigint) AS "xp",
    COALESCE("ur"."level", 1) AS "level",
    COALESCE("ur"."rank_tier", 'bronze'::"text") AS "rank_tier",
    COALESCE("ur"."reputation_score", (0)::numeric) AS "reputation_score",
    "up"."created_at",
    "up"."updated_at",
    "up"."username" AS "raw_username",
    ((COALESCE("up"."is_deleted", false) = true) OR ("up"."deleted_at" IS NOT NULL)) AS "is_deleted",
    COALESCE("up"."is_producer_active", false) AS "is_producer_active"
   FROM ("public"."user_profiles" "up"
     LEFT JOIN "public"."user_reputation" "ur" ON (("ur"."user_id" = "up"."id")))
  WHERE (NULLIF("btrim"(COALESCE("up"."username", ''::"text")), ''::"text") IS NOT NULL);


ALTER VIEW "public"."public_producer_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_battle_quality_latest" WITH ("security_invoker"='true') AS
 SELECT "bqs"."battle_id",
    "b"."slug" AS "battle_slug",
    "b"."title" AS "battle_title",
    "b"."status" AS "battle_status",
    "bqs"."product_id",
    "p"."title" AS "product_title",
    "p"."producer_id",
    "ppp"."username" AS "producer_username",
    "bqs"."votes_total",
    "bqs"."votes_for_product",
    "bqs"."win_rate",
    "bqs"."preference_score",
    "bqs"."artistic_score",
    "bqs"."coherence_score",
    "bqs"."credibility_score",
    "bqs"."quality_index",
    "bqs"."meta",
    "bqs"."computed_at",
    "bqs"."updated_at"
   FROM ((("public"."battle_quality_snapshots" "bqs"
     JOIN "public"."battles" "b" ON (("b"."id" = "bqs"."battle_id")))
     JOIN "public"."products" "p" ON (("p"."id" = "bqs"."product_id")))
     LEFT JOIN "public"."public_producer_profiles" "ppp" ON (("ppp"."user_id" = "p"."producer_id")));


ALTER VIEW "public"."admin_battle_quality_latest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_vote_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vote_id" "uuid" NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "winner_product_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "criterion" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "battle_vote_feedback_criterion_check" CHECK (("criterion" = ANY (ARRAY['groove'::"text", 'melody'::"text", 'ambience'::"text", 'sound_design'::"text", 'drums'::"text", 'mix'::"text", 'originality'::"text", 'energy'::"text", 'artistic_vibe'::"text"])))
);


ALTER TABLE "public"."battle_vote_feedback" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_beat_feedback_scores" WITH ("security_invoker"='true') AS
 WITH "base" AS (
         SELECT "bf"."winner_product_id" AS "product_id",
            "bf"."criterion",
            "count"(*) AS "criterion_count"
           FROM "public"."battle_vote_feedback" "bf"
          GROUP BY "bf"."winner_product_id", "bf"."criterion"
        ), "score_counts" AS (
         SELECT "b"."product_id",
            (COALESCE("sum"("b"."criterion_count"), (0)::numeric))::bigint AS "total_feedback",
            (COALESCE("sum"("b"."criterion_count") FILTER (WHERE ("b"."criterion" = ANY (ARRAY['groove'::"text", 'energy'::"text"]))), (0)::numeric))::bigint AS "structure_raw",
            (COALESCE("sum"("b"."criterion_count") FILTER (WHERE ("b"."criterion" = ANY (ARRAY['melody'::"text", 'ambience'::"text"]))), (0)::numeric))::bigint AS "melody_raw",
            (COALESCE("sum"("b"."criterion_count") FILTER (WHERE ("b"."criterion" = ANY (ARRAY['groove'::"text", 'drums'::"text", 'energy'::"text"]))), (0)::numeric))::bigint AS "rhythm_raw",
            (COALESCE("sum"("b"."criterion_count") FILTER (WHERE ("b"."criterion" = 'sound_design'::"text")), (0)::numeric))::bigint AS "sound_design_raw",
            (COALESCE("sum"("b"."criterion_count") FILTER (WHERE ("b"."criterion" = 'mix'::"text")), (0)::numeric))::bigint AS "mix_raw",
            (COALESCE("sum"("b"."criterion_count") FILTER (WHERE ("b"."criterion" = ANY (ARRAY['originality'::"text", 'artistic_vibe'::"text"]))), (0)::numeric))::bigint AS "identity_raw"
           FROM "base" "b"
          GROUP BY "b"."product_id"
        )
 SELECT "product_id",
    "total_feedback",
        CASE
            WHEN ("total_feedback" > 0) THEN "round"(((("structure_raw")::numeric / ("total_feedback")::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "structure_score",
        CASE
            WHEN ("total_feedback" > 0) THEN "round"(((("melody_raw")::numeric / ("total_feedback")::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "melody_score",
        CASE
            WHEN ("total_feedback" > 0) THEN "round"(((("rhythm_raw")::numeric / ("total_feedback")::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "rhythm_score",
        CASE
            WHEN ("total_feedback" > 0) THEN "round"(((("sound_design_raw")::numeric / ("total_feedback")::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "sound_design_score",
        CASE
            WHEN ("total_feedback" > 0) THEN "round"(((("mix_raw")::numeric / ("total_feedback")::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "mix_score",
        CASE
            WHEN ("total_feedback" > 0) THEN "round"(((("identity_raw")::numeric / ("total_feedback")::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "identity_score"
   FROM "score_counts" "s";


ALTER VIEW "public"."admin_beat_feedback_scores" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_beat_feedback_top_criteria" WITH ("security_invoker"='true') AS
 SELECT "winner_product_id" AS "product_id",
    "criterion",
    "criterion_count",
    ("row_number"() OVER (PARTITION BY "winner_product_id" ORDER BY "criterion_count" DESC, "criterion"))::integer AS "rank"
   FROM ( SELECT "bf"."winner_product_id",
            "bf"."criterion",
            "count"(*) AS "criterion_count"
           FROM "public"."battle_vote_feedback" "bf"
          GROUP BY "bf"."winner_product_id", "bf"."criterion") "agg";


ALTER VIEW "public"."admin_beat_feedback_top_criteria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_admin_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "ai_decision" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidence_score" numeric(5,4),
    "reason" "text",
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "human_override" boolean DEFAULT false NOT NULL,
    "reversible" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "executed_at" timestamp with time zone,
    "executed_by" "uuid",
    "error" "text",
    CONSTRAINT "ai_admin_actions_confidence_score_check" CHECK ((("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (1)::numeric))),
    CONSTRAINT "ai_admin_actions_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['battle'::"text", 'comment'::"text", 'other'::"text"]))),
    CONSTRAINT "ai_admin_actions_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'executed'::"text", 'failed'::"text", 'overridden'::"text"])))
);


ALTER TABLE "public"."ai_admin_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_training_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "action_id" "uuid" NOT NULL,
    "ai_prediction" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "human_decision" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "delta" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."ai_training_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fraud_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "user_id" "uuid",
    "battle_id" "uuid",
    "post_id" "uuid",
    "ip_hash" "text",
    "ua_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fraud_events" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."battle_fraud_analysis" WITH ("security_invoker"='true') AS
 SELECT "battle_id",
    "count"(*) FILTER (WHERE ("event_type" = 'battle_vote'::"text")) AS "vote_events",
    "count"(DISTINCT "ip_hash") FILTER (WHERE ("event_type" = 'battle_vote'::"text")) AS "unique_ip_hashes",
    "count"(DISTINCT "ua_hash") FILTER (WHERE ("event_type" = 'battle_vote'::"text")) AS "unique_ua_hashes",
    ("count"(*) FILTER (WHERE ("event_type" = 'battle_vote'::"text")) - "count"(DISTINCT "ip_hash") FILTER (WHERE ("event_type" = 'battle_vote'::"text"))) AS "suspicious_by_ip"
   FROM "public"."fraud_events" "fe"
  WHERE ("battle_id" IS NOT NULL)
  GROUP BY "battle_id";


ALTER VIEW "public"."battle_fraud_analysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "voted_for_producer_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."battle_votes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."battle_of_the_day" WITH ("security_invoker"='true') AS
 WITH "daily_votes" AS (
         SELECT "bv"."battle_id",
            ("count"(*))::integer AS "votes_today"
           FROM "public"."battle_votes" "bv"
          WHERE (("bv"."created_at" >= "date_trunc"('day'::"text", "now"())) AND ("bv"."created_at" < ("date_trunc"('day'::"text", "now"()) + '1 day'::interval)))
          GROUP BY "bv"."battle_id"
        ), "ranked" AS (
         SELECT "b"."id" AS "battle_id",
            "b"."slug",
            "b"."title",
            "b"."status",
            "b"."producer1_id",
            "b"."producer2_id",
            "b"."winner_id",
            "b"."votes_producer1",
            "b"."votes_producer2",
            "dv"."votes_today",
            (COALESCE("b"."votes_producer1", 0) + COALESCE("b"."votes_producer2", 0)) AS "votes_total",
            "row_number"() OVER (ORDER BY "dv"."votes_today" DESC, (COALESCE("b"."votes_producer1", 0) + COALESCE("b"."votes_producer2", 0)) DESC, "b"."updated_at" DESC, "b"."id") AS "rn"
           FROM ("daily_votes" "dv"
             JOIN "public"."battles" "b" ON (("b"."id" = "dv"."battle_id")))
        )
 SELECT "r"."battle_id",
    "r"."slug",
    "r"."title",
    "r"."status",
    "r"."producer1_id",
    "p1"."username" AS "producer1_username",
    "r"."producer2_id",
    "p2"."username" AS "producer2_username",
    "r"."winner_id",
    "r"."votes_today",
    "r"."votes_total"
   FROM (("ranked" "r"
     LEFT JOIN "public"."public_producer_profiles" "p1" ON (("p1"."user_id" = "r"."producer1_id")))
     LEFT JOIN "public"."public_producer_profiles" "p2" ON (("p2"."user_id" = "r"."producer2_id")))
  WHERE ("r"."rn" = 1);


ALTER VIEW "public"."battle_of_the_day" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_product_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "slot" "text" NOT NULL,
    "product_id" "uuid",
    "producer_id" "uuid",
    "title_snapshot" "text",
    "preview_url_snapshot" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "battle_product_snapshots_slot_check" CHECK (("slot" = ANY (ARRAY['producer1'::"text", 'producer2'::"text"])))
);


ALTER TABLE "public"."battle_product_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cart_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "license_type" "text" DEFAULT 'standard'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cart_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitive_seasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "competitive_seasons_valid_dates" CHECK (("end_date" > "start_date"))
);


ALTER TABLE "public"."competitive_seasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "name" "text",
    "email" "text",
    "subject" "text" NOT NULL,
    "category" "text" DEFAULT 'support'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "origin_page" "text",
    "user_agent" "text",
    "ip_address" "inet",
    CONSTRAINT "contact_messages_category_check" CHECK (("category" = ANY (ARRAY['support'::"text", 'battle'::"text", 'payment'::"text", 'partnership'::"text", 'other'::"text"]))),
    CONSTRAINT "contact_messages_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text"]))),
    CONSTRAINT "contact_messages_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'in_progress'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."contact_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_submit_rate_limit" (
    "ip_hash" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "counter" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contact_submit_rate_limit_counter_check" CHECK (("counter" >= 0))
);


ALTER TABLE "public"."contact_submit_rate_limit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contract_url_rate_limit_counters" (
    "purchase_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contract_url_rate_limit_counters_request_count_check" CHECK (("request_count" >= 0))
);


ALTER TABLE "public"."contract_url_rate_limit_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."download_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "downloaded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."download_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."elite_interest" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."elite_interest" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "purchase_id" "uuid",
    "entitlement_type" "public"."entitlement_type" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exclusive_locks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_checkout_session_id" "text" NOT NULL,
    "locked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:15:00'::interval) NOT NULL
);


ALTER TABLE "public"."exclusive_locks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_assistant_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic_id" "uuid" NOT NULL,
    "source_post_id" "uuid",
    "trigger_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    CONSTRAINT "forum_assistant_jobs_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "forum_assistant_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'failed'::"text"]))),
    CONSTRAINT "forum_assistant_jobs_trigger_type_check" CHECK (("trigger_type" = ANY (ARRAY['mention'::"text", 'no_reply_cron'::"text"])))
);


ALTER TABLE "public"."forum_assistant_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "is_premium_only" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "xp_multiplier" numeric DEFAULT 1 NOT NULL,
    "moderation_strictness" "text" DEFAULT 'normal'::"text" NOT NULL,
    "is_competitive" boolean DEFAULT false NOT NULL,
    "required_rank_tier" "text",
    "allow_links" boolean DEFAULT true NOT NULL,
    "allow_media" boolean DEFAULT true NOT NULL,
    CONSTRAINT "forum_categories_moderation_strictness_check" CHECK (("moderation_strictness" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text"]))),
    CONSTRAINT "forum_categories_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "forum_categories_required_rank_tier_check" CHECK (("required_rank_tier" = ANY (ARRAY['bronze'::"text", 'silver'::"text", 'gold'::"text", 'platinum'::"text", 'diamond'::"text"]))),
    CONSTRAINT "forum_categories_slug_check" CHECK (("btrim"("slug") <> ''::"text")),
    CONSTRAINT "forum_categories_xp_multiplier_check" CHECK (("xp_multiplier" > (0)::numeric))
);


ALTER TABLE "public"."forum_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."forum_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_moderation_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid",
    "topic_id" "uuid",
    "source" "text" NOT NULL,
    "model" "text",
    "score" numeric(5,4),
    "decision" "text" NOT NULL,
    "reason" "text",
    "raw_response" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "forum_moderation_logs_score_check" CHECK ((("score" IS NULL) OR (("score" >= (0)::numeric) AND ("score" <= (1)::numeric))))
);


ALTER TABLE "public"."forum_moderation_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_post_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."forum_post_likes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."forum_public_profiles" WITH ("security_invoker"='true') AS
 SELECT "user_id",
    "username",
    "avatar_url",
    "producer_tier",
    "xp",
    "level",
    "rank_tier",
    "reputation_score",
    "created_at",
    "updated_at"
   FROM "public"."get_forum_public_profiles"() "get_forum_public_profiles"("user_id", "username", "avatar_url", "producer_tier", "xp", "level", "rank_tier", "reputation_score", "created_at", "updated_at");


ALTER VIEW "public"."forum_public_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."genres" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "name_de" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."genres" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."leaderboard_producers" WITH ("security_invoker"='true') AS
 SELECT "user_id",
    "username",
    "avatar_url",
    "producer_tier",
    "elo_rating",
    "battle_wins",
    "battle_losses",
    "battle_draws",
    "total_battles",
    "win_rate",
    "rank_position"
   FROM "public"."get_leaderboard_producers"() "get_leaderboard_producers"("user_id", "username", "avatar_url", "producer_tier", "elo_rating", "battle_wins", "battle_losses", "battle_draws", "total_battles", "win_rate", "rank_position")
  ORDER BY "rank_position";


ALTER VIEW "public"."leaderboard_producers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."licenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "max_streams" integer,
    "max_sales" integer,
    "youtube_monetization" boolean DEFAULT false NOT NULL,
    "music_video_allowed" boolean DEFAULT false NOT NULL,
    "credit_required" boolean DEFAULT true NOT NULL,
    "exclusive_allowed" boolean DEFAULT false NOT NULL,
    "price" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "licenses_max_sales_check" CHECK ((("max_sales" IS NULL) OR ("max_sales" >= 0))),
    CONSTRAINT "licenses_max_streams_check" CHECK ((("max_streams" IS NULL) OR ("max_streams" >= 0))),
    CONSTRAINT "licenses_price_check" CHECK (("price" >= 0))
);


ALTER TABLE "public"."licenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitoring_alert_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "source" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "monitoring_alert_events_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."monitoring_alert_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "name_de" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."moods" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."my_user_profile" WITH ("security_invoker"='true') AS
 SELECT "id",
    "id" AS "user_id",
    "username",
    "full_name",
    "avatar_url",
    "role",
    "producer_tier",
    "is_producer_active",
    "total_purchases",
    "confirmed_at",
    "producer_verified_at",
    "battle_refusal_count",
    "battles_participated",
    "battles_completed",
    "engagement_score",
    "language",
    "bio",
    "website_url",
    "social_links",
    "created_at",
    "updated_at",
    "is_deleted",
    "deleted_at",
    "delete_reason",
    "deleted_label"
   FROM "public"."user_profiles" "up"
  WHERE ("id" = "auth"."uid"());


ALTER VIEW "public"."my_user_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."news_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "video_url" "text" NOT NULL,
    "thumbnail_url" "text",
    "is_published" boolean DEFAULT false NOT NULL,
    "broadcast_email" boolean DEFAULT false NOT NULL,
    "broadcast_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."news_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_email_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "dedupe_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_email_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."play_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "played_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedupe_bucket" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."play_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."preview_access_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "product_id" "uuid" NOT NULL,
    "preview_type" "text" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preview_access_logs_preview_type_check" CHECK (("preview_type" = ANY (ARRAY['standard'::"text", 'exclusive'::"text"])))
);


ALTER TABLE "public"."preview_access_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producer_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "condition_type" "text" NOT NULL,
    "condition_value" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "producer_badges_condition_type_check" CHECK (("condition_type" = ANY (ARRAY['total_battles'::"text", 'total_wins'::"text", 'leaderboard_top'::"text", 'season_champion'::"text", 'season_top10'::"text", 'season_top100'::"text"]))),
    CONSTRAINT "producer_badges_condition_value_check" CHECK (("condition_value" > 0))
);


ALTER TABLE "public"."producer_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producer_plan_config" (
    "id" boolean DEFAULT true NOT NULL,
    "stripe_price_id" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "interval" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "producer_plan_config_id_check" CHECK ("id"),
    CONSTRAINT "producer_plan_config_interval_check" CHECK (("interval" = 'month'::"text"))
);


ALTER TABLE "public"."producer_plan_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."producer_plan_config" IS 'DEPRECATED: legacy single-plan table. Use public.producer_plans.';



CREATE TABLE IF NOT EXISTS "public"."producer_plans" (
    "tier" "public"."producer_tier_type" NOT NULL,
    "max_beats_published" integer,
    "max_battles_created_per_month" integer,
    "commission_rate" numeric(5,4) NOT NULL,
    "stripe_price_id" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amount_cents" integer,
    CONSTRAINT "producer_plans_amount_cents_non_negative" CHECK ((("amount_cents" IS NULL) OR ("amount_cents" >= 0))),
    CONSTRAINT "producer_plans_commission_rate_check" CHECK ((("commission_rate" >= (0)::numeric) AND ("commission_rate" <= (1)::numeric))),
    CONSTRAINT "producer_plans_max_battles_created_per_month_check" CHECK ((("max_battles_created_per_month" IS NULL) OR ("max_battles_created_per_month" >= 0))),
    CONSTRAINT "producer_plans_max_beats_published_check" CHECK ((("max_beats_published" IS NULL) OR ("max_beats_published" >= 0)))
);


ALTER TABLE "public"."producer_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "producer_id" "uuid" NOT NULL,
    "stripe_payment_intent_id" "text",
    "stripe_checkout_session_id" "text",
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "status" "public"."purchase_status" DEFAULT 'pending'::"public"."purchase_status" NOT NULL,
    "license_type" "text" DEFAULT 'standard'::"text",
    "is_exclusive" boolean DEFAULT false NOT NULL,
    "download_count" integer DEFAULT 0 NOT NULL,
    "max_downloads" integer DEFAULT 5 NOT NULL,
    "download_expires_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "contract_pdf_path" "text",
    "license_id" "uuid",
    "contract_email_sent_at" timestamp with time zone,
    "beat_title_snapshot" "text",
    "beat_slug_snapshot" "text",
    "audio_path_snapshot" "text",
    "cover_image_url_snapshot" "text",
    "beat_version_snapshot" integer,
    "price_snapshot" integer,
    "currency_snapshot" "text",
    "producer_display_name_snapshot" "text",
    "license_type_snapshot" "text",
    "license_name_snapshot" "text",
    "contract_generated_by" "text",
    "contract_generated_at" timestamp with time zone,
    CONSTRAINT "purchases_amount_check" CHECK (("amount" >= 0)),
    CONSTRAINT "purchases_contract_generated_by_check" CHECK ((("contract_generated_by" IS NULL) OR ("contract_generated_by" = ANY (ARRAY['api'::"text", 'edge_fallback'::"text", 'contract_worker'::"text"]))))
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."producer_stats" WITH ("security_invoker"='true') AS
 SELECT "p"."producer_id",
    "count"(DISTINCT "p"."id") AS "total_products",
    "count"(DISTINCT "p"."id") FILTER (WHERE ("p"."is_published" = true)) AS "published_products",
    "count"(DISTINCT "pur"."id") AS "total_sales",
    COALESCE("sum"("pur"."amount") FILTER (WHERE ("pur"."status" = 'completed'::"public"."purchase_status")), (0)::bigint) AS "total_revenue",
    COALESCE("sum"("p"."play_count"), (0)::bigint) AS "total_plays"
   FROM ("public"."products" "p"
     LEFT JOIN "public"."purchases" "pur" ON (("pur"."product_id" = "p"."id")))
  GROUP BY "p"."producer_id";


ALTER VIEW "public"."producer_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producer_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "stripe_subscription_id" "text" NOT NULL,
    "subscription_status" "text" NOT NULL,
    "current_period_end" timestamp with time zone NOT NULL,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "is_producer_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "producer_subscriptions_subscription_status_check" CHECK (("subscription_status" = ANY (ARRAY['active'::"text", 'trialing'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text", 'incomplete'::"text", 'incomplete_expired'::"text"])))
);


ALTER TABLE "public"."producer_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_size" bigint,
    "file_type" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_files" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."products_public" WITH ("security_invoker"='on') AS
 SELECT "id",
    "title",
    "price",
    "status"
   FROM "public"."products";


ALTER VIEW "public"."products_public" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_producer_profiles_v2" WITH ("security_invoker"='true') AS
 SELECT "user_id",
    "username",
    "avatar_url",
    "producer_tier",
    "bio",
    "social_links",
    "created_at",
    "updated_at"
   FROM "public"."get_public_producer_profiles_v2"() "v2"("user_id", "username", "avatar_url", "producer_tier", "bio", "social_links", "created_at", "updated_at");


ALTER VIEW "public"."public_producer_profiles_v2" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_producer_profiles_v2" IS 'Public producer profiles V2. Allowlist only. No sensitive columns.';



CREATE OR REPLACE VIEW "public"."public_products" WITH ("security_invoker"='true') AS
 SELECT "id",
    "producer_id",
    "title",
    "slug",
    "description",
    "product_type",
    "genre_id",
    "mood_id",
    "bpm",
    "key_signature",
    "price",
    "watermarked_path",
    "preview_url",
    "exclusive_preview_url",
    "cover_image_url",
    "is_exclusive",
    "is_sold",
    "sold_at",
    "sold_to_user_id",
    "is_published",
    "play_count",
    "tags",
    "duration_seconds",
    "file_format",
    "license_terms",
    "watermark_profile_id",
    "created_at",
    "updated_at",
    "deleted_at"
   FROM "public"."products";


ALTER VIEW "public"."public_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reputation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "delta_xp" integer NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reputation_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reputation_rules" (
    "key" "text" NOT NULL,
    "source" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "delta_xp" integer NOT NULL,
    "cooldown_sec" integer DEFAULT 0 NOT NULL,
    "max_per_day" integer,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reputation_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpc_rate_limit_counters" (
    "rpc_name" "text" NOT NULL,
    "scope_key" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rpc_rate_limit_counters_request_count_check" CHECK (("request_count" >= 0))
);


ALTER TABLE "public"."rpc_rate_limit_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpc_rate_limit_hits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rpc_name" "text" NOT NULL,
    "user_id" "uuid",
    "scope_key" "text" NOT NULL,
    "allowed_per_minute" integer NOT NULL,
    "observed_count" integer NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rpc_rate_limit_hits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpc_rate_limit_rules" (
    "rpc_name" "text" NOT NULL,
    "scope" "text" DEFAULT 'per_admin'::"text" NOT NULL,
    "allowed_per_minute" integer NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rpc_rate_limit_rules_allowed_per_minute_check" CHECK (("allowed_per_minute" > 0)),
    CONSTRAINT "rpc_rate_limit_rules_scope_check" CHECK (("scope" = ANY (ARRAY['per_admin'::"text", 'per_user'::"text", 'global'::"text"])))
);


ALTER TABLE "public"."rpc_rate_limit_rules" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."season_leaderboard" WITH ("security_invoker"='true') AS
 WITH "active" AS (
         SELECT "cs"."id",
            "cs"."name",
            "cs"."start_date",
            "cs"."end_date"
           FROM "public"."competitive_seasons" "cs"
          WHERE ("cs"."is_active" = true)
          ORDER BY "cs"."start_date" DESC
         LIMIT 1
        )
 SELECT "a"."id" AS "season_id",
    "a"."name" AS "season_name",
    "a"."start_date",
    "a"."end_date",
    "lp"."user_id",
    "lp"."username",
    "lp"."avatar_url",
    "lp"."producer_tier",
    "lp"."elo_rating",
    "lp"."battle_wins",
    "lp"."battle_losses",
    "lp"."battle_draws",
    "lp"."total_battles",
    "lp"."win_rate",
    "lp"."rank_position"
   FROM ("active" "a"
     JOIN "public"."leaderboard_producers" "lp" ON (true))
  ORDER BY "lp"."rank_position";


ALTER VIEW "public"."season_leaderboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."season_results" (
    "season_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "final_elo" integer NOT NULL,
    "rank_position" integer NOT NULL,
    "wins" integer DEFAULT 0 NOT NULL,
    "losses" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."season_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_audio_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "watermark_audio_path" "text",
    "gain_db" numeric(5,2) DEFAULT '-10.00'::numeric NOT NULL,
    "min_interval_sec" integer DEFAULT 20 NOT NULL,
    "max_interval_sec" integer DEFAULT 45 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_audio_settings_gain_bounds" CHECK ((("gain_db" >= '-60.00'::numeric) AND ("gain_db" <= 12.00))),
    CONSTRAINT "site_audio_settings_interval_bounds" CHECK ((("min_interval_sec" >= 1) AND ("max_interval_sec" >= "min_interval_sec")))
);


ALTER TABLE "public"."site_audio_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "processed" boolean DEFAULT false NOT NULL,
    "processed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_started_at" timestamp with time zone
);


ALTER TABLE "public"."stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_badges" (
    "user_id" "uuid" NOT NULL,
    "badge_id" "uuid" NOT NULL,
    "earned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_music_preferences" (
    "user_id" "uuid" NOT NULL,
    "criterion" "text" NOT NULL,
    "score" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_music_preferences_criterion_check" CHECK (("criterion" = ANY (ARRAY['groove'::"text", 'melody'::"text", 'ambience'::"text", 'sound_design'::"text", 'drums'::"text", 'mix'::"text", 'originality'::"text", 'energy'::"text", 'artistic_vibe'::"text"]))),
    CONSTRAINT "user_music_preferences_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."user_music_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."v_days" (
    "coalesce" integer
);


ALTER TABLE "public"."v_days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."watermark_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "overlay_audio_path" "text",
    "beep_frequency_hz" integer,
    "beep_duration_ms" integer,
    "repeat_every_ms" integer,
    "gain_db" numeric(5,2),
    "voice_tag_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."watermark_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."weekly_leaderboard" WITH ("security_invoker"='true') AS
 WITH "recent_battles" AS (
         SELECT "b"."id",
            "b"."producer1_id",
            "b"."producer2_id",
            "b"."winner_id"
           FROM "public"."battles" "b"
          WHERE (("b"."status" = 'completed'::"public"."battle_status") AND ("b"."updated_at" >= ("now"() - '7 days'::interval)))
        ), "participants" AS (
         SELECT "rb"."producer1_id" AS "user_id",
                CASE
                    WHEN ("rb"."winner_id" = "rb"."producer1_id") THEN 1
                    ELSE 0
                END AS "win",
                CASE
                    WHEN (("rb"."winner_id" IS NOT NULL) AND ("rb"."winner_id" <> "rb"."producer1_id")) THEN 1
                    ELSE 0
                END AS "loss"
           FROM "recent_battles" "rb"
          WHERE ("rb"."producer1_id" IS NOT NULL)
        UNION ALL
         SELECT "rb"."producer2_id" AS "user_id",
                CASE
                    WHEN ("rb"."winner_id" = "rb"."producer2_id") THEN 1
                    ELSE 0
                END AS "win",
                CASE
                    WHEN (("rb"."winner_id" IS NOT NULL) AND ("rb"."winner_id" <> "rb"."producer2_id")) THEN 1
                    ELSE 0
                END AS "loss"
           FROM "recent_battles" "rb"
          WHERE ("rb"."producer2_id" IS NOT NULL)
        ), "agg" AS (
         SELECT "p"."user_id",
            ("sum"("p"."win"))::integer AS "weekly_wins",
            ("sum"("p"."loss"))::integer AS "weekly_losses"
           FROM "participants" "p"
          GROUP BY "p"."user_id"
        )
 SELECT "up"."id" AS "user_id",
    "up"."username",
    "a"."weekly_wins",
    "a"."weekly_losses",
        CASE
            WHEN (("a"."weekly_wins" + "a"."weekly_losses") = 0) THEN (0)::numeric
            ELSE "round"(((("a"."weekly_wins")::numeric / (("a"."weekly_wins" + "a"."weekly_losses"))::numeric) * (100)::numeric), 2)
        END AS "weekly_winrate",
    "row_number"() OVER (ORDER BY "a"."weekly_wins" DESC, "a"."weekly_losses", "up"."username", "up"."id") AS "rank_position"
   FROM ("agg" "a"
     JOIN "public"."user_profiles" "up" ON (("up"."id" = "a"."user_id")))
  WHERE (("up"."is_producer_active" = true) AND ("up"."role" = ANY (ARRAY['producer'::"public"."user_role", 'admin'::"public"."user_role"])))
  ORDER BY ("row_number"() OVER (ORDER BY "a"."weekly_wins" DESC, "a"."weekly_losses", "up"."username", "up"."id"));


ALTER VIEW "public"."weekly_leaderboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wishlists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wishlists" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_action_audit_log"
    ADD CONSTRAINT "admin_action_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_action_audit_log"
    ADD CONSTRAINT "admin_action_audit_log_source_action_id_key" UNIQUE ("source_action_id");



ALTER TABLE ONLY "public"."admin_notifications"
    ADD CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."ai_admin_actions"
    ADD CONSTRAINT "ai_admin_actions_action_type_check" CHECK (("action_type" = ANY (ARRAY['battle_validate'::"text", 'battle_cancel'::"text", 'battle_finalize'::"text", 'comment_moderation'::"text", 'match_recommendation'::"text", 'battle_duration_set'::"text", 'battle_duration_extended'::"text", 'battle_validate_admin'::"text", 'battle_cancel_admin'::"text", 'battle_finalize_admin'::"text"]))) NOT VALID;



ALTER TABLE ONLY "public"."ai_admin_actions"
    ADD CONSTRAINT "ai_admin_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_training_feedback"
    ADD CONSTRAINT "ai_training_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."audio_processing_jobs"
    ADD CONSTRAINT "audio_processing_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battle_comments"
    ADD CONSTRAINT "battle_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battle_product_snapshots"
    ADD CONSTRAINT "battle_product_snapshots_battle_slot_key" UNIQUE ("battle_id", "slot");



ALTER TABLE ONLY "public"."battle_product_snapshots"
    ADD CONSTRAINT "battle_product_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battle_quality_snapshots"
    ADD CONSTRAINT "battle_quality_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battle_quality_snapshots"
    ADD CONSTRAINT "battle_quality_snapshots_unique_latest" UNIQUE ("battle_id", "product_id");



ALTER TABLE ONLY "public"."battle_vote_feedback"
    ADD CONSTRAINT "battle_vote_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battle_vote_feedback"
    ADD CONSTRAINT "battle_vote_feedback_vote_criterion_key" UNIQUE ("vote_id", "criterion");



ALTER TABLE ONLY "public"."battle_votes"
    ADD CONSTRAINT "battle_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitive_seasons"
    ADD CONSTRAINT "competitive_seasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_submit_rate_limit"
    ADD CONSTRAINT "contact_submit_rate_limit_pkey" PRIMARY KEY ("ip_hash", "window_start");



ALTER TABLE ONLY "public"."contract_generation_jobs"
    ADD CONSTRAINT "contract_generation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contract_url_rate_limit_counters"
    ADD CONSTRAINT "contract_url_rate_limit_counters_pkey" PRIMARY KEY ("purchase_id", "user_id", "window_started_at");



ALTER TABLE ONLY "public"."download_logs"
    ADD CONSTRAINT "download_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."elite_interest"
    ADD CONSTRAINT "elite_interest_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exclusive_locks"
    ADD CONSTRAINT "exclusive_locks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_assistant_jobs"
    ADD CONSTRAINT "forum_assistant_jobs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."forum_assistant_jobs"
    ADD CONSTRAINT "forum_assistant_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_categories"
    ADD CONSTRAINT "forum_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_categories"
    ADD CONSTRAINT "forum_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."forum_likes"
    ADD CONSTRAINT "forum_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_likes"
    ADD CONSTRAINT "forum_likes_post_user_key" UNIQUE ("post_id", "user_id");



ALTER TABLE ONLY "public"."forum_moderation_logs"
    ADD CONSTRAINT "forum_moderation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_post_likes"
    ADD CONSTRAINT "forum_post_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_post_likes"
    ADD CONSTRAINT "forum_post_likes_post_user_key" UNIQUE ("post_id", "user_id");



ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_topics"
    ADD CONSTRAINT "forum_topics_category_slug_key" UNIQUE ("category_id", "slug");



ALTER TABLE ONLY "public"."forum_topics"
    ADD CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fraud_events"
    ADD CONSTRAINT "fraud_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."genres"
    ADD CONSTRAINT "genres_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."genres"
    ADD CONSTRAINT "genres_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."genres"
    ADD CONSTRAINT "genres_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."licenses"
    ADD CONSTRAINT "licenses_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."licenses"
    ADD CONSTRAINT "licenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitoring_alert_events"
    ADD CONSTRAINT "monitoring_alert_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moods"
    ADD CONSTRAINT "moods_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."moods"
    ADD CONSTRAINT "moods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moods"
    ADD CONSTRAINT "moods_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."news_videos"
    ADD CONSTRAINT "news_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_email_log"
    ADD CONSTRAINT "notification_email_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."play_events"
    ADD CONSTRAINT "play_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preview_access_logs"
    ADD CONSTRAINT "preview_access_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producer_badges"
    ADD CONSTRAINT "producer_badges_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."producer_badges"
    ADD CONSTRAINT "producer_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producer_plan_config"
    ADD CONSTRAINT "producer_plan_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producer_plans"
    ADD CONSTRAINT "producer_plans_pkey" PRIMARY KEY ("tier");



ALTER TABLE ONLY "public"."producer_subscriptions"
    ADD CONSTRAINT "producer_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_files"
    ADD CONSTRAINT "product_files_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."products"
    ADD CONSTRAINT "products_master_path_invariant" CHECK ((("master_path" IS NULL) OR ("public"."normalize_master_storage_path"("master_path") ~~ (((("producer_id")::"text" || '/'::"text") || ("id")::"text") || '/%'::"text")))) NOT VALID;



ALTER TABLE "public"."products"
    ADD CONSTRAINT "products_master_url_invariant" CHECK ("public"."is_valid_product_master_path"("producer_id", "id", "master_url")) NOT VALID;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_stripe_checkout_session_id_key" UNIQUE ("stripe_checkout_session_id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_stripe_payment_intent_id_key" UNIQUE ("stripe_payment_intent_id");



ALTER TABLE ONLY "public"."reputation_events"
    ADD CONSTRAINT "reputation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reputation_rules"
    ADD CONSTRAINT "reputation_rules_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."rpc_rate_limit_counters"
    ADD CONSTRAINT "rpc_rate_limit_counters_pkey" PRIMARY KEY ("rpc_name", "scope_key", "window_started_at");



ALTER TABLE ONLY "public"."rpc_rate_limit_hits"
    ADD CONSTRAINT "rpc_rate_limit_hits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rpc_rate_limit_rules"
    ADD CONSTRAINT "rpc_rate_limit_rules_pkey" PRIMARY KEY ("rpc_name");



ALTER TABLE ONLY "public"."season_results"
    ADD CONSTRAINT "season_results_pkey" PRIMARY KEY ("season_id", "user_id");



ALTER TABLE ONLY "public"."site_audio_settings"
    ADD CONSTRAINT "site_audio_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "unique_cart_item" UNIQUE ("user_id", "product_id");



ALTER TABLE ONLY "public"."exclusive_locks"
    ADD CONSTRAINT "unique_product_lock" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "unique_user_product_entitlement" UNIQUE ("user_id", "product_id");



ALTER TABLE ONLY "public"."battle_votes"
    ADD CONSTRAINT "unique_user_vote_per_battle" UNIQUE ("battle_id", "user_id");



ALTER TABLE ONLY "public"."wishlists"
    ADD CONSTRAINT "unique_wishlist_item" UNIQUE ("user_id", "product_id");



ALTER TABLE ONLY "public"."producer_subscriptions"
    ADD CONSTRAINT "uq_producer_subscription_stripe" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."producer_subscriptions"
    ADD CONSTRAINT "uq_producer_subscription_user" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_pkey" PRIMARY KEY ("user_id", "badge_id");



ALTER TABLE ONLY "public"."user_music_preferences"
    ADD CONSTRAINT "user_music_preferences_pkey" PRIMARY KEY ("user_id", "criterion");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."user_reputation"
    ADD CONSTRAINT "user_reputation_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."watermark_profiles"
    ADD CONSTRAINT "watermark_profiles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."watermark_profiles"
    ADD CONSTRAINT "watermark_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wishlists"
    ADD CONSTRAINT "wishlists_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "elite_interest_email_unique" ON "public"."elite_interest" USING "btree" ("lower"("email"));



CREATE INDEX "idx_admin_action_audit_action_created" ON "public"."admin_action_audit_log" USING "btree" ("action_type", "created_at" DESC);



CREATE INDEX "idx_admin_action_audit_actor_created" ON "public"."admin_action_audit_log" USING "btree" ("admin_user_id", "created_at" DESC);



CREATE INDEX "idx_admin_action_audit_created" ON "public"."admin_action_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_admin_action_audit_entity_created" ON "public"."admin_action_audit_log" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "idx_admin_notifications_user_read_created" ON "public"."admin_notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE INDEX "idx_ai_admin_actions_action_status_created" ON "public"."ai_admin_actions" USING "btree" ("action_type", "status", "created_at" DESC);



CREATE INDEX "idx_ai_admin_actions_entity" ON "public"."ai_admin_actions" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_ai_training_feedback_action_created" ON "public"."ai_training_feedback" USING "btree" ("action_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_audio_processing_jobs_active_unique" ON "public"."audio_processing_jobs" USING "btree" ("product_id", "job_type") WHERE ("status" = ANY (ARRAY['queued'::"text", 'processing'::"text"]));



CREATE INDEX "idx_audio_processing_jobs_product_created_at" ON "public"."audio_processing_jobs" USING "btree" ("product_id", "created_at" DESC);



CREATE INDEX "idx_audio_processing_jobs_status_created_at" ON "public"."audio_processing_jobs" USING "btree" ("status", "created_at");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_created" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_resource" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_logs_user" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_battle_comments_battle" ON "public"."battle_comments" USING "btree" ("battle_id");



CREATE INDEX "idx_battle_comments_user" ON "public"."battle_comments" USING "btree" ("user_id");



CREATE INDEX "idx_battle_comments_visible" ON "public"."battle_comments" USING "btree" ("is_hidden") WHERE ("is_hidden" = false);



CREATE INDEX "idx_battle_product_snapshots_battle_id" ON "public"."battle_product_snapshots" USING "btree" ("battle_id");



CREATE INDEX "idx_battle_product_snapshots_product_id" ON "public"."battle_product_snapshots" USING "btree" ("product_id") WHERE ("product_id" IS NOT NULL);



CREATE INDEX "idx_battle_quality_snapshots_battle" ON "public"."battle_quality_snapshots" USING "btree" ("battle_id");



CREATE INDEX "idx_battle_quality_snapshots_product" ON "public"."battle_quality_snapshots" USING "btree" ("product_id");



CREATE INDEX "idx_battle_quality_snapshots_quality" ON "public"."battle_quality_snapshots" USING "btree" ("quality_index" DESC, "computed_at" DESC);



CREATE INDEX "idx_battle_vote_feedback_battle" ON "public"."battle_vote_feedback" USING "btree" ("battle_id");



CREATE INDEX "idx_battle_vote_feedback_criterion" ON "public"."battle_vote_feedback" USING "btree" ("criterion");



CREATE INDEX "idx_battle_vote_feedback_product_criterion" ON "public"."battle_vote_feedback" USING "btree" ("winner_product_id", "criterion");



CREATE INDEX "idx_battle_vote_feedback_winner_product" ON "public"."battle_vote_feedback" USING "btree" ("winner_product_id");



CREATE INDEX "idx_battle_votes_battle" ON "public"."battle_votes" USING "btree" ("battle_id");



CREATE INDEX "idx_battle_votes_user" ON "public"."battle_votes" USING "btree" ("user_id");



CREATE INDEX "idx_battles_created" ON "public"."battles" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_battles_expiry_active_voting" ON "public"."battles" USING "btree" ("voting_ends_at") WHERE ("status" = ANY (ARRAY['active'::"public"."battle_status", 'voting'::"public"."battle_status"]));



CREATE INDEX "idx_battles_featured" ON "public"."battles" USING "btree" ("featured") WHERE ("featured" = true);



CREATE INDEX "idx_battles_producer1" ON "public"."battles" USING "btree" ("producer1_id");



CREATE INDEX "idx_battles_producer1_active_limit" ON "public"."battles" USING "btree" ("producer1_id", "status") WHERE ("status" = ANY (ARRAY['pending_acceptance'::"public"."battle_status", 'active'::"public"."battle_status", 'voting'::"public"."battle_status"]));



CREATE INDEX "idx_battles_producer1_created_at" ON "public"."battles" USING "btree" ("producer1_id", "created_at" DESC);



CREATE INDEX "idx_battles_producer1_created_month" ON "public"."battles" USING "btree" ("producer1_id", "created_at" DESC);



CREATE INDEX "idx_battles_producer2" ON "public"."battles" USING "btree" ("producer2_id");



CREATE INDEX "idx_battles_producer2_rejected_window" ON "public"."battles" USING "btree" ("producer2_id", "rejected_at" DESC) WHERE ("rejected_at" IS NOT NULL);



CREATE INDEX "idx_battles_product1_completed" ON "public"."battles" USING "btree" ("product1_id") WHERE (("status" = 'completed'::"public"."battle_status") AND ("product1_id" IS NOT NULL));



CREATE INDEX "idx_battles_product2_completed" ON "public"."battles" USING "btree" ("product2_id") WHERE (("status" = 'completed'::"public"."battle_status") AND ("product2_id" IS NOT NULL));



CREATE INDEX "idx_battles_slug" ON "public"."battles" USING "btree" ("slug");



CREATE INDEX "idx_battles_status" ON "public"."battles" USING "btree" ("status");



CREATE INDEX "idx_battles_status_awaiting_admin" ON "public"."battles" USING "btree" ("status", "created_at" DESC) WHERE ("status" = 'awaiting_admin'::"public"."battle_status");



CREATE INDEX "idx_battles_status_response_deadline" ON "public"."battles" USING "btree" ("status", "response_deadline") WHERE ("status" = 'pending_acceptance'::"public"."battle_status");



CREATE INDEX "idx_battles_voting_ends" ON "public"."battles" USING "btree" ("voting_ends_at") WHERE ("status" = 'voting'::"public"."battle_status");



CREATE INDEX "idx_cart_items_product" ON "public"."cart_items" USING "btree" ("product_id");



CREATE INDEX "idx_cart_items_user" ON "public"."cart_items" USING "btree" ("user_id");



CREATE INDEX "idx_competitive_seasons_dates" ON "public"."competitive_seasons" USING "btree" ("start_date" DESC, "end_date" DESC);



CREATE UNIQUE INDEX "idx_competitive_seasons_one_active" ON "public"."competitive_seasons" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_contact_messages_created_at_desc" ON "public"."contact_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_contact_messages_status" ON "public"."contact_messages" USING "btree" ("status");



CREATE INDEX "idx_contact_messages_user_id" ON "public"."contact_messages" USING "btree" ("user_id");



CREATE INDEX "idx_contact_submit_rate_limit_window_start" ON "public"."contact_submit_rate_limit" USING "btree" ("window_start" DESC);



CREATE UNIQUE INDEX "idx_contract_generation_jobs_active_purchase" ON "public"."contract_generation_jobs" USING "btree" ("purchase_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));



CREATE INDEX "idx_contract_generation_jobs_purchase_created_at" ON "public"."contract_generation_jobs" USING "btree" ("purchase_id", "created_at" DESC);



CREATE INDEX "idx_contract_generation_jobs_status_next_run_at" ON "public"."contract_generation_jobs" USING "btree" ("status", "next_run_at", "created_at");



CREATE INDEX "idx_contract_url_rate_limit_counters_purchase_window" ON "public"."contract_url_rate_limit_counters" USING "btree" ("purchase_id", "window_started_at" DESC);



CREATE INDEX "idx_contract_url_rate_limit_counters_user_window" ON "public"."contract_url_rate_limit_counters" USING "btree" ("user_id", "window_started_at" DESC);



CREATE INDEX "idx_download_logs_purchase" ON "public"."download_logs" USING "btree" ("purchase_id");



CREATE INDEX "idx_download_logs_user" ON "public"."download_logs" USING "btree" ("user_id");



CREATE INDEX "idx_entitlements_active" ON "public"."entitlements" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_entitlements_product" ON "public"."entitlements" USING "btree" ("product_id");



CREATE INDEX "idx_entitlements_user" ON "public"."entitlements" USING "btree" ("user_id");



CREATE INDEX "idx_exclusive_locks_expires" ON "public"."exclusive_locks" USING "btree" ("expires_at");



CREATE INDEX "idx_exclusive_locks_product" ON "public"."exclusive_locks" USING "btree" ("product_id");



CREATE INDEX "idx_forum_assistant_jobs_status_created" ON "public"."forum_assistant_jobs" USING "btree" ("status", "created_at");



CREATE INDEX "idx_forum_categories_position" ON "public"."forum_categories" USING "btree" ("position", "created_at");



CREATE INDEX "idx_forum_likes_post_created_desc" ON "public"."forum_likes" USING "btree" ("post_id", "created_at" DESC);



CREATE INDEX "idx_forum_moderation_logs_post_created" ON "public"."forum_moderation_logs" USING "btree" ("post_id", "created_at" DESC);



CREATE INDEX "idx_forum_moderation_logs_topic_created" ON "public"."forum_moderation_logs" USING "btree" ("topic_id", "created_at" DESC);



CREATE INDEX "idx_forum_post_likes_post_created_desc" ON "public"."forum_post_likes" USING "btree" ("post_id", "created_at" DESC);



CREATE INDEX "idx_forum_post_likes_user_created_desc" ON "public"."forum_post_likes" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_forum_posts_topic_created_asc" ON "public"."forum_posts" USING "btree" ("topic_id", "created_at", "id");



CREATE INDEX "idx_forum_posts_topic_visible_created" ON "public"."forum_posts" USING "btree" ("topic_id", "created_at" DESC) WHERE ("is_deleted" = false);



CREATE INDEX "idx_forum_posts_topic_visible_desc" ON "public"."forum_posts" USING "btree" ("topic_id", "created_at" DESC) WHERE (("is_deleted" = false) AND ("is_visible" = true));



CREATE INDEX "idx_forum_posts_user_created_desc" ON "public"."forum_posts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_forum_topics_category_last_post_desc" ON "public"."forum_topics" USING "btree" ("category_id", "is_pinned" DESC, "last_post_at" DESC, "created_at" DESC);



CREATE INDEX "idx_forum_topics_category_updated_desc" ON "public"."forum_topics" USING "btree" ("category_id", "updated_at" DESC, "created_at" DESC);



CREATE INDEX "idx_forum_topics_user_created_desc" ON "public"."forum_topics" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_fraud_events_battle_created_desc" ON "public"."fraud_events" USING "btree" ("battle_id", "created_at" DESC);



CREATE INDEX "idx_fraud_events_battle_id" ON "public"."fraud_events" USING "btree" ("battle_id");



CREATE INDEX "idx_fraud_events_event_created_desc" ON "public"."fraud_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_fraud_events_event_type_created_at" ON "public"."fraud_events" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "idx_fraud_events_ip_hash" ON "public"."fraud_events" USING "btree" ("ip_hash");



CREATE INDEX "idx_fraud_events_post_created_desc" ON "public"."fraud_events" USING "btree" ("post_id", "created_at" DESC);



CREATE INDEX "idx_fraud_events_user_created_desc" ON "public"."fraud_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_fraud_events_user_id" ON "public"."fraud_events" USING "btree" ("user_id");



CREATE INDEX "idx_licenses_exclusive_allowed" ON "public"."licenses" USING "btree" ("exclusive_allowed");



CREATE INDEX "idx_licenses_name_lower" ON "public"."licenses" USING "btree" ("lower"("name"));



CREATE INDEX "idx_monitoring_alert_events_created" ON "public"."monitoring_alert_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_monitoring_alert_events_unresolved" ON "public"."monitoring_alert_events" USING "btree" ("severity", "created_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "idx_news_videos_is_published_created_at_desc" ON "public"."news_videos" USING "btree" ("is_published", "created_at" DESC);



CREATE INDEX "idx_news_videos_published_created_at_desc" ON "public"."news_videos" USING "btree" ("created_at" DESC) WHERE ("is_published" = true);



CREATE INDEX "idx_notification_email_log_rate_lookup" ON "public"."notification_email_log" USING "btree" ("category", "recipient_email", "created_at" DESC);



CREATE INDEX "idx_play_events_user_product" ON "public"."play_events" USING "btree" ("user_id", "product_id");



CREATE INDEX "idx_preview_access_created" ON "public"."preview_access_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_preview_access_product" ON "public"."preview_access_logs" USING "btree" ("product_id");



CREATE INDEX "idx_preview_access_user" ON "public"."preview_access_logs" USING "btree" ("user_id");



CREATE INDEX "idx_producer_subscriptions_active_until" ON "public"."producer_subscriptions" USING "btree" ("current_period_end");



CREATE INDEX "idx_producer_subscriptions_subscription" ON "public"."producer_subscriptions" USING "btree" ("stripe_subscription_id");



CREATE INDEX "idx_producer_subscriptions_user" ON "public"."producer_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_product_files_product" ON "public"."product_files" USING "btree" ("product_id");



CREATE INDEX "idx_products_created" ON "public"."products" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_products_exclusive_available" ON "public"."products" USING "btree" ("is_exclusive", "is_sold") WHERE (("is_exclusive" = true) AND ("is_sold" = false));



CREATE INDEX "idx_products_genre" ON "public"."products" USING "btree" ("genre_id");



CREATE INDEX "idx_products_master_path" ON "public"."products" USING "btree" ("master_path") WHERE ("master_path" IS NOT NULL);



CREATE INDEX "idx_products_mood" ON "public"."products" USING "btree" ("mood_id");



CREATE INDEX "idx_products_not_deleted" ON "public"."products" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_products_original_beat_id" ON "public"."products" USING "btree" ("original_beat_id") WHERE ("original_beat_id" IS NOT NULL);



CREATE INDEX "idx_products_parent_product_version_desc" ON "public"."products" USING "btree" ("parent_product_id", "version_number" DESC);



CREATE INDEX "idx_products_preview_signature" ON "public"."products" USING "btree" ("preview_signature") WHERE ("preview_signature" IS NOT NULL);



CREATE INDEX "idx_products_processing_status" ON "public"."products" USING "btree" ("processing_status", "updated_at" DESC);



CREATE INDEX "idx_products_producer" ON "public"."products" USING "btree" ("producer_id");



CREATE INDEX "idx_products_producer_active_not_deleted" ON "public"."products" USING "btree" ("producer_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_products_producer_status" ON "public"."products" USING "btree" ("producer_id", "status");



CREATE INDEX "idx_products_published" ON "public"."products" USING "btree" ("is_published") WHERE ("is_published" = true);



CREATE INDEX "idx_products_published_beats_by_producer" ON "public"."products" USING "btree" ("producer_id", "created_at" DESC) WHERE (("product_type" = 'beat'::"public"."product_type") AND ("is_published" = true) AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "idx_products_single_active_version_per_root" ON "public"."products" USING "btree" ("parent_product_id") WHERE (("product_type" = 'beat'::"public"."product_type") AND ("deleted_at" IS NULL) AND ("status" = 'active'::"text"));



CREATE INDEX "idx_products_slug" ON "public"."products" USING "btree" ("slug");



CREATE INDEX "idx_products_status_not_deleted" ON "public"."products" USING "btree" ("status", "updated_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_products_tags" ON "public"."products" USING "gin" ("tags");



CREATE INDEX "idx_products_type" ON "public"."products" USING "btree" ("product_type");



CREATE INDEX "idx_products_watermarked_path" ON "public"."products" USING "btree" ("watermarked_path") WHERE ("watermarked_path" IS NOT NULL);



CREATE INDEX "idx_purchases_contract_email_sent_at" ON "public"."purchases" USING "btree" ("contract_email_sent_at") WHERE ("contract_email_sent_at" IS NOT NULL);



CREATE INDEX "idx_purchases_contract_pdf_path" ON "public"."purchases" USING "btree" ("contract_pdf_path") WHERE ("contract_pdf_path" IS NOT NULL);



CREATE INDEX "idx_purchases_created" ON "public"."purchases" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_purchases_license_id" ON "public"."purchases" USING "btree" ("license_id") WHERE ("license_id" IS NOT NULL);



CREATE INDEX "idx_purchases_producer" ON "public"."purchases" USING "btree" ("producer_id");



CREATE INDEX "idx_purchases_product" ON "public"."purchases" USING "btree" ("product_id");



CREATE INDEX "idx_purchases_product_status" ON "public"."purchases" USING "btree" ("product_id", "status");



CREATE INDEX "idx_purchases_status" ON "public"."purchases" USING "btree" ("status");



CREATE INDEX "idx_purchases_stripe_pi" ON "public"."purchases" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_purchases_stripe_session" ON "public"."purchases" USING "btree" ("stripe_checkout_session_id");



CREATE INDEX "idx_purchases_user" ON "public"."purchases" USING "btree" ("user_id");



CREATE INDEX "idx_purchases_user_product_license" ON "public"."purchases" USING "btree" ("user_id", "product_id", "license_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_reputation_events_idempotency_key" ON "public"."reputation_events" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "idx_reputation_events_source_event_created_desc" ON "public"."reputation_events" USING "btree" ("source", "event_type", "created_at" DESC);



CREATE INDEX "idx_reputation_events_user_created_desc" ON "public"."reputation_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_rpc_rate_limit_hits_rpc_created" ON "public"."rpc_rate_limit_hits" USING "btree" ("rpc_name", "created_at" DESC);



CREATE INDEX "idx_rpc_rate_limit_hits_user_created" ON "public"."rpc_rate_limit_hits" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_season_results_rank" ON "public"."season_results" USING "btree" ("season_id", "rank_position");



CREATE INDEX "idx_season_results_user" ON "public"."season_results" USING "btree" ("user_id", "season_id" DESC);



CREATE UNIQUE INDEX "idx_site_audio_settings_singleton" ON "public"."site_audio_settings" USING "btree" ((true));



CREATE INDEX "idx_stripe_events_created" ON "public"."stripe_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_stripe_events_processed" ON "public"."stripe_events" USING "btree" ("processed") WHERE ("processed" = false);



CREATE INDEX "idx_stripe_events_processed_processing_started_at" ON "public"."stripe_events" USING "btree" ("processed", "processing_started_at");



CREATE INDEX "idx_stripe_events_type" ON "public"."stripe_events" USING "btree" ("type");



CREATE INDEX "idx_user_badges_badge_id" ON "public"."user_badges" USING "btree" ("badge_id");



CREATE INDEX "idx_user_badges_user_id" ON "public"."user_badges" USING "btree" ("user_id");



CREATE INDEX "idx_user_music_preferences_criterion" ON "public"."user_music_preferences" USING "btree" ("criterion");



CREATE INDEX "idx_user_music_preferences_user" ON "public"."user_music_preferences" USING "btree" ("user_id");



CREATE INDEX "idx_user_profiles_active_lower_username" ON "public"."user_profiles" USING "btree" ("lower"("username")) WHERE (("is_producer_active" = true) AND ("username" IS NOT NULL));



CREATE INDEX "idx_user_profiles_active_tier_updated_at_desc" ON "public"."user_profiles" USING "btree" ("producer_tier", "updated_at" DESC) WHERE ("is_producer_active" = true);



CREATE INDEX "idx_user_profiles_active_updated_at_desc" ON "public"."user_profiles" USING "btree" ("updated_at" DESC) WHERE ("is_producer_active" = true);



CREATE INDEX "idx_user_profiles_battle_refusal_count" ON "public"."user_profiles" USING "btree" ("battle_refusal_count" DESC);



CREATE INDEX "idx_user_profiles_deleted" ON "public"."user_profiles" USING "btree" ("is_deleted");



CREATE INDEX "idx_user_profiles_elo_active" ON "public"."user_profiles" USING "btree" ("is_producer_active", "elo_rating" DESC) WHERE ("is_producer_active" = true);



CREATE INDEX "idx_user_profiles_elo_rating" ON "public"."user_profiles" USING "btree" ("elo_rating" DESC);



CREATE INDEX "idx_user_profiles_engagement_score" ON "public"."user_profiles" USING "btree" ("engagement_score" DESC);



CREATE INDEX "idx_user_profiles_is_confirmed" ON "public"."user_profiles" USING "btree" ("is_confirmed") WHERE ("is_confirmed" = true);



CREATE INDEX "idx_user_profiles_is_deleted_deleted_at" ON "public"."user_profiles" USING "btree" ("is_deleted", "deleted_at");



CREATE INDEX "idx_user_profiles_is_producer" ON "public"."user_profiles" USING "btree" ("is_producer_active") WHERE ("is_producer_active" = true);



CREATE INDEX "idx_user_profiles_role" ON "public"."user_profiles" USING "btree" ("role");



CREATE INDEX "idx_user_profiles_stripe_customer" ON "public"."user_profiles" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_user_profiles_username" ON "public"."user_profiles" USING "btree" ("username");



CREATE INDEX "idx_user_reputation_rank_xp" ON "public"."user_reputation" USING "btree" ("rank_tier", "xp" DESC);



CREATE INDEX "idx_wishlists_product" ON "public"."wishlists" USING "btree" ("product_id");



CREATE INDEX "idx_wishlists_user" ON "public"."wishlists" USING "btree" ("user_id");



CREATE INDEX "stripe_events_processing_idx" ON "public"."stripe_events" USING "btree" ("processed", "processing_started_at");



CREATE UNIQUE INDEX "uq_elite_interest_email_lower" ON "public"."elite_interest" USING "btree" ("lower"("email"));



CREATE UNIQUE INDEX "uq_notification_email_log_dedupe_key" ON "public"."notification_email_log" USING "btree" ("dedupe_key");



CREATE UNIQUE INDEX "uq_play_events_user_product_bucket" ON "public"."play_events" USING "btree" ("user_id", "product_id", "dedupe_bucket");



CREATE UNIQUE INDEX "uq_producer_plans_stripe_price_id" ON "public"."producer_plans" USING "btree" ("stripe_price_id") WHERE ("stripe_price_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "auto_promote_confirmed_user" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW WHEN ((("new"."total_purchases" >= 10) AND ("old"."total_purchases" < 10))) EXECUTE FUNCTION "public"."check_user_confirmation_status"();



CREATE OR REPLACE TRIGGER "enqueue_product_preview_job_trigger" AFTER INSERT OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_product_preview_job"();



CREATE OR REPLACE TRIGGER "forum_posts_recalculate_topic_stats" AFTER INSERT OR DELETE OR UPDATE OF "topic_id", "is_deleted", "is_visible" ON "public"."forum_posts" FOR EACH ROW EXECUTE FUNCTION "public"."handle_forum_post_stats"();



CREATE OR REPLACE TRIGGER "forum_posts_touch_updated_at" BEFORE UPDATE ON "public"."forum_posts" FOR EACH ROW EXECUTE FUNCTION "public"."forum_touch_updated_at"();



CREATE OR REPLACE TRIGGER "forum_topics_touch_updated_at" BEFORE UPDATE ON "public"."forum_topics" FOR EACH ROW EXECUTE FUNCTION "public"."forum_touch_updated_at"();



CREATE OR REPLACE TRIGGER "generate_battle_slug_trigger" BEFORE INSERT OR UPDATE ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."generate_battle_slug"();



CREATE OR REPLACE TRIGGER "generate_product_slug_trigger" BEFORE INSERT OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."generate_product_slug"();



CREATE OR REPLACE TRIGGER "guard_product_editability_trigger" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."guard_product_editability"();



CREATE OR REPLACE TRIGGER "guard_product_hard_delete_trigger" BEFORE DELETE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."guard_product_hard_delete"();



CREATE OR REPLACE TRIGGER "normalize_product_version_lineage_trigger" BEFORE INSERT OR UPDATE OF "version_number", "version", "parent_product_id", "original_beat_id", "status", "archived_at", "is_published" ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_product_version_lineage"();



CREATE OR REPLACE TRIGGER "populate_purchase_snapshots_trigger" BEFORE INSERT ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."populate_purchase_snapshots"();



CREATE OR REPLACE TRIGGER "prepare_product_preview_processing_trigger" BEFORE INSERT OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_product_preview_processing"();



CREATE OR REPLACE TRIGGER "trg_admin_action_audit_monitoring" AFTER INSERT ON "public"."admin_action_audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."on_admin_action_audit_monitoring"();



CREATE OR REPLACE TRIGGER "trg_battle_comments_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."battle_comments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_battle_completed_competitive" AFTER UPDATE OF "status", "winner_id" ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."on_battle_completed_competitive"();



CREATE OR REPLACE TRIGGER "trg_battle_completed_reputation" AFTER UPDATE ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."on_battle_completed_reputation"();



CREATE OR REPLACE TRIGGER "trg_battle_vote_feedback_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."battle_vote_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_battle_votes_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."battle_votes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_battles_force_created_at" BEFORE INSERT ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."battles_force_created_at"();



CREATE OR REPLACE TRIGGER "trg_battles_lock_created_at_on_update" BEFORE UPDATE ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."battles_lock_created_at_on_update"();



CREATE OR REPLACE TRIGGER "trg_capture_battle_product_snapshots" AFTER INSERT OR UPDATE OF "product1_id", "product2_id", "status" ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."capture_battle_product_snapshots"();



CREATE OR REPLACE TRIGGER "trg_cart_items_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."cart_items" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_enqueue_admin_notifications_for_ai_action" AFTER INSERT ON "public"."ai_admin_actions" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_admin_notifications_for_ai_action"();



CREATE OR REPLACE TRIGGER "trg_force_battle_insert_timestamps" BEFORE INSERT ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."force_battle_insert_timestamps"();



CREATE OR REPLACE TRIGGER "trg_forum_likes_reputation" AFTER INSERT ON "public"."forum_likes" FOR EACH ROW EXECUTE FUNCTION "public"."on_forum_post_like_reputation"();



CREATE OR REPLACE TRIGGER "trg_forum_likes_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."forum_likes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_forum_post_likes_reputation" AFTER INSERT ON "public"."forum_post_likes" FOR EACH ROW EXECUTE FUNCTION "public"."on_forum_post_like_reputation"();



CREATE OR REPLACE TRIGGER "trg_forum_post_likes_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."forum_post_likes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_forum_posts_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."forum_posts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_forum_topics_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."forum_topics" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_lock_battle_created_at_on_update" BEFORE UPDATE ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."lock_battle_created_at_on_update"();



CREATE OR REPLACE TRIGGER "trg_prevent_legacy_battle_status_assignments" BEFORE INSERT OR UPDATE OF "status" ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_legacy_battle_status_assignments"();



CREATE OR REPLACE TRIGGER "trg_process_ai_comment_moderation" AFTER INSERT ON "public"."battle_comments" FOR EACH ROW EXECUTE FUNCTION "public"."process_ai_comment_moderation"();



CREATE OR REPLACE TRIGGER "trg_producer_subscriptions_flags" BEFORE INSERT OR UPDATE ON "public"."producer_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_producer_subscription_flags"();



CREATE OR REPLACE TRIGGER "trg_purchases_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."purchases" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_reputation_rules_touch_updated_at" BEFORE UPDATE ON "public"."reputation_rules" FOR EACH ROW EXECUTE FUNCTION "public"."reputation_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_rpc_rate_limit_hit_create_alert" AFTER INSERT ON "public"."rpc_rate_limit_hits" FOR EACH ROW EXECUTE FUNCTION "public"."on_rpc_rate_limit_hit_create_alert"();



CREATE OR REPLACE TRIGGER "trg_sync_executed_ai_actions_to_admin_action_audit_log" AFTER INSERT OR UPDATE OF "status", "executed_at" ON "public"."ai_admin_actions" FOR EACH ROW EXECUTE FUNCTION "public"."sync_executed_ai_actions_to_admin_action_audit_log"();



CREATE OR REPLACE TRIGGER "trg_sync_user_profile_producer" AFTER INSERT OR UPDATE ON "public"."producer_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."sync_user_profile_producer_flag"();



CREATE OR REPLACE TRIGGER "trg_sync_user_reputation_row" AFTER INSERT ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_user_reputation_row"();



CREATE OR REPLACE TRIGGER "trg_user_music_preferences_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_music_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "trg_user_reputation_touch_updated_at" BEFORE UPDATE ON "public"."user_reputation" FOR EACH ROW EXECUTE FUNCTION "public"."reputation_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_wishlists_require_active_user_id" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."wishlists" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_active_user_id_reference"();



CREATE OR REPLACE TRIGGER "update_battle_comments_updated_at" BEFORE UPDATE ON "public"."battle_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_battle_product_snapshots_updated_at" BEFORE UPDATE ON "public"."battle_product_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_battles_updated_at" BEFORE UPDATE ON "public"."battles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_contact_messages_updated_at" BEFORE UPDATE ON "public"."contact_messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_licenses_updated_at" BEFORE UPDATE ON "public"."licenses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_news_videos_updated_at" BEFORE UPDATE ON "public"."news_videos" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."admin_action_audit_log"
    ADD CONSTRAINT "admin_action_audit_log_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_notifications"
    ADD CONSTRAINT "admin_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_admin_actions"
    ADD CONSTRAINT "ai_admin_actions_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_training_feedback"
    ADD CONSTRAINT "ai_training_feedback_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "public"."ai_admin_actions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_training_feedback"
    ADD CONSTRAINT "ai_training_feedback_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audio_processing_jobs"
    ADD CONSTRAINT "audio_processing_jobs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."battle_comments"
    ADD CONSTRAINT "battle_comments_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_comments"
    ADD CONSTRAINT "battle_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."battle_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_comments"
    ADD CONSTRAINT "battle_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_product_snapshots"
    ADD CONSTRAINT "battle_product_snapshots_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_product_snapshots"
    ADD CONSTRAINT "battle_product_snapshots_producer_id_fkey" FOREIGN KEY ("producer_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."battle_product_snapshots"
    ADD CONSTRAINT "battle_product_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."battle_quality_snapshots"
    ADD CONSTRAINT "battle_quality_snapshots_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_quality_snapshots"
    ADD CONSTRAINT "battle_quality_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."battle_vote_feedback"
    ADD CONSTRAINT "battle_vote_feedback_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_vote_feedback"
    ADD CONSTRAINT "battle_vote_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_vote_feedback"
    ADD CONSTRAINT "battle_vote_feedback_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "public"."battle_votes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_vote_feedback"
    ADD CONSTRAINT "battle_vote_feedback_winner_product_id_fkey" FOREIGN KEY ("winner_product_id") REFERENCES "public"."products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."battle_votes"
    ADD CONSTRAINT "battle_votes_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_votes"
    ADD CONSTRAINT "battle_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_votes"
    ADD CONSTRAINT "battle_votes_voted_for_producer_id_fkey" FOREIGN KEY ("voted_for_producer_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_producer1_id_fkey" FOREIGN KEY ("producer1_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_producer2_id_fkey" FOREIGN KEY ("producer2_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_product1_id_fkey" FOREIGN KEY ("product1_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_product2_id_fkey" FOREIGN KEY ("product2_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contract_generation_jobs"
    ADD CONSTRAINT "contract_generation_jobs_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_url_rate_limit_counters"
    ADD CONSTRAINT "contract_url_rate_limit_counters_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contract_url_rate_limit_counters"
    ADD CONSTRAINT "contract_url_rate_limit_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."download_logs"
    ADD CONSTRAINT "download_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."download_logs"
    ADD CONSTRAINT "download_logs_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."download_logs"
    ADD CONSTRAINT "download_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exclusive_locks"
    ADD CONSTRAINT "exclusive_locks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exclusive_locks"
    ADD CONSTRAINT "exclusive_locks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_assistant_jobs"
    ADD CONSTRAINT "forum_assistant_jobs_source_post_id_fkey" FOREIGN KEY ("source_post_id") REFERENCES "public"."forum_posts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_assistant_jobs"
    ADD CONSTRAINT "forum_assistant_jobs_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."forum_topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_likes"
    ADD CONSTRAINT "forum_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_likes"
    ADD CONSTRAINT "forum_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_moderation_logs"
    ADD CONSTRAINT "forum_moderation_logs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_moderation_logs"
    ADD CONSTRAINT "forum_moderation_logs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_moderation_logs"
    ADD CONSTRAINT "forum_moderation_logs_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."forum_topics"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_post_likes"
    ADD CONSTRAINT "forum_post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_post_likes"
    ADD CONSTRAINT "forum_post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_source_post_id_fkey" FOREIGN KEY ("source_post_id") REFERENCES "public"."forum_posts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."forum_topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_posts"
    ADD CONSTRAINT "forum_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_topics"
    ADD CONSTRAINT "forum_topics_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."forum_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_topics"
    ADD CONSTRAINT "forum_topics_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_topics"
    ADD CONSTRAINT "forum_topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monitoring_alert_events"
    ADD CONSTRAINT "monitoring_alert_events_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."play_events"
    ADD CONSTRAINT "play_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."play_events"
    ADD CONSTRAINT "play_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preview_access_logs"
    ADD CONSTRAINT "preview_access_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preview_access_logs"
    ADD CONSTRAINT "preview_access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producer_subscriptions"
    ADD CONSTRAINT "producer_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_files"
    ADD CONSTRAINT "product_files_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_mood_id_fkey" FOREIGN KEY ("mood_id") REFERENCES "public"."moods"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_original_beat_id_fkey" FOREIGN KEY ("original_beat_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_producer_id_fkey" FOREIGN KEY ("producer_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_sold_to_user_id_fkey" FOREIGN KEY ("sold_to_user_id") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_watermark_profile_id_fkey" FOREIGN KEY ("watermark_profile_id") REFERENCES "public"."watermark_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_producer_id_fkey" FOREIGN KEY ("producer_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reputation_events"
    ADD CONSTRAINT "reputation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpc_rate_limit_counters"
    ADD CONSTRAINT "rpc_rate_limit_counters_rpc_name_fkey" FOREIGN KEY ("rpc_name") REFERENCES "public"."rpc_rate_limit_rules"("rpc_name") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpc_rate_limit_hits"
    ADD CONSTRAINT "rpc_rate_limit_hits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."season_results"
    ADD CONSTRAINT "season_results_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."competitive_seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."season_results"
    ADD CONSTRAINT "season_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "public"."producer_badges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_music_preferences"
    ADD CONSTRAINT "user_music_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_reputation"
    ADD CONSTRAINT "user_reputation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wishlists"
    ADD CONSTRAINT "wishlists_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wishlists"
    ADD CONSTRAINT "wishlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Active producers can add product files" ON "public"."product_files" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."products" "p"
     JOIN "public"."user_profiles" "up" ON (("up"."id" = "p"."producer_id")))
  WHERE (("p"."id" = "product_files"."product_id") AND ("p"."producer_id" = "auth"."uid"()) AND ("up"."is_producer_active" = true)))));



CREATE POLICY "Active producers can create battles" ON "public"."battles" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("public"."is_current_user_active"("auth"."uid"()) = true) AND ("producer1_id" = "auth"."uid"()) AND ("producer2_id" IS NOT NULL) AND ("producer1_id" <> "producer2_id") AND ("status" = 'pending_acceptance'::"public"."battle_status") AND ("winner_id" IS NULL) AND ("votes_producer1" = 0) AND ("votes_producer2" = 0) AND ("accepted_at" IS NULL) AND ("rejected_at" IS NULL) AND ("admin_validated_at" IS NULL) AND ("public"."can_create_battle"("auth"."uid"()) = true) AND ("public"."can_create_active_battle"("auth"."uid"()) = true) AND ("public"."assert_battle_skill_gap"("auth"."uid"(), "producer2_id", 400) = true) AND (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up2"
  WHERE (("up2"."id" = "battles"."producer2_id") AND ("up2"."id" <> "auth"."uid"()) AND ("up2"."role" = ANY (ARRAY['producer'::"public"."user_role", 'admin'::"public"."user_role"])) AND ("up2"."is_producer_active" = true) AND (COALESCE("up2"."is_deleted", false) = false) AND ("up2"."deleted_at" IS NULL)))) AND (("product1_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."products" "p1"
  WHERE (("p1"."id" = "battles"."product1_id") AND ("p1"."producer_id" = "auth"."uid"()) AND ("p1"."deleted_at" IS NULL))))) AND (("product2_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."products" "p2"
  WHERE (("p2"."id" = "battles"."product2_id") AND ("p2"."producer_id" = "battles"."producer2_id") AND ("p2"."deleted_at" IS NULL)))))));



CREATE POLICY "Active producers can create products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK ((("producer_id" = "auth"."uid"()) AND ("public"."is_current_user_active"("auth"."uid"()) = true) AND (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."is_producer_active" = true) AND (COALESCE("up"."is_deleted", false) = false) AND ("up"."deleted_at" IS NULL)))) AND ((NOT (("product_type" = 'beat'::"public"."product_type") AND ("is_published" = true) AND ("deleted_at" IS NULL))) OR "public"."can_publish_beat"("auth"."uid"(), NULL::"uuid"))));



CREATE POLICY "Admins can delete contact messages" ON "public"."contact_messages" FOR DELETE TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can delete news videos" ON "public"."news_videos" FOR DELETE TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can delete site audio settings" ON "public"."site_audio_settings" FOR DELETE TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can insert ai admin actions" ON "public"."ai_admin_actions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can insert ai training feedback" ON "public"."ai_training_feedback" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can insert app settings" ON "public"."app_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can insert battle quality snapshots via RPC only" ON "public"."battle_quality_snapshots" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"("auth"."uid"()) AND ("current_setting"('app.battle_quality_snapshot_rpc'::"text", true) = '1'::"text")));



CREATE POLICY "Admins can insert news videos" ON "public"."news_videos" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can insert rpc rate limit rules" ON "public"."rpc_rate_limit_rules" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can insert site audio settings" ON "public"."site_audio_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can manage reputation rules" ON "public"."reputation_rules" TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can manage watermark profiles" ON "public"."watermark_profiles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can moderate battle comments" ON "public"."battle_comments" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read ai admin actions" ON "public"."ai_admin_actions" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read ai training feedback" ON "public"."ai_training_feedback" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read all app settings" ON "public"."app_settings" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read all battle votes" ON "public"."battle_votes" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read all contact messages" ON "public"."contact_messages" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read all news videos" ON "public"."news_videos" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read all play events" ON "public"."play_events" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read battle quality snapshots" ON "public"."battle_quality_snapshots" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read battle vote feedback" ON "public"."battle_vote_feedback" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read centralized admin action audit log" ON "public"."admin_action_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read contact submit rate limit" ON "public"."contact_submit_rate_limit" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read contract generation jobs" ON "public"."contract_generation_jobs" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read contract url rate limit counters" ON "public"."contract_url_rate_limit_counters" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read forum assistant jobs" ON "public"."forum_assistant_jobs" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read forum moderation logs" ON "public"."forum_moderation_logs" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read fraud_events" ON "public"."fraud_events" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read monitoring alert events" ON "public"."monitoring_alert_events" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read own notifications" ON "public"."admin_notifications" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Admins can read reputation rules" ON "public"."reputation_rules" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read rpc rate limit counters" ON "public"."rpc_rate_limit_counters" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read rpc rate limit hits" ON "public"."rpc_rate_limit_hits" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can read rpc rate limit rules" ON "public"."rpc_rate_limit_rules" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update ai admin actions" ON "public"."ai_admin_actions" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update ai training feedback" ON "public"."ai_training_feedback" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update all battles" ON "public"."battles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update app settings" ON "public"."app_settings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update battle quality snapshots via RPC only" ON "public"."battle_quality_snapshots" FOR UPDATE TO "authenticated" USING (("public"."is_admin"("auth"."uid"()) AND ("current_setting"('app.battle_quality_snapshot_rpc'::"text", true) = '1'::"text"))) WITH CHECK (("public"."is_admin"("auth"."uid"()) AND ("current_setting"('app.battle_quality_snapshot_rpc'::"text", true) = '1'::"text")));



CREATE POLICY "Admins can update contact messages" ON "public"."contact_messages" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update monitoring alert events" ON "public"."monitoring_alert_events" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update news videos" ON "public"."news_videos" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update own notifications" ON "public"."admin_notifications" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."is_admin"("auth"."uid"()))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Admins can update rpc rate limit rules" ON "public"."rpc_rate_limit_rules" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can update site audio settings" ON "public"."site_audio_settings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all battle comments" ON "public"."battle_comments" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all battle product snapshots" ON "public"."battle_product_snapshots" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all battles" ON "public"."battles" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view all profiles" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view audio processing jobs" ON "public"."audio_processing_jobs" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Admins can view site audio settings" ON "public"."site_audio_settings" FOR SELECT TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Anyone can read competitive seasons" ON "public"."competitive_seasons" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can read licenses" ON "public"."licenses" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can read producer badges" ON "public"."producer_badges" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can read season results" ON "public"."season_results" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can read user badges" ON "public"."user_badges" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view active genres" ON "public"."genres" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view active moods" ON "public"."moods" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view active producer plans" ON "public"."producer_plans" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view public battle product snapshots" ON "public"."battle_product_snapshots" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "battle_product_snapshots"."battle_id") AND ("b"."status" = ANY (ARRAY['active'::"public"."battle_status", 'voting'::"public"."battle_status", 'completed'::"public"."battle_status"]))))));



CREATE POLICY "Anyone can view public battles" ON "public"."battles" FOR SELECT USING (("status" = ANY (ARRAY['active'::"public"."battle_status", 'voting'::"public"."battle_status", 'completed'::"public"."battle_status"])));



CREATE POLICY "Anyone can view visible comments" ON "public"."battle_comments" FOR SELECT USING (("is_hidden" = false));



CREATE POLICY "Auth service can insert profiles" ON "public"."user_profiles" FOR INSERT TO "service_role", "supabase_auth_admin" WITH CHECK (true);



CREATE POLICY "Authenticated admins can create forum categories" ON "public"."forum_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Authenticated admins can delete forum categories" ON "public"."forum_categories" FOR DELETE TO "authenticated" USING ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Authenticated admins can update forum categories" ON "public"."forum_categories" FOR UPDATE TO "authenticated" USING ("public"."is_admin"("auth"."uid"())) WITH CHECK ("public"."is_admin"("auth"."uid"()));



CREATE POLICY "Authenticated users can read own contact messages" ON "public"."contact_messages" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Buyers can view purchased products" ON "public"."products" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."purchases" "pu"
  WHERE (("pu"."product_id" = "products"."id") AND ("pu"."user_id" = "auth"."uid"()) AND ("pu"."status" = ANY (ARRAY['completed'::"public"."purchase_status", 'refunded'::"public"."purchase_status"])))))));



CREATE POLICY "Confirmed users can comment" ON "public"."battle_comments" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("public"."is_current_user_active"("auth"."uid"()) = true) AND "public"."is_email_verified_user"("auth"."uid"()) AND ("current_setting"('app.battle_comment_rpc'::"text", true) = '1'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "battle_comments"."battle_id") AND ("b"."status" = ANY (ARRAY['active'::"public"."battle_status", 'voting'::"public"."battle_status"])))))));



CREATE POLICY "Confirmed users can vote" ON "public"."battle_votes" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("public"."is_current_user_active"("auth"."uid"()) = true) AND "public"."is_email_verified_user"("auth"."uid"()) AND "public"."is_account_old_enough"("auth"."uid"(), '24:00:00'::interval) AND ("current_setting"('app.battle_vote_rpc'::"text", true) = '1'::"text") AND ("voted_for_producer_id" <> "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "battle_votes"."battle_id") AND ("b"."status" = 'active'::"public"."battle_status") AND ("b"."starts_at" IS NOT NULL) AND ("b"."starts_at" <= "now"()) AND ("b"."voting_ends_at" IS NOT NULL) AND ("now"() < "b"."voting_ends_at") AND ("b"."producer1_id" IS NOT NULL) AND ("b"."producer2_id" IS NOT NULL) AND (("battle_votes"."voted_for_producer_id" = "b"."producer1_id") OR ("battle_votes"."voted_for_producer_id" = "b"."producer2_id")) AND ("auth"."uid"() <> "b"."producer1_id") AND ("auth"."uid"() <> "b"."producer2_id")))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."battle_votes" "bv"
  WHERE (("bv"."battle_id" = "battle_votes"."battle_id") AND ("bv"."user_id" = "auth"."uid"()))))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."battle_votes" "bv_recent"
  WHERE (("bv_recent"."user_id" = "auth"."uid"()) AND ("bv_recent"."created_at" > ("now"() - '00:00:30'::interval))))))));



CREATE POLICY "Elite interest insertable" ON "public"."elite_interest" FOR INSERT TO "authenticated", "anon" WITH CHECK (("length"(TRIM(BOTH FROM "email")) > 3));



CREATE POLICY "Forum categories readable" ON "public"."forum_categories" FOR SELECT TO "authenticated", "anon" USING ((("is_premium_only" = false) OR "public"."forum_has_active_subscription"("auth"."uid"())));



CREATE POLICY "Forum likes are publicly readable" ON "public"."forum_likes" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Forum post likes readable" ON "public"."forum_post_likes" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM ("public"."forum_posts" "fp"
     JOIN "public"."forum_topics" "ft" ON (("ft"."id" = "fp"."topic_id")))
  WHERE (("fp"."id" = "forum_post_likes"."post_id") AND "public"."forum_can_access_category"("ft"."category_id", "auth"."uid"())))));



CREATE POLICY "Forum posts readable" ON "public"."forum_posts" FOR SELECT TO "authenticated", "anon" USING (((EXISTS ( SELECT 1
   FROM "public"."forum_topics" "ft"
  WHERE (("ft"."id" = "forum_posts"."topic_id") AND ("ft"."is_deleted" = false) AND "public"."forum_can_access_category"("ft"."category_id", "auth"."uid"())))) AND ("public"."is_admin"("auth"."uid"()) OR ("user_id" = "auth"."uid"()) OR (("is_deleted" = false) AND ("is_visible" = true)))));



CREATE POLICY "Forum topics readable" ON "public"."forum_topics" FOR SELECT TO "authenticated", "anon" USING (("public"."forum_can_access_category"("category_id", "auth"."uid"()) AND ((COALESCE("is_deleted", false) = false) OR ("user_id" = "auth"."uid"()) OR "public"."is_admin"("auth"."uid"()))));



CREATE POLICY "Likes via RPC only" ON "public"."forum_likes" FOR INSERT TO "authenticated" WITH CHECK ((("current_setting"('app.forum_like_rpc'::"text", true) = '1'::"text") AND ("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."forum_posts" "fp"
  WHERE (("fp"."id" = "forum_likes"."post_id") AND (COALESCE("fp"."is_deleted", false) = false))))));



CREATE POLICY "Likes via RPC only" ON "public"."forum_post_likes" FOR INSERT TO "authenticated" WITH CHECK ((("current_setting"('app.forum_like_rpc'::"text", true) = '1'::"text") AND ("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."forum_posts" "fp"
     JOIN "public"."forum_topics" "ft" ON (("ft"."id" = "fp"."topic_id")))
  WHERE (("fp"."id" = "forum_post_likes"."post_id") AND ("fp"."is_deleted" = false) AND "public"."forum_can_write_topic"("ft"."id", "auth"."uid"()))))));



CREATE POLICY "Owner can select own profile" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Owner can update own profile" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) AND (COALESCE("is_deleted", false) = false) AND ("deleted_at" IS NULL))) WITH CHECK ((("id" = "auth"."uid"()) AND (COALESCE("is_deleted", false) = false) AND ("deleted_at" IS NULL) AND (NOT ("role" IS DISTINCT FROM ( SELECT "user_profiles_1"."role"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("producer_tier" IS DISTINCT FROM ( SELECT "user_profiles_1"."producer_tier"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("is_confirmed" IS DISTINCT FROM ( SELECT "user_profiles_1"."is_confirmed"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("is_producer_active" IS DISTINCT FROM ( SELECT "user_profiles_1"."is_producer_active"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("stripe_customer_id" IS DISTINCT FROM ( SELECT "user_profiles_1"."stripe_customer_id"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("stripe_subscription_id" IS DISTINCT FROM ( SELECT "user_profiles_1"."stripe_subscription_id"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("subscription_status" IS DISTINCT FROM ( SELECT "user_profiles_1"."subscription_status"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("total_purchases" IS DISTINCT FROM ( SELECT "user_profiles_1"."total_purchases"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("confirmed_at" IS DISTINCT FROM ( SELECT "user_profiles_1"."confirmed_at"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("producer_verified_at" IS DISTINCT FROM ( SELECT "user_profiles_1"."producer_verified_at"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("battle_refusal_count" IS DISTINCT FROM ( SELECT "user_profiles_1"."battle_refusal_count"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("battles_participated" IS DISTINCT FROM ( SELECT "user_profiles_1"."battles_participated"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("battles_completed" IS DISTINCT FROM ( SELECT "user_profiles_1"."battles_completed"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("engagement_score" IS DISTINCT FROM ( SELECT "user_profiles_1"."engagement_score"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("elo_rating" IS DISTINCT FROM ( SELECT "user_profiles_1"."elo_rating"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("battle_wins" IS DISTINCT FROM ( SELECT "user_profiles_1"."battle_wins"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("battle_losses" IS DISTINCT FROM ( SELECT "user_profiles_1"."battle_losses"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("battle_draws" IS DISTINCT FROM ( SELECT "user_profiles_1"."battle_draws"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("is_deleted" IS DISTINCT FROM ( SELECT "user_profiles_1"."is_deleted"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("deleted_at" IS DISTINCT FROM ( SELECT "user_profiles_1"."deleted_at"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("delete_reason" IS DISTINCT FROM ( SELECT "user_profiles_1"."delete_reason"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"())))) AND (NOT ("deleted_label" IS DISTINCT FROM ( SELECT "user_profiles_1"."deleted_label"
   FROM "public"."user_profiles" "user_profiles_1"
  WHERE ("user_profiles_1"."id" = "auth"."uid"()))))));



CREATE POLICY "Owner or admin can read music preferences" ON "public"."user_music_preferences" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Owner or admin can read user reputation" ON "public"."user_reputation" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Owners or admins can delete forum likes" ON "public"."forum_likes" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Participants can view own battle product snapshots" ON "public"."battle_product_snapshots" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "battle_product_snapshots"."battle_id") AND (("b"."producer1_id" = "auth"."uid"()) OR ("b"."producer2_id" = "auth"."uid"()))))));



CREATE POLICY "Producer can view own products" ON "public"."products" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "producer_id") AND ("deleted_at" IS NULL)));



CREATE POLICY "Producer subscriptions: owner can read" ON "public"."producer_subscriptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Producers can delete own product files" ON "public"."product_files" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."products"
  WHERE (("products"."id" = "product_files"."product_id") AND ("products"."producer_id" = "auth"."uid"()) AND ("products"."is_sold" = false)))));



CREATE POLICY "Producers can update own pending battles" ON "public"."battles" FOR UPDATE TO "authenticated" USING (((("producer1_id" = "auth"."uid"()) OR ("producer2_id" = "auth"."uid"())) AND ("status" = 'pending'::"public"."battle_status"))) WITH CHECK (((("producer1_id" = "auth"."uid"()) OR ("producer2_id" = "auth"."uid"())) AND ("status" = 'pending'::"public"."battle_status") AND ("winner_id" IS NULL) AND ("votes_producer1" = 0) AND ("votes_producer2" = 0) AND ("accepted_at" IS NULL) AND ("rejected_at" IS NULL) AND ("admin_validated_at" IS NULL)));



CREATE POLICY "Producers can update own unsold products" ON "public"."products" FOR UPDATE TO "authenticated" USING ((("producer_id" = "auth"."uid"()) AND ("deleted_at" IS NULL) AND ("public"."is_current_user_active"("auth"."uid"()) = true) AND (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."is_producer_active" = true) AND (COALESCE("up"."is_deleted", false) = false) AND ("up"."deleted_at" IS NULL)))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."purchases" "pu"
  WHERE (("pu"."product_id" = "products"."id") AND ("pu"."status" = ANY (ARRAY['completed'::"public"."purchase_status", 'refunded'::"public"."purchase_status"])))))))) WITH CHECK ((("producer_id" = "auth"."uid"()) AND ("deleted_at" IS NULL) AND ("public"."is_current_user_active"("auth"."uid"()) = true) AND (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."is_producer_active" = true) AND (COALESCE("up"."is_deleted", false) = false) AND ("up"."deleted_at" IS NULL)))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."purchases" "pu"
  WHERE (("pu"."product_id" = "products"."id") AND ("pu"."status" = ANY (ARRAY['completed'::"public"."purchase_status", 'refunded'::"public"."purchase_status"])))))) AND ((NOT (("product_type" = 'beat'::"public"."product_type") AND ("is_published" = true) AND ("deleted_at" IS NULL))) OR "public"."can_publish_beat"("auth"."uid"(), "id"))));



CREATE POLICY "Producers can view own battles" ON "public"."battles" FOR SELECT TO "authenticated" USING ((("producer1_id" = "auth"."uid"()) OR ("producer2_id" = "auth"."uid"())));



CREATE POLICY "Producers can view own product files" ON "public"."product_files" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."products"
  WHERE (("products"."id" = "product_files"."product_id") AND ("products"."producer_id" = "auth"."uid"())))));



CREATE POLICY "Producers can view sales of their products" ON "public"."purchases" FOR SELECT TO "authenticated" USING (("producer_id" = "auth"."uid"()));



CREATE POLICY "Public can insert contact messages" ON "public"."contact_messages" FOR INSERT TO "authenticated", "anon" WITH CHECK (((("auth"."uid"() IS NULL) AND ("user_id" IS NULL) AND ("email" IS NOT NULL) AND ("length"("btrim"("email")) > 0)) OR (("auth"."uid"() IS NOT NULL) AND ("user_id" = "auth"."uid"()))));



CREATE POLICY "Public can read published news videos" ON "public"."news_videos" FOR SELECT TO "authenticated", "anon" USING (("is_published" = true));



CREATE POLICY "Public can read safe app settings" ON "public"."app_settings" FOR SELECT TO "authenticated", "anon" USING (("key" = ANY (ARRAY['social_links'::"text"])));



CREATE POLICY "Public can view active products" ON "public"."products" FOR SELECT TO "authenticated", "anon" USING ((("deleted_at" IS NULL) AND ("status" = 'active'::"text") AND ("is_published" IS DISTINCT FROM false) AND (("is_exclusive" = false) OR (("is_exclusive" = true) AND ("is_sold" = false)))));



CREATE POLICY "Reputation events readable by owner or admin" ON "public"."reputation_events" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



CREATE POLICY "Service role can manage notification email log" ON "public"."notification_email_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Stripe events deny clients" ON "public"."stripe_events" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "Users can add to cart" ON "public"."cart_items" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."products"
  WHERE (("products"."id" = "cart_items"."product_id") AND ("products"."is_published" = true) AND (("products"."is_exclusive" = false) OR ("products"."is_sold" = false)))))));



CREATE POLICY "Users can add to wishlist" ON "public"."wishlists" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own comments" ON "public"."battle_comments" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert music preferences via RPC only" ON "public"."user_music_preferences" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("score" >= 0) AND ("current_setting"('app.user_music_pref_rpc'::"text", true) = '1'::"text") AND ("criterion" = ANY (ARRAY['groove'::"text", 'melody'::"text", 'ambience'::"text", 'sound_design'::"text", 'drums'::"text", 'mix'::"text", 'originality'::"text", 'energy'::"text", 'artistic_vibe'::"text"]))));



CREATE POLICY "Users can insert their own play events" ON "public"."play_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read own battle votes" ON "public"."battle_votes" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read their own play events" ON "public"."play_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can remove from cart" ON "public"."cart_items" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can remove from wishlist" ON "public"."wishlists" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can submit battle vote feedback via RPC only" ON "public"."battle_vote_feedback" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("current_setting"('app.battle_vote_feedback_rpc'::"text", true) = '1'::"text") AND ("criterion" = ANY (ARRAY['groove'::"text", 'melody'::"text", 'ambience'::"text", 'sound_design'::"text", 'drums'::"text", 'mix'::"text", 'originality'::"text", 'energy'::"text", 'artistic_vibe'::"text"]))));



CREATE POLICY "Users can update music preferences via RPC only" ON "public"."user_music_preferences" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND ("current_setting"('app.user_music_pref_rpc'::"text", true) = '1'::"text"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("score" >= 0) AND ("current_setting"('app.user_music_pref_rpc'::"text", true) = '1'::"text") AND ("criterion" = ANY (ARRAY['groove'::"text", 'melody'::"text", 'ambience'::"text", 'sound_design'::"text", 'drums'::"text", 'mix'::"text", 'originality'::"text", 'energy'::"text", 'artistic_vibe'::"text"]))));



CREATE POLICY "Users can update own comments" ON "public"."battle_comments" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND ("is_hidden" = false)));



CREATE POLICY "Users can view own audit logs" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own cart" ON "public"."cart_items" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own download logs" ON "public"."download_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own entitlements" ON "public"."entitlements" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own locks" ON "public"."exclusive_locks" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own preview access logs" ON "public"."preview_access_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own purchases" ON "public"."purchases" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own wishlist" ON "public"."wishlists" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users or admins can unlike forum posts" ON "public"."forum_post_likes" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"("auth"."uid"())));



ALTER TABLE "public"."admin_action_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_admin_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_training_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audio_processing_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_product_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_quality_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_vote_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cart_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitive_seasons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_submit_rate_limit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contract_generation_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contract_url_rate_limit_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."download_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."elite_interest" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exclusive_locks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_assistant_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_moderation_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_post_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forum_topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fraud_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."genres" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."licenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monitoring_alert_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."moods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."news_videos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_email_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."play_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."preview_access_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producer_badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producer_plan_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producer_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producer_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reputation_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reputation_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rpc_rate_limit_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rpc_rate_limit_hits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rpc_rate_limit_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."season_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_audio_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_music_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_reputation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."v_days" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watermark_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wishlists" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































REVOKE ALL ON FUNCTION "public"."admin_adjust_reputation"("p_user_id" "uuid", "p_delta_xp" integer, "p_reason" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_adjust_reputation"("p_user_id" "uuid", "p_delta_xp" integer, "p_reason" "text", "p_metadata" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_adjust_reputation"("p_user_id" "uuid", "p_delta_xp" integer, "p_reason" "text", "p_metadata" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_cancel_battle"("p_battle_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_battle"("p_battle_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_cancel_battle"("p_battle_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_extend_battle_duration"("p_battle_id" "uuid", "p_days" integer, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_extend_battle_duration"("p_battle_id" "uuid", "p_days" integer, "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_extend_battle_duration"("p_battle_id" "uuid", "p_days" integer, "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_validate_battle"("p_battle_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_validate_battle"("p_battle_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_validate_battle"("p_battle_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."agent_finalize_expired_battles"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_finalize_expired_battles"("p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."agent_finalize_expired_battles"("p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_reputation_event_internal"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_reputation_event_internal"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_battle_skill_gap"("p_producer1" "uuid", "p_producer2" "uuid", "p_max_diff" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_battle_skill_gap"("p_producer1" "uuid", "p_producer2" "uuid", "p_max_diff" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_battle_skill_gap"("p_producer1" "uuid", "p_producer2" "uuid", "p_max_diff" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."battles_force_created_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."battles_force_created_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."battles_force_created_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."battles_lock_created_at_on_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."battles_lock_created_at_on_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."battles_lock_created_at_on_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_exclusive_preview"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_exclusive_preview"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_exclusive_preview"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_create_active_battle"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_create_active_battle"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_active_battle"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_create_battle"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_create_battle"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_battle"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_create_product"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_create_product"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_product"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_edit_product"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_edit_product"("p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_product"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_product"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_publish_beat"("p_user_id" "uuid", "p_exclude_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_publish_beat"("p_user_id" "uuid", "p_exclude_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_publish_beat"("p_user_id" "uuid", "p_exclude_product_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_battle_product_snapshots"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_battle_product_snapshots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_battle_product_snapshots"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_and_assign_badges"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_and_assign_badges"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_daily_battle_refusals"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_daily_battle_refusals"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_daily_battle_refusals"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_rpc_rate_limit"("p_user_id" "uuid", "p_rpc_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_rpc_rate_limit"("p_user_id" "uuid", "p_rpc_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."check_rpc_rate_limit"("p_user_id" "uuid", "p_rpc_name" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."check_stripe_event_processed"("p_event_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_stripe_event_processed"("p_event_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_stripe_event_processed"("p_event_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_user_confirmation_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_user_confirmation_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_user_confirmation_status"() TO "service_role";



GRANT ALL ON TABLE "public"."audio_processing_jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."audio_processing_jobs" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."claim_audio_processing_jobs"("p_limit" integer, "p_worker" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_audio_processing_jobs"("p_limit" integer, "p_worker" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_audio_processing_jobs"("p_limit" integer, "p_worker" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_audio_processing_jobs"("p_limit" integer, "p_worker" "text") TO "service_role";



GRANT ALL ON TABLE "public"."contract_generation_jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."contract_generation_jobs" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."claim_contract_generation_jobs"("p_limit" integer, "p_worker" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_contract_generation_jobs"("p_limit" integer, "p_worker" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."claim_contract_generation_jobs"("p_limit" integer, "p_worker" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."claim_notification_email_send"("p_category" "text", "p_recipient_email" "text", "p_dedupe_key" "text", "p_rate_limit_seconds" integer, "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_notification_email_send"("p_category" "text", "p_recipient_email" "text", "p_dedupe_key" "text", "p_rate_limit_seconds" integer, "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."classify_battle_comment_rule_based"("p_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."classify_battle_comment_rule_based"("p_content" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_exclusive_locks"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_exclusive_locks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_exclusive_locks"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_rpc_rate_limit_counters"("p_keep_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_rpc_rate_limit_counters"("p_keep_hours" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_exclusive_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_exclusive_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_license_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_license_id" "uuid", "p_amount" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_license_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_license_id" "uuid", "p_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_standard_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer, "p_license_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_standard_purchase"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text", "p_payment_intent_id" "text", "p_amount" integer, "p_license_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_preview_signature"("p_master_reference" "text", "p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_preview_signature"("p_master_reference" "text", "p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_preview_signature"("p_master_reference" "text", "p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_preview_signature"("p_master_reference" "text", "p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_watermark_hash"("p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_watermark_hash"("p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_watermark_hash"("p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_watermark_hash"("p_watermark_audio_path" "text", "p_gain_db" numeric, "p_min_interval_sec" integer, "p_max_interval_sec" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_exclusive_lock"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_exclusive_lock"("p_product_id" "uuid", "p_user_id" "uuid", "p_checkout_session_id" "text") TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."products" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("producer_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("producer_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("title") ON TABLE "public"."products" TO "anon";
GRANT SELECT("title") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("slug") ON TABLE "public"."products" TO "anon";
GRANT SELECT("slug") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("description") ON TABLE "public"."products" TO "anon";
GRANT SELECT("description") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("product_type") ON TABLE "public"."products" TO "anon";
GRANT SELECT("product_type") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("genre_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("genre_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("mood_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("mood_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("bpm") ON TABLE "public"."products" TO "anon";
GRANT SELECT("bpm") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("key_signature") ON TABLE "public"."products" TO "anon";
GRANT SELECT("key_signature") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("price") ON TABLE "public"."products" TO "anon";
GRANT SELECT("price") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("preview_url") ON TABLE "public"."products" TO "anon";
GRANT SELECT("preview_url") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("exclusive_preview_url") ON TABLE "public"."products" TO "anon";
GRANT SELECT("exclusive_preview_url") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("cover_image_url") ON TABLE "public"."products" TO "anon";
GRANT SELECT("cover_image_url") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("is_exclusive") ON TABLE "public"."products" TO "anon";
GRANT SELECT("is_exclusive") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("is_sold") ON TABLE "public"."products" TO "anon";
GRANT SELECT("is_sold") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("sold_at") ON TABLE "public"."products" TO "anon";
GRANT SELECT("sold_at") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("sold_to_user_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("sold_to_user_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("is_published") ON TABLE "public"."products" TO "anon";
GRANT SELECT("is_published") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("play_count") ON TABLE "public"."products" TO "anon";
GRANT SELECT("play_count") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("tags") ON TABLE "public"."products" TO "anon";
GRANT SELECT("tags") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("duration_seconds") ON TABLE "public"."products" TO "anon";
GRANT SELECT("duration_seconds") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("file_format") ON TABLE "public"."products" TO "anon";
GRANT SELECT("file_format") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("license_terms") ON TABLE "public"."products" TO "anon";
GRANT SELECT("license_terms") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."products" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."products" TO "anon";
GRANT SELECT("updated_at") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("watermarked_path") ON TABLE "public"."products" TO "anon";
GRANT SELECT("watermarked_path") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("master_path") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("watermark_profile_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("watermark_profile_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("deleted_at") ON TABLE "public"."products" TO "anon";
GRANT SELECT("deleted_at") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("processing_status") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("processing_error") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("preview_version") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("processed_at") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("watermarked_bucket") ON TABLE "public"."products" TO "service_role";
GRANT SELECT("watermarked_bucket") ON TABLE "public"."products" TO "anon";
GRANT SELECT("watermarked_bucket") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("preview_signature"),UPDATE("preview_signature") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("last_watermark_hash"),UPDATE("last_watermark_hash") ON TABLE "public"."products" TO "service_role";



GRANT SELECT("status") ON TABLE "public"."products" TO "anon";
GRANT SELECT("status") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("version") ON TABLE "public"."products" TO "anon";
GRANT SELECT("version") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("original_beat_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("original_beat_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("version_number") ON TABLE "public"."products" TO "anon";
GRANT SELECT("version_number") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("parent_product_id") ON TABLE "public"."products" TO "anon";
GRANT SELECT("parent_product_id") ON TABLE "public"."products" TO "authenticated";



GRANT SELECT("archived_at") ON TABLE "public"."products" TO "anon";
GRANT SELECT("archived_at") ON TABLE "public"."products" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_new_version_from_beat"("p_beat_id" "uuid", "p_new_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_new_version_from_beat"("p_beat_id" "uuid", "p_new_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_new_version_from_beat"("p_beat_id" "uuid", "p_new_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_new_version_from_beat"("p_beat_id" "uuid", "p_new_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_beat_if_no_sales"("p_beat_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_beat_if_no_sales"("p_beat_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_beat_if_no_sales"("p_beat_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_beat_if_no_sales"("p_beat_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_my_account"("p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_my_account"("p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_my_account"("p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."detect_admin_action_anomalies"("p_lookback_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."detect_admin_action_anomalies"("p_lookback_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_active_user_id_reference"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_active_user_id_reference"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_active_user_id_reference"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_admin_notifications_for_ai_action"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_admin_notifications_for_ai_action"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_admin_notifications_for_ai_action"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_audio_processing_job"("p_product_id" "uuid", "p_job_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_audio_processing_job"("p_product_id" "uuid", "p_job_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_audio_processing_job"("p_product_id" "uuid", "p_job_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_audio_processing_job"("p_product_id" "uuid", "p_job_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_contract_generation_job"("p_purchase_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_contract_generation_job"("p_purchase_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."enqueue_contract_generation_job"("p_purchase_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."enqueue_product_preview_job"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_product_preview_job"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_product_preview_job"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_reprocess_all_previews"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_reprocess_all_previews"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_reprocess_all_previews"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_reprocess_all_previews"() TO "service_role";



GRANT ALL ON TABLE "public"."user_reputation" TO "service_role";
GRANT SELECT ON TABLE "public"."user_reputation" TO "anon";
GRANT SELECT ON TABLE "public"."user_reputation" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ensure_user_reputation_row"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_user_reputation_row"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_battle"("p_battle_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_battle"("p_battle_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_battle"("p_battle_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finalize_expired_battles"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_expired_battles"("p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_expired_battles"("p_limit" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."force_battle_insert_timestamps"() TO "anon";
GRANT ALL ON FUNCTION "public"."force_battle_insert_timestamps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_battle_insert_timestamps"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."force_reprocess_all_previews"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."force_reprocess_all_previews"() TO "anon";
GRANT ALL ON FUNCTION "public"."force_reprocess_all_previews"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_reprocess_all_previews"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."format_watermark_gain_db"("p_gain_db" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."format_watermark_gain_db"("p_gain_db" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."format_watermark_gain_db"("p_gain_db" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."format_watermark_gain_db"("p_gain_db" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."forum_admin_delete_category"("p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_admin_delete_category"("p_category_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."forum_admin_delete_category"("p_category_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."forum_posts" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_posts" TO "anon";
GRANT SELECT ON TABLE "public"."forum_posts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."forum_admin_set_post_state"("p_post_id" "uuid", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_admin_set_post_state"("p_post_id" "uuid", "p_action" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."forum_admin_set_post_state"("p_post_id" "uuid", "p_action" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."forum_topics" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_topics" TO "anon";
GRANT SELECT ON TABLE "public"."forum_topics" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."forum_admin_set_topic_deleted"("p_topic_id" "uuid", "p_is_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_admin_set_topic_deleted"("p_topic_id" "uuid", "p_is_deleted" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."forum_admin_set_topic_deleted"("p_topic_id" "uuid", "p_is_deleted" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."forum_admin_upsert_category"("p_category_id" "uuid", "p_name" "text", "p_slug" "text", "p_description" "text", "p_position" integer, "p_is_premium_only" boolean, "p_xp_multiplier" numeric, "p_moderation_strictness" "text", "p_is_competitive" boolean, "p_required_rank_tier" "text", "p_allow_links" boolean, "p_allow_media" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_admin_upsert_category"("p_category_id" "uuid", "p_name" "text", "p_slug" "text", "p_description" "text", "p_position" integer, "p_is_premium_only" boolean, "p_xp_multiplier" numeric, "p_moderation_strictness" "text", "p_is_competitive" boolean, "p_required_rank_tier" "text", "p_allow_links" boolean, "p_allow_media" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."forum_admin_upsert_category"("p_category_id" "uuid", "p_name" "text", "p_slug" "text", "p_description" "text", "p_position" integer, "p_is_premium_only" boolean, "p_xp_multiplier" numeric, "p_moderation_strictness" "text", "p_is_competitive" boolean, "p_required_rank_tier" "text", "p_allow_links" boolean, "p_allow_media" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."forum_can_access_category"("p_category_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_can_access_category"("p_category_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."forum_can_access_category"("p_category_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_can_access_category"("p_category_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."forum_can_write_topic"("p_topic_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_can_write_topic"("p_topic_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."forum_can_write_topic"("p_topic_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_can_write_topic"("p_topic_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."forum_get_user_rank_tier"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."forum_get_user_rank_tier"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_get_user_rank_tier"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."forum_has_active_subscription"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_has_active_subscription"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."forum_has_active_subscription"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_has_active_subscription"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."forum_is_assistant_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."forum_is_assistant_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."forum_is_assistant_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_is_assistant_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."forum_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."forum_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."forum_user_meets_rank_requirement"("p_user_id" "uuid", "p_required_rank_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."forum_user_meets_rank_requirement"("p_user_id" "uuid", "p_required_rank_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."forum_user_meets_rank_requirement"("p_user_id" "uuid", "p_required_rank_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_battle_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_battle_slug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_battle_slug"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_product_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_product_slug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_product_slug"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_season"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_season"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_season"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_active_season"() TO "anon";



REVOKE ALL ON FUNCTION "public"."get_active_season_details"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_season_details"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_season_details"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_active_season_details"() TO "anon";



REVOKE ALL ON FUNCTION "public"."get_admin_business_metrics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_business_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_business_metrics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_metrics_timeseries"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_metrics_timeseries"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_metrics_timeseries"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_pilotage_deltas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_pilotage_deltas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_pilotage_deltas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_pilotage_metrics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_pilotage_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_pilotage_metrics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_advanced_producer_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_advanced_producer_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_advanced_producer_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_battles_quota_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_battles_quota_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_battles_quota_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_forum_public_profiles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_forum_public_profiles"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_forum_public_profiles"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_home_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_home_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_home_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_home_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_leaderboard_producers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_leaderboard_producers"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_leaderboard_producers"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_leaderboard_producers"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_matchmaking_opponents"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_matchmaking_opponents"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_matchmaking_opponents"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_plan_limits"("p_tier" "public"."producer_tier_type") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_plan_limits"("p_tier" "public"."producer_tier_type") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_plan_limits"("p_tier" "public"."producer_tier_type") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_producer_tier"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_producer_tier"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_producer_tier"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_producer_profiles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_producer_profiles"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_producer_profiles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_producer_profiles"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_producer_profiles_v2"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_producer_profiles_v2"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_producer_profiles_v2"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_producer_profiles_v2"() TO "authenticated";



GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."user_profiles" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_profile_label"("profile_row" "public"."user_profiles") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_profile_label"("profile_row" "public"."user_profiles") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_profile_label"("profile_row" "public"."user_profiles") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_profile_label"("profile_row" "public"."user_profiles") TO "anon";



REVOKE ALL ON FUNCTION "public"."get_request_headers_jsonb"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_request_headers_jsonb"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_weekly_leaderboard"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_weekly_leaderboard"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_weekly_leaderboard"("p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_weekly_leaderboard"("p_limit" integer) TO "anon";



GRANT ALL ON FUNCTION "public"."guard_product_editability"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_product_editability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_product_editability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_product_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_product_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_product_hard_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_forum_post_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_forum_post_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_forum_post_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_forum_post_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_producer_tier"("p_user_id" "uuid", "p_min_tier" "public"."producer_tier_type") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_producer_tier"("p_user_id" "uuid", "p_min_tier" "public"."producer_tier_type") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_producer_tier"("p_user_id" "uuid", "p_min_tier" "public"."producer_tier_type") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hash_request_value"("p_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hash_request_value"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hash_request_value"("p_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_play_count"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_play_count"("p_product_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."increment_play_count"("p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_account_old_enough"("p_user_id" "uuid", "p_min_age" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_account_old_enough"("p_user_id" "uuid", "p_min_age" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_account_old_enough"("p_user_id" "uuid", "p_min_age" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_producer"("p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_producer"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_producer"("p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_confirmed_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_confirmed_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_confirmed_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_current_user_active"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_current_user_active"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_user_active"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_email_verified_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_email_verified_user"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_email_verified_user"("p_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_valid_product_master_path"("p_producer_id" "uuid", "p_product_id" "uuid", "p_path" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_valid_product_master_path"("p_producer_id" "uuid", "p_product_id" "uuid", "p_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_valid_product_master_path"("p_producer_id" "uuid", "p_product_id" "uuid", "p_path" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_battle_created_at_on_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."lock_battle_created_at_on_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_battle_created_at_on_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_admin_action_audit"("p_admin_user_id" "uuid", "p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_source" "text", "p_source_action_id" "uuid", "p_context" "jsonb", "p_extra_details" "jsonb", "p_success" boolean, "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_admin_action_audit"("p_admin_user_id" "uuid", "p_action_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_source" "text", "p_source_action_id" "uuid", "p_context" "jsonb", "p_extra_details" "jsonb", "p_success" boolean, "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_action" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_ip_address" "inet", "p_user_agent" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_action" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_ip_address" "inet", "p_user_agent" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_action" "text", "p_resource_type" "text", "p_resource_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_ip_address" "inet", "p_user_agent" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_fraud_event"("p_event_type" "text", "p_user_id" "uuid", "p_battle_id" "uuid", "p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_fraud_event"("p_event_type" "text", "p_user_id" "uuid", "p_battle_id" "uuid", "p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_fraud_event"("p_event_type" "text", "p_user_id" "uuid", "p_battle_id" "uuid", "p_post_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_monitoring_alert"("p_event_type" "text", "p_severity" "text", "p_source" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_monitoring_alert"("p_event_type" "text", "p_severity" "text", "p_source" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_details" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_preview_access"("p_user_id" "uuid", "p_product_id" "uuid", "p_preview_type" "text", "p_ip_address" "inet", "p_user_agent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_preview_access"("p_user_id" "uuid", "p_product_id" "uuid", "p_preview_type" "text", "p_ip_address" "inet", "p_user_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_preview_access"("p_user_id" "uuid", "p_product_id" "uuid", "p_preview_type" "text", "p_ip_address" "inet", "p_user_agent" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_stripe_event_processed"("p_event_id" "text", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_stripe_event_processed"("p_event_id" "text", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_stripe_event_processed"("p_event_id" "text", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_master_storage_path"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_master_storage_path"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_master_storage_path"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_product_version_lineage"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_product_version_lineage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_product_version_lineage"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_admin_action_audit_monitoring"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_admin_action_audit_monitoring"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_admin_action_audit_monitoring"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_battle_completed_competitive"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_battle_completed_competitive"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_battle_completed_competitive"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_battle_completed_reputation"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_battle_completed_reputation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_battle_completed_reputation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_forum_post_like_reputation"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_forum_post_like_reputation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_forum_post_like_reputation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_rpc_rate_limit_hit_create_alert"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_rpc_rate_limit_hit_create_alert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_rpc_rate_limit_hit_create_alert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."populate_purchase_snapshots"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."populate_purchase_snapshots"() TO "anon";
GRANT ALL ON FUNCTION "public"."populate_purchase_snapshots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_purchase_snapshots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_product_preview_processing"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_product_preview_processing"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_product_preview_processing"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_legacy_battle_status_assignments"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_legacy_battle_status_assignments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_legacy_battle_status_assignments"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_ai_comment_moderation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_ai_comment_moderation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."producer_publish_battle"("p_battle_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."producer_publish_battle"("p_battle_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."producer_start_battle_voting"("p_battle_id" "uuid", "p_voting_duration_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."producer_start_battle_voting"("p_battle_id" "uuid", "p_voting_duration_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."producer_tier_rank"("p_tier" "public"."producer_tier_type") TO "anon";
GRANT ALL ON FUNCTION "public"."producer_tier_rank"("p_tier" "public"."producer_tier_type") TO "authenticated";
GRANT ALL ON FUNCTION "public"."producer_tier_rank"("p_tier" "public"."producer_tier_type") TO "service_role";



REVOKE ALL ON FUNCTION "public"."product_has_terminated_battle"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."product_has_terminated_battle"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_has_terminated_battle"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalculate_engagement"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_engagement"("p_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."recalculate_engagement"("p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."recalculate_forum_topic_stats"("p_topic_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_forum_topic_stats"("p_topic_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_forum_topic_stats"("p_topic_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_forum_topic_stats"("p_topic_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_battle_vote"("p_battle_id" "uuid", "p_user_id" "uuid", "p_voted_for_producer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_battle_vote"("p_battle_id" "uuid", "p_user_id" "uuid", "p_voted_for_producer_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_beat_from_sale"("p_beat_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_beat_from_sale"("p_beat_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_beat_from_sale"("p_beat_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_beat_from_sale"("p_beat_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reputation_calculate_level"("p_xp" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."reputation_calculate_level"("p_xp" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reputation_calculate_level"("p_xp" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."reputation_calculate_rank_tier"("p_xp" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."reputation_calculate_rank_tier"("p_xp" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reputation_calculate_rank_tier"("p_xp" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."reputation_rank_tier_value"("p_rank_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reputation_rank_tier_value"("p_rank_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reputation_rank_tier_value"("p_rank_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reputation_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."reputation_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reputation_touch_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_elo_for_new_season"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_elo_for_new_season"() TO "service_role";
GRANT ALL ON FUNCTION "public"."reset_elo_for_new_season"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."respond_to_battle"("p_battle_id" "uuid", "p_accept" boolean, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_to_battle"("p_battle_id" "uuid", "p_accept" boolean, "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."respond_to_battle"("p_battle_id" "uuid", "p_accept" boolean, "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_admin_get_beat_feedback_overview"("p_limit" integer, "p_offset" integer, "p_battle_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_admin_get_beat_feedback_overview"("p_limit" integer, "p_offset" integer, "p_battle_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_admin_get_beat_feedback_overview"("p_limit" integer, "p_offset" integer, "p_battle_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_admin_get_reputation_overview"("p_search" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_admin_get_reputation_overview"("p_search" "text", "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_admin_get_reputation_overview"("p_search" "text", "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_apply_reputation_event"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_apply_reputation_event"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_apply_reputation_event"("p_user_id" "uuid", "p_source" "text", "p_event_type" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_delta" integer, "p_metadata" "jsonb", "p_idempotency_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_archive_product"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_archive_product"("p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_archive_product"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_archive_product"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_check_contract_url_rate_limit"("p_purchase_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_check_contract_url_rate_limit"("p_purchase_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_compute_battle_quality_snapshot"("p_battle_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_compute_battle_quality_snapshot"("p_battle_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_compute_battle_quality_snapshot"("p_battle_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_contact_submit_rate_limit"("p_ip_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_contact_submit_rate_limit"("p_ip_hash" "text") TO "service_role";



GRANT ALL ON TABLE "public"."battle_comments" TO "anon";
GRANT ALL ON TABLE "public"."battle_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."battle_comments" TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_create_battle_comment"("p_battle_id" "uuid", "p_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_create_battle_comment"("p_battle_id" "uuid", "p_content" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_create_battle_comment"("p_battle_id" "uuid", "p_content" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_create_product_version"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_create_product_version"("p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_product_version"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_product_version"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_delete_product_if_no_sales"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_delete_product_if_no_sales"("p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_delete_product_if_no_sales"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_delete_product_if_no_sales"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_forum_create_post"("p_user_id" "uuid", "p_topic_id" "uuid", "p_content" "text", "p_source" "text", "p_moderation_status" "text", "p_is_visible" boolean, "p_is_flagged" boolean, "p_moderation_score" numeric, "p_moderation_reason" "text", "p_moderation_model" "text", "p_is_ai_generated" boolean, "p_ai_agent_name" "text", "p_source_post_id" "uuid", "p_raw_response" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_forum_create_post"("p_user_id" "uuid", "p_topic_id" "uuid", "p_content" "text", "p_source" "text", "p_moderation_status" "text", "p_is_visible" boolean, "p_is_flagged" boolean, "p_moderation_score" numeric, "p_moderation_reason" "text", "p_moderation_model" "text", "p_is_ai_generated" boolean, "p_ai_agent_name" "text", "p_source_post_id" "uuid", "p_raw_response" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_forum_create_topic"("p_user_id" "uuid", "p_category_slug" "text", "p_title" "text", "p_topic_slug" "text", "p_content" "text", "p_source" "text", "p_moderation_status" "text", "p_is_visible" boolean, "p_is_flagged" boolean, "p_moderation_score" numeric, "p_moderation_reason" "text", "p_moderation_model" "text", "p_is_ai_generated" boolean, "p_ai_agent_name" "text", "p_source_post_id" "uuid", "p_raw_response" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_forum_create_topic"("p_user_id" "uuid", "p_category_slug" "text", "p_title" "text", "p_topic_slug" "text", "p_content" "text", "p_source" "text", "p_moderation_status" "text", "p_is_visible" boolean, "p_is_flagged" boolean, "p_moderation_score" numeric, "p_moderation_reason" "text", "p_moderation_model" "text", "p_is_ai_generated" boolean, "p_ai_agent_name" "text", "p_source_post_id" "uuid", "p_raw_response" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_get_leaderboard"("p_period" "text", "p_source" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_get_leaderboard"("p_period" "text", "p_source" "text", "p_limit" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_get_leaderboard"("p_period" "text", "p_source" "text", "p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_like_forum_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_like_forum_post"("p_post_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_like_forum_post"("p_post_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rpc_publish_product_version"("p_source_product_id" "uuid", "p_new_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_publish_product_version"("p_source_product_id" "uuid", "p_new_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_publish_product_version"("p_source_product_id" "uuid", "p_new_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_publish_product_version"("p_source_product_id" "uuid", "p_new_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_submit_battle_vote_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_submit_battle_vote_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rpc_vote_with_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rpc_vote_with_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."rpc_vote_with_feedback"("p_battle_id" "uuid", "p_winner_producer_id" "uuid", "p_criteria" "text"[]) TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_producer_subscription_flags"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_producer_subscription_flags"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_producer_subscription_flags"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."should_flag_battle_refusal_risk"("p_user_id" "uuid", "p_threshold" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."should_flag_battle_refusal_risk"("p_user_id" "uuid", "p_threshold" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."should_flag_battle_refusal_risk"("p_user_id" "uuid", "p_threshold" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."suggest_opponents"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suggest_opponents"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."suggest_opponents"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_executed_ai_actions_to_admin_action_audit_log"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_executed_ai_actions_to_admin_action_audit_log"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_executed_ai_actions_to_admin_action_audit_log"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_user_profile_producer_flag"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_profile_producer_flag"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_profile_producer_flag"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_user_reputation_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_user_reputation_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_user_reputation_row"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_elo_rating"("p_player1" "uuid", "p_player2" "uuid", "p_winner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_elo_rating"("p_player1" "uuid", "p_player2" "uuid", "p_winner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_battle_product_snapshot"("p_battle_id" "uuid", "p_slot" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_battle_product_snapshot"("p_battle_id" "uuid", "p_slot" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_has_entitlement"("p_user_id" "uuid", "p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_entitlement"("p_user_id" "uuid", "p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_entitlement"("p_user_id" "uuid", "p_product_id" "uuid") TO "service_role";
























GRANT ALL ON TABLE "public"."admin_action_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_action_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_action_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."battle_quality_snapshots" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."battle_quality_snapshots" TO "authenticated";



GRANT ALL ON TABLE "public"."battles" TO "anon";
GRANT ALL ON TABLE "public"."battles" TO "authenticated";
GRANT ALL ON TABLE "public"."battles" TO "service_role";



GRANT ALL ON TABLE "public"."public_producer_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."public_producer_profiles" TO "anon";
GRANT SELECT ON TABLE "public"."public_producer_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_battle_quality_latest" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_battle_quality_latest" TO "authenticated";



GRANT ALL ON TABLE "public"."battle_vote_feedback" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."battle_vote_feedback" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_beat_feedback_scores" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_beat_feedback_scores" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_beat_feedback_top_criteria" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_beat_feedback_top_criteria" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_notifications" TO "anon";
GRANT ALL ON TABLE "public"."admin_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."ai_admin_actions" TO "anon";
GRANT ALL ON TABLE "public"."ai_admin_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_admin_actions" TO "service_role";



GRANT ALL ON TABLE "public"."ai_training_feedback" TO "anon";
GRANT ALL ON TABLE "public"."ai_training_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_training_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."fraud_events" TO "service_role";
GRANT SELECT ON TABLE "public"."fraud_events" TO "authenticated";



GRANT ALL ON TABLE "public"."battle_fraud_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."battle_fraud_analysis" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."battle_votes" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."battle_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."battle_votes" TO "service_role";



GRANT ALL ON TABLE "public"."battle_of_the_day" TO "service_role";
GRANT SELECT ON TABLE "public"."battle_of_the_day" TO "anon";
GRANT SELECT ON TABLE "public"."battle_of_the_day" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."battle_product_snapshots" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."battle_product_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."battle_product_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."cart_items" TO "anon";
GRANT ALL ON TABLE "public"."cart_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cart_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."competitive_seasons" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."competitive_seasons" TO "authenticated";
GRANT ALL ON TABLE "public"."competitive_seasons" TO "service_role";



GRANT ALL ON TABLE "public"."contact_messages" TO "anon";
GRANT ALL ON TABLE "public"."contact_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_messages" TO "service_role";



GRANT ALL ON TABLE "public"."contact_submit_rate_limit" TO "anon";
GRANT ALL ON TABLE "public"."contact_submit_rate_limit" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_submit_rate_limit" TO "service_role";



GRANT ALL ON TABLE "public"."contract_url_rate_limit_counters" TO "anon";
GRANT ALL ON TABLE "public"."contract_url_rate_limit_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."contract_url_rate_limit_counters" TO "service_role";



GRANT ALL ON TABLE "public"."download_logs" TO "anon";
GRANT ALL ON TABLE "public"."download_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."download_logs" TO "service_role";



GRANT ALL ON TABLE "public"."elite_interest" TO "service_role";
GRANT INSERT ON TABLE "public"."elite_interest" TO "anon";
GRANT INSERT ON TABLE "public"."elite_interest" TO "authenticated";



GRANT ALL ON TABLE "public"."entitlements" TO "anon";
GRANT ALL ON TABLE "public"."entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."exclusive_locks" TO "anon";
GRANT ALL ON TABLE "public"."exclusive_locks" TO "authenticated";
GRANT ALL ON TABLE "public"."exclusive_locks" TO "service_role";



GRANT ALL ON TABLE "public"."forum_assistant_jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_assistant_jobs" TO "authenticated";



GRANT ALL ON TABLE "public"."forum_categories" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_categories" TO "anon";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."forum_categories" TO "authenticated";



GRANT ALL ON TABLE "public"."forum_likes" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_likes" TO "anon";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."forum_likes" TO "authenticated";



GRANT ALL ON TABLE "public"."forum_moderation_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_moderation_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."forum_post_likes" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_post_likes" TO "anon";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."forum_post_likes" TO "authenticated";



GRANT ALL ON TABLE "public"."forum_public_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."forum_public_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."genres" TO "anon";
GRANT ALL ON TABLE "public"."genres" TO "authenticated";
GRANT ALL ON TABLE "public"."genres" TO "service_role";



GRANT ALL ON TABLE "public"."leaderboard_producers" TO "service_role";
GRANT SELECT ON TABLE "public"."leaderboard_producers" TO "anon";
GRANT SELECT ON TABLE "public"."leaderboard_producers" TO "authenticated";



GRANT ALL ON TABLE "public"."licenses" TO "anon";
GRANT ALL ON TABLE "public"."licenses" TO "authenticated";
GRANT ALL ON TABLE "public"."licenses" TO "service_role";



GRANT ALL ON TABLE "public"."monitoring_alert_events" TO "anon";
GRANT ALL ON TABLE "public"."monitoring_alert_events" TO "authenticated";
GRANT ALL ON TABLE "public"."monitoring_alert_events" TO "service_role";



GRANT ALL ON TABLE "public"."moods" TO "anon";
GRANT ALL ON TABLE "public"."moods" TO "authenticated";
GRANT ALL ON TABLE "public"."moods" TO "service_role";



GRANT ALL ON TABLE "public"."my_user_profile" TO "service_role";
GRANT SELECT ON TABLE "public"."my_user_profile" TO "authenticated";



GRANT ALL ON TABLE "public"."news_videos" TO "anon";
GRANT ALL ON TABLE "public"."news_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."news_videos" TO "service_role";



GRANT ALL ON TABLE "public"."notification_email_log" TO "service_role";



GRANT ALL ON TABLE "public"."play_events" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."play_events" TO "authenticated";



GRANT ALL ON TABLE "public"."preview_access_logs" TO "anon";
GRANT ALL ON TABLE "public"."preview_access_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."preview_access_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."producer_badges" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."producer_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."producer_badges" TO "service_role";



GRANT ALL ON TABLE "public"."producer_plan_config" TO "service_role";
GRANT SELECT ON TABLE "public"."producer_plan_config" TO "anon";
GRANT SELECT ON TABLE "public"."producer_plan_config" TO "authenticated";



GRANT ALL ON TABLE "public"."producer_plans" TO "anon";
GRANT ALL ON TABLE "public"."producer_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."producer_plans" TO "service_role";



GRANT ALL ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT ALL ON TABLE "public"."producer_stats" TO "anon";
GRANT ALL ON TABLE "public"."producer_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."producer_stats" TO "service_role";



GRANT ALL ON TABLE "public"."producer_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."producer_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."producer_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."product_files" TO "anon";
GRANT ALL ON TABLE "public"."product_files" TO "authenticated";
GRANT ALL ON TABLE "public"."product_files" TO "service_role";



GRANT ALL ON TABLE "public"."products_public" TO "anon";
GRANT ALL ON TABLE "public"."products_public" TO "authenticated";
GRANT ALL ON TABLE "public"."products_public" TO "service_role";



GRANT ALL ON TABLE "public"."public_producer_profiles_v2" TO "service_role";
GRANT SELECT ON TABLE "public"."public_producer_profiles_v2" TO "anon";
GRANT SELECT ON TABLE "public"."public_producer_profiles_v2" TO "authenticated";



GRANT ALL ON TABLE "public"."public_products" TO "anon";
GRANT ALL ON TABLE "public"."public_products" TO "authenticated";
GRANT ALL ON TABLE "public"."public_products" TO "service_role";



GRANT ALL ON TABLE "public"."reputation_events" TO "service_role";
GRANT SELECT ON TABLE "public"."reputation_events" TO "authenticated";



GRANT ALL ON TABLE "public"."reputation_rules" TO "service_role";
GRANT SELECT ON TABLE "public"."reputation_rules" TO "anon";
GRANT SELECT ON TABLE "public"."reputation_rules" TO "authenticated";



GRANT ALL ON TABLE "public"."rpc_rate_limit_counters" TO "anon";
GRANT ALL ON TABLE "public"."rpc_rate_limit_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."rpc_rate_limit_counters" TO "service_role";



GRANT ALL ON TABLE "public"."rpc_rate_limit_hits" TO "anon";
GRANT ALL ON TABLE "public"."rpc_rate_limit_hits" TO "authenticated";
GRANT ALL ON TABLE "public"."rpc_rate_limit_hits" TO "service_role";



GRANT ALL ON TABLE "public"."rpc_rate_limit_rules" TO "anon";
GRANT ALL ON TABLE "public"."rpc_rate_limit_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."rpc_rate_limit_rules" TO "service_role";



GRANT ALL ON TABLE "public"."season_leaderboard" TO "service_role";
GRANT SELECT ON TABLE "public"."season_leaderboard" TO "anon";
GRANT SELECT ON TABLE "public"."season_leaderboard" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_results" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."season_results" TO "authenticated";
GRANT ALL ON TABLE "public"."season_results" TO "service_role";



GRANT ALL ON TABLE "public"."site_audio_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."site_audio_settings" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_badges" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."user_badges" TO "service_role";



GRANT ALL ON TABLE "public"."user_music_preferences" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."user_music_preferences" TO "authenticated";



GRANT ALL ON TABLE "public"."v_days" TO "anon";
GRANT ALL ON TABLE "public"."v_days" TO "authenticated";
GRANT ALL ON TABLE "public"."v_days" TO "service_role";



GRANT ALL ON TABLE "public"."watermark_profiles" TO "anon";
GRANT ALL ON TABLE "public"."watermark_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."watermark_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_leaderboard" TO "service_role";
GRANT SELECT ON TABLE "public"."weekly_leaderboard" TO "anon";
GRANT SELECT ON TABLE "public"."weekly_leaderboard" TO "authenticated";



GRANT ALL ON TABLE "public"."wishlists" TO "anon";
GRANT ALL ON TABLE "public"."wishlists" TO "authenticated";
GRANT ALL ON TABLE "public"."wishlists" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































