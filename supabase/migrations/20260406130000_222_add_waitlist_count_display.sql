/*
  # Add waitlist_count_display to settings

  Adds an admin-controlled integer to settings that drives the social proof
  counter on the public launch page.

  - Default 0 = hidden (the frontend hides the line when value is 0)
  - Admin sets it manually to match the real waitlist count (visible in /admin/launch)
  - No automatic sync on purpose: the admin chooses when and what to communicate
*/

BEGIN;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS waitlist_count_display integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.settings.waitlist_count_display IS
  'Number shown in the social proof line on the launch page (+X producteurs). 0 = hidden.';

COMMIT;
