BEGIN;

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS system_settings_touch_updated_at ON public.system_settings;
CREATE TRIGGER system_settings_touch_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read system settings" ON public.system_settings;
CREATE POLICY "Anyone can read system settings"
ON public.system_settings
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can insert system settings" ON public.system_settings;
CREATE POLICY "Admins can insert system settings"
ON public.system_settings
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update system settings" ON public.system_settings;
CREATE POLICY "Admins can update system settings"
ON public.system_settings
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

REVOKE ALL ON TABLE public.system_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.system_settings FROM anon;
GRANT SELECT ON TABLE public.system_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.system_settings TO authenticated;
GRANT ALL ON TABLE public.system_settings TO service_role;

INSERT INTO public.system_settings (key, value)
VALUES ('ai_battle_suggestions', '{"enabled": true, "mode": "hybrid"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.battle_suggestions
  ADD COLUMN IF NOT EXISTS ai_score numeric(6,4),
  ADD COLUMN IF NOT EXISTS elo_score numeric(6,4),
  ADD COLUMN IF NOT EXISTS final_score numeric(6,4);

ALTER TABLE public.battle_suggestions
  DROP CONSTRAINT IF EXISTS battle_suggestions_suggestion_source_check;

ALTER TABLE public.battle_suggestions
  ADD CONSTRAINT battle_suggestions_suggestion_source_check
  CHECK (suggestion_source IN ('ai', 'hybrid', 'sql', 'fallback_sql'));

COMMIT;
