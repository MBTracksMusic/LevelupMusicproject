/*
  # Harden SELECT policies on public.app_settings

  Goal:
  - Replace broad public read access with an allowlist for safe keys.
  - Preserve full app_settings read access for admins.
*/

DROP POLICY IF EXISTS "Anyone can read app settings"
ON public.app_settings;

CREATE POLICY "Public can read safe app settings"
ON public.app_settings
FOR SELECT
TO anon, authenticated
USING (
  key = ANY (ARRAY['social_links'])
);

CREATE POLICY "Admins can read all app settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (
  public.is_admin(auth.uid())
);
