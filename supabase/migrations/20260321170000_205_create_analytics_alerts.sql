/*
  # Create analytics alerts table

  - Stores business analytics alerts for the admin dashboard
  - Admins can read, insert, and resolve alerts
  - Prevents exposing business monitoring data to non-admin users
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.analytics_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('warning', 'critical')),
  message text NOT NULL,
  metric text NOT NULL,
  value numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_created_at
  ON public.analytics_alerts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_active_metric
  ON public.analytics_alerts (metric, type, resolved, created_at DESC);

ALTER TABLE public.analytics_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read analytics alerts" ON public.analytics_alerts;
CREATE POLICY "Admins can read analytics alerts"
ON public.analytics_alerts
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can insert analytics alerts" ON public.analytics_alerts;
CREATE POLICY "Admins can insert analytics alerts"
ON public.analytics_alerts
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update analytics alerts" ON public.analytics_alerts;
CREATE POLICY "Admins can update analytics alerts"
ON public.analytics_alerts
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

COMMIT;
