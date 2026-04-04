-- Add show_user_premium_credits flag to the settings singleton.
-- Controls whether the credit balance badge is visible in the header for users.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS show_user_premium_credits boolean NOT NULL DEFAULT true;
