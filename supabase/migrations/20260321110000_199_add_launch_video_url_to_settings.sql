/*
  # Add optional launch video URL to public.settings

  - Stores an optional video URL for the maintenance launch screen.
  - NULL or empty values keep the screen unchanged.
*/

BEGIN;

ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS launch_video_url text;

COMMENT ON COLUMN public.settings.launch_video_url IS
  'Optional launch video URL displayed on the maintenance launch screen.';

COMMIT;
