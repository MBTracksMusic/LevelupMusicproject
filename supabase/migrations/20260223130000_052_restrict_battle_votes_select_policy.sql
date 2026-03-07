/*
  # Restrict battle_votes read access (P0 confidentiality)

  Objective:
  - Stop exposing voter identities publicly from public.battle_votes.
  - Keep admin visibility for moderation/audit.
  - Keep "current user vote" UX working for authenticated users.
*/

BEGIN;

DROP POLICY IF EXISTS "Anyone can view votes" ON public.battle_votes;
DROP POLICY IF EXISTS "Admins can read all battle votes" ON public.battle_votes;
DROP POLICY IF EXISTS "Users can read own battle votes" ON public.battle_votes;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'battle_votes'
    AND policyname = 'Admins can read all battle votes'
  ) THEN
    CREATE POLICY "Admins can read all battle votes"
  ON public.battle_votes
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'battle_votes'
    AND policyname = 'Users can read own battle votes'
  ) THEN
    DROP POLICY IF EXISTS "Users can read own battle votes" ON public.battle_votes;
    CREATE POLICY "Users can read own battle votes"
  ON public.battle_votes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
  END IF;
END $$;

COMMIT;
