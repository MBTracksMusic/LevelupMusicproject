/*
  # Prevent dual active subscriptions and expose unified subscription type

  This migration enforces a single active subscription kind per user:
  - buyer/user subscription OR producer subscription
  - never both active at the same time

  It also exposes a small owner-read RPC for frontend status checks.
*/

CREATE OR REPLACE FUNCTION public.get_user_subscription_type()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_user_subscription boolean := false;
  v_has_producer_subscription boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    WHERE us.user_id = v_user_id
      AND us.subscription_status IN ('active', 'trialing')
      AND (us.current_period_end IS NULL OR us.current_period_end > now())
  )
  INTO v_has_user_subscription;

  SELECT EXISTS (
    SELECT 1
    FROM public.producer_subscriptions ps
    WHERE ps.user_id = v_user_id
      AND ps.subscription_status IN ('active', 'trialing')
      AND ps.current_period_end > now()
  )
  INTO v_has_producer_subscription;

  IF v_has_producer_subscription THEN
    RETURN 'producer';
  END IF;

  IF v_has_user_subscription THEN
    RETURN 'user';
  END IF;

  RETURN 'none';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_subscription_type() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_subscription_type() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_type() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_type() TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_dual_active_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflicting_producer_subscription boolean := false;
BEGIN
  IF NEW.subscription_status IN ('active', 'trialing')
     AND (NEW.current_period_end IS NULL OR NEW.current_period_end > now()) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.producer_subscriptions ps
      WHERE ps.user_id = NEW.user_id
        AND ps.subscription_status IN ('active', 'trialing')
        AND ps.current_period_end > now()
    )
    INTO v_conflicting_producer_subscription;

    IF v_conflicting_producer_subscription THEN
      RAISE EXCEPTION 'subscription_conflict_producer_active'
        USING ERRCODE = 'check_violation',
              DETAIL = 'A producer subscription is already active for this user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_dual_active_producer_subscription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflicting_user_subscription boolean := false;
BEGIN
  IF NEW.subscription_status IN ('active', 'trialing')
     AND NEW.current_period_end > now() THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_subscriptions us
      WHERE us.user_id = NEW.user_id
        AND us.subscription_status IN ('active', 'trialing')
        AND (us.current_period_end IS NULL OR us.current_period_end > now())
    )
    INTO v_conflicting_user_subscription;

    IF v_conflicting_user_subscription THEN
      RAISE EXCEPTION 'subscription_conflict_user_active'
        USING ERRCODE = 'check_violation',
              DETAIL = 'A user subscription is already active for this user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_subscriptions_prevent_dual_active ON public.user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_prevent_dual_active
  BEFORE INSERT OR UPDATE ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_dual_active_user_subscription();

DROP TRIGGER IF EXISTS trg_producer_subscriptions_prevent_dual_active ON public.producer_subscriptions;
CREATE TRIGGER trg_producer_subscriptions_prevent_dual_active
  BEFORE INSERT OR UPDATE ON public.producer_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_dual_active_producer_subscription();

COMMENT ON FUNCTION public.get_user_subscription_type() IS
  'Returns the currently active subscription kind for the authenticated user: none, user, or producer.';
