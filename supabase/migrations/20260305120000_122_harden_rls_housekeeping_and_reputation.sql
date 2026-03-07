/*
  # Harden housekeeping SECURITY DEFINER execution + reputation read policies

  Goals:
  - Restrict sensitive housekeeping RPC execution to service_role only.
  - Tighten direct table access for reputation data.
*/

BEGIN;

-- 1) Housekeeping SECURITY DEFINER functions: remove authenticated execute.
REVOKE EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_rpc_rate_limit_counters(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_admin_action_anomalies(integer) TO service_role;

-- 2) user_reputation: direct read limited to owner or admin.
DROP POLICY IF EXISTS "User reputation readable" ON public.user_reputation;
DROP POLICY IF EXISTS "Owner or admin can read user reputation" ON public.user_reputation;

CREATE POLICY "Owner or admin can read user reputation"
ON public.user_reputation
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
);

-- 3) reputation_rules: direct read limited to admin.
DROP POLICY IF EXISTS "Reputation rules readable" ON public.reputation_rules;
DROP POLICY IF EXISTS "Admins can read reputation rules" ON public.reputation_rules;

CREATE POLICY "Admins can read reputation rules"
ON public.reputation_rules
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

COMMIT;
