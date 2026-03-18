/*
  # Deduplicate completed purchases before creating partial unique index

  Context
  -------
  Migration 187 attempts to create:

    CREATE UNIQUE INDEX idx_purchases_unique_completed_user_product
      ON public.purchases(user_id, product_id)
      WHERE status = 'completed';

  This fails if the table already contains duplicate (user_id, product_id) rows
  with status = 'completed' — caused by parallel Stripe webhook deliveries that
  both passed the Stripe-ID dedup check before either committed.

  Strategy
  --------
  1. For every duplicate group, keep the MOST RECENT completed row
     (ORDER BY created_at DESC, id DESC as tiebreaker).
     Older copies are "superseded" duplicates.

  2. Re-point entitlements.purchase_id that reference superseded rows to the
     canonical row, so entitlement integrity is preserved before status changes.

  3. Mark superseded rows as status = 'failed' and record the reason in metadata.
     We do NOT delete them:
       - download_logs.purchase_id (ON DELETE CASCADE) would lose audit rows.
       - Keeping them lets us reconstruct exactly what happened.

  4. Create the partial unique index — now safe since no completed duplicates remain.

  Idempotency
  -----------
  - Steps 1–3 only touch rows WHERE status = 'completed' AND rn > 1 at runtime.
     If no duplicates exist (already cleaned or never existed) all CTEs match zero
     rows and the UPDATEs are no-ops.
  - CREATE UNIQUE INDEX IF NOT EXISTS is safe to re-run.
  - The whole script is wrapped in a single transaction: all-or-nothing.
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Re-point entitlements to the canonical purchase
-- ─────────────────────────────────────────────────────────────────────────────
-- Must run BEFORE Step 2 so that entitlements still reference rows whose status
-- is still 'completed' (making the ranked CTE well-defined).

WITH ranked AS (
  SELECT
    id,
    user_id,
    product_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, product_id
      ORDER BY created_at DESC, id DESC   -- newest = canonical
    ) AS rn
  FROM public.purchases
  WHERE status = 'completed'
),
canonical AS (
  SELECT id AS canonical_id, user_id, product_id
  FROM ranked
  WHERE rn = 1
),
superseded AS (
  SELECT id AS superseded_id, user_id, product_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.entitlements AS e
   SET purchase_id = c.canonical_id
  FROM superseded s
  JOIN canonical c
    ON c.user_id    = s.user_id
   AND c.product_id = s.product_id
 WHERE e.purchase_id = s.superseded_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Mark superseded duplicates as 'failed' and stamp metadata
-- ─────────────────────────────────────────────────────────────────────────────
-- We use 'failed' because:
--   • It is an existing enum value (no DDL required).
--   • It removes the row from WHERE status = 'completed' filter.
--   • The metadata stamp distinguishes these from genuine payment failures.
-- We do NOT use 'refunded' (implies a customer-facing refund action).

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, product_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.purchases
  WHERE status = 'completed'
),
superseded AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.purchases AS p
   SET status   = 'failed',
       metadata = COALESCE(p.metadata, '{}'::jsonb) || jsonb_build_object(
         '_dedup', jsonb_build_object(
           'reason',          'superseded_duplicate_completed_purchase',
           'deduplicated_at', now()::text,
           'migration',       '190_deduplicate_completed_purchases'
         )
       )
  FROM superseded
 WHERE p.id = superseded.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Create the partial unique index
-- ─────────────────────────────────────────────────────────────────────────────
-- IF NOT EXISTS makes this safe on databases where migration 187 already
-- succeeded (e.g. staging with no historical duplicates).

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_unique_completed_user_product
  ON public.purchases(user_id, product_id)
  WHERE status = 'completed';

COMMIT;
