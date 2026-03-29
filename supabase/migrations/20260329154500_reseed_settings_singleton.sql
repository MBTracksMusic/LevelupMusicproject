/*
  # Reseed public.settings singleton row if missing

  - Restores the maintenance settings singleton row in environments where the
    table exists but the seeded row was deleted.
  - Safe to run multiple times thanks to the singleton unique index.
*/

BEGIN;

INSERT INTO public.settings (maintenance_mode)
VALUES (false)
ON CONFLICT ((true)) DO NOTHING;

COMMIT;
