/*
  # Battle product occupied locks

  Phase 1 integrity fix:
  - A product can appear in only one occupied battle at a time.
  - Occupied statuses: pending_acceptance, awaiting_admin, active, voting.
  - The lock is cross-slot: product1_id and product2_id share the same unique
    product_id namespace.

  Why a lock table:
  - A partial unique index on product1_id and another on product2_id would still
    allow the same product to be product1_id in one battle and product2_id in
    another.
  - PostgreSQL cannot create a single normal unique index that emits two indexed
    keys from one battles row, so the trigger-maintained lock table materializes
    one row per occupied product.
*/

BEGIN;

-- Block concurrent battle writes while the lock table is backfilled and the
-- trigger is installed, so no occupied product can slip between the snapshot
-- and the enforcement mechanism.
LOCK TABLE public.battles IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.battle_product_locks (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  battle_id uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot IN (1, 2)),
  status public.battle_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_product_locks_unique_battle_slot UNIQUE (battle_id, slot)
);

ALTER TABLE public.battle_product_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.battle_product_locks FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_product_locks FROM anon;
REVOKE ALL ON TABLE public.battle_product_locks FROM authenticated;
GRANT ALL ON TABLE public.battle_product_locks TO service_role;

CREATE INDEX IF NOT EXISTS idx_battle_product_locks_battle_id
  ON public.battle_product_locks (battle_id);

-- Fail closed if production already contains an occupied product conflict.
-- This duplicates the manual precheck query so the migration cannot silently
-- install a partial lock state.
DO $$
DECLARE
  v_conflict_count integer;
BEGIN
  WITH occupied_slots AS (
    SELECT b.id AS battle_id, b.product1_id AS product_id
    FROM public.battles b
    WHERE b.status::text IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting')
      AND b.product1_id IS NOT NULL

    UNION ALL

    SELECT b.id AS battle_id, b.product2_id AS product_id
    FROM public.battles b
    WHERE b.status::text IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting')
      AND b.product2_id IS NOT NULL
  ),
  conflicts AS (
    SELECT product_id
    FROM occupied_slots
    GROUP BY product_id
    HAVING count(*) > 1
  )
  SELECT count(*) INTO v_conflict_count
  FROM conflicts;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BATTLE_PRODUCT_LOCKS_PRECHECK_FAILED: % conflicting product(s)', v_conflict_count
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_battle_product_locks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflict public.battle_product_locks%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.battle_product_locks
    WHERE battle_id = OLD.id;

    RETURN OLD;
  END IF;

  DELETE FROM public.battle_product_locks
  WHERE battle_id = NEW.id;

  IF NEW.status::text NOT IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting') THEN
    RETURN NEW;
  END IF;

  IF NEW.product1_id IS NOT NULL
     AND NEW.product2_id IS NOT NULL
     AND NEW.product1_id = NEW.product2_id THEN
    RAISE EXCEPTION 'BATTLE_PRODUCT_DUPLICATE_IN_BATTLE'
      USING ERRCODE = '23505',
            DETAIL = jsonb_build_object(
              'battle_id', NEW.id,
              'product_id', NEW.product1_id,
              'status', NEW.status::text
            )::text;
  END IF;

  BEGIN
    INSERT INTO public.battle_product_locks (
      product_id,
      battle_id,
      slot,
      status
    )
    SELECT slot_products.product_id, NEW.id, slot_products.slot, NEW.status
    FROM (
      VALUES
        (NEW.product1_id, 1::smallint),
        (NEW.product2_id, 2::smallint)
    ) AS slot_products(product_id, slot)
    WHERE slot_products.product_id IS NOT NULL;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_conflict
      FROM public.battle_product_locks l
      WHERE l.product_id IN (NEW.product1_id, NEW.product2_id)
        AND l.battle_id <> NEW.id
      LIMIT 1;

      RAISE EXCEPTION 'BATTLE_PRODUCT_ALREADY_OCCUPIED'
        USING ERRCODE = '23505',
              DETAIL = jsonb_build_object(
                'attempted_battle_id', NEW.id,
                'attempted_status', NEW.status::text,
                'conflicting_product_id', v_conflict.product_id,
                'conflicting_battle_id', v_conflict.battle_id,
                'conflicting_slot', v_conflict.slot,
                'conflicting_status', v_conflict.status::text
              )::text;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_battle_product_locks() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_battle_product_locks() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_battle_product_locks() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_battle_product_locks() TO service_role;

DROP TRIGGER IF EXISTS trg_sync_battle_product_locks_write ON public.battles;
CREATE TRIGGER trg_sync_battle_product_locks_write
  AFTER INSERT OR UPDATE OF product1_id, product2_id, status
  ON public.battles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_battle_product_locks();

DROP TRIGGER IF EXISTS trg_sync_battle_product_locks_delete ON public.battles;
CREATE TRIGGER trg_sync_battle_product_locks_delete
  AFTER DELETE
  ON public.battles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_battle_product_locks();

-- Idempotent rebuild of the materialized locks from the current source table.
DELETE FROM public.battle_product_locks;

INSERT INTO public.battle_product_locks (
  product_id,
  battle_id,
  slot,
  status
)
SELECT slots.product_id, slots.battle_id, slots.slot, slots.status
FROM (
  SELECT b.product1_id AS product_id, b.id AS battle_id, 1::smallint AS slot, b.status
  FROM public.battles b
  WHERE b.status::text IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting')
    AND b.product1_id IS NOT NULL

  UNION ALL

  SELECT b.product2_id AS product_id, b.id AS battle_id, 2::smallint AS slot, b.status
  FROM public.battles b
  WHERE b.status::text IN ('pending_acceptance', 'awaiting_admin', 'active', 'voting')
    AND b.product2_id IS NOT NULL
) AS slots;

COMMIT;
