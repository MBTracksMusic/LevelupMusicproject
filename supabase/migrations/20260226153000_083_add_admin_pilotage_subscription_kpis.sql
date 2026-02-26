/*
  # Add subscription acquisition/churn KPIs to admin pilotage metrics

  Extends `public.get_admin_pilotage_metrics()` JSON with:
  - new_subscriptions_30d
  - churned_subscriptions_30d
  - net_subscriptions_growth_30d

  Source of truth for these KPIs is `public.stripe_events`.
*/

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_admin(uuid)') IS NULL THEN
    CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $func$
    DECLARE
      v_uid uuid := COALESCE(p_user_id, auth.uid());
    BEGIN
      IF v_uid IS NULL THEN
        RETURN false;
      END IF;

      RETURN EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = v_uid
          AND up.role = 'admin'
      );
    END;
    $func$;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_admin_pilotage_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_pilotage_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_pilotage_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_pilotage_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_pilotage_metrics() TO service_role;

COMMIT;
