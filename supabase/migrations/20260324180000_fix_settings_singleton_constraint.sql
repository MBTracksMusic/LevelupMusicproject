/*
  Fix: Singleton pattern is already enforced

  PROBLEM: Previous migration attempted CHECK(id = v_singleton_id)
           Variables cannot be used in CHECK constraints (must be deterministic at compile-time)
           Error: "column v_singleton_id does not exist"

  SOLUTION: The singleton pattern is ALREADY correctly enforced by the unique index
           created in migration 20260321090000:

           CREATE UNIQUE INDEX settings_singleton_idx ON public.settings ((true));

           This index forces exactly 1 row (2nd INSERT fails with UNIQUE VIOLATION).
           No additional constraint is needed or beneficial.
*/

BEGIN;

-- The singleton constraint on settings table is already correctly implemented
-- via unique index on constant (true) from migration 20260321090000.
-- No action needed here - this migration documents that and prevents re-attempts.

COMMIT;
