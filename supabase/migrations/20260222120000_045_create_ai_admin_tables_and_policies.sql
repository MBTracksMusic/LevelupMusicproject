/*
  # AI Admin core tables + RLS + admin notifications

  Additive migration:
  - ai_admin_actions
  - ai_training_feedback
  - admin_notifications
  - strict RLS policies (admin only for AI tables)
  - notification trigger when AI action is proposed
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL CHECK (action_type IN (
    'battle_validate',
    'battle_cancel',
    'battle_finalize',
    'comment_moderation',
    'match_recommendation'
  )),
  entity_type text NOT NULL CHECK (entity_type IN ('battle', 'comment', 'other')),
  entity_id uuid NOT NULL,
  ai_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric(5,4) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reason text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'executed', 'failed', 'overridden')),
  human_override boolean NOT NULL DEFAULT false,
  reversible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  executed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  error text
);

CREATE TABLE IF NOT EXISTS public.ai_training_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.ai_admin_actions(id) ON DELETE RESTRICT,
  ai_prediction jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_admin_actions_entity
  ON public.ai_admin_actions (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_ai_admin_actions_action_status_created
  ON public.ai_admin_actions (action_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_training_feedback_action_created
  ON public.ai_training_feedback (action_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_user_read_created
  ON public.admin_notifications (user_id, is_read, created_at DESC);

ALTER TABLE public.ai_admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_training_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read ai admin actions" ON public.ai_admin_actions;
DROP POLICY IF EXISTS "Admins can insert ai admin actions" ON public.ai_admin_actions;
DROP POLICY IF EXISTS "Admins can update ai admin actions" ON public.ai_admin_actions;

CREATE POLICY "Admins can read ai admin actions"
  ON public.ai_admin_actions
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert ai admin actions"
  ON public.ai_admin_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update ai admin actions"
  ON public.ai_admin_actions
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can read ai training feedback" ON public.ai_training_feedback;
DROP POLICY IF EXISTS "Admins can insert ai training feedback" ON public.ai_training_feedback;
DROP POLICY IF EXISTS "Admins can update ai training feedback" ON public.ai_training_feedback;

CREATE POLICY "Admins can read ai training feedback"
  ON public.ai_training_feedback
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert ai training feedback"
  ON public.ai_training_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update ai training feedback"
  ON public.ai_training_feedback
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can read own notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Admins can update own notifications" ON public.admin_notifications;

CREATE POLICY "Admins can read own notifications"
  ON public.admin_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can update own notifications"
  ON public.admin_notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND public.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.enqueue_admin_notifications_for_ai_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_enqueue_admin_notifications_for_ai_action ON public.ai_admin_actions;

CREATE TRIGGER trg_enqueue_admin_notifications_for_ai_action
  AFTER INSERT ON public.ai_admin_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_admin_notifications_for_ai_action();

COMMIT;
