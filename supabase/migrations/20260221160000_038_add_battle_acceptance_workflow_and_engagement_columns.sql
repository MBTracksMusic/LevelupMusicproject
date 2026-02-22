/*
  # Battles acceptance workflow + engagement columns (additive)

  Adds:
  - New statuses in battle_status enum.
  - Workflow/audit timestamps on battles.
  - Engagement counters on user_profiles.

  No destructive changes.
*/

BEGIN;

ALTER TYPE public.battle_status ADD VALUE IF NOT EXISTS 'pending_acceptance';
ALTER TYPE public.battle_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE public.battle_status ADD VALUE IF NOT EXISTS 'awaiting_admin';
ALTER TYPE public.battle_status ADD VALUE IF NOT EXISTS 'approved';

ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS response_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS submission_deadline timestamptz;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS battle_refusal_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battles_participated integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battles_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_score integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_user_profiles_battle_refusal_count
  ON public.user_profiles (battle_refusal_count DESC);

CREATE INDEX IF NOT EXISTS idx_user_profiles_engagement_score
  ON public.user_profiles (engagement_score DESC);

CREATE INDEX IF NOT EXISTS idx_battles_status_response_deadline
  ON public.battles (status, response_deadline)
  WHERE status = 'pending_acceptance';

CREATE INDEX IF NOT EXISTS idx_battles_status_awaiting_admin
  ON public.battles (status, created_at DESC)
  WHERE status = 'awaiting_admin';

COMMIT;
