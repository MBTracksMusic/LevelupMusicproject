/*
  # Battle pair limits — active uniqueness + post-battle cooldown

  Goals:
  - Prevent two producers (A, B) from having more than one "active" battle at the
    same time (statuses: pending_acceptance, awaiting_admin, active). Check is
    BIDIRECTIONAL — the unordered pair {A, B} is what matters.
  - Enforce a cooldown period (default 30 days = one season) after a terminated
    battle (completed, cancelled) between the same pair. Also bidirectional.

  Why Option B (rpc_create_battle wrapping checks + INSERT, RLS kept):
  - Atomicity: the quota / cap / pair-active / pair-cooldown checks AND the
    INSERT must run in the same transaction to avoid TOCTOU races where two
    concurrent requests both pass the checks before either commits.
  - UX: the policy-based path can only return a generic "row violates RLS"
    error; RAISE EXCEPTION inside an RPC lets us surface a precise error code
    (BATTLE_PAIR_ALREADY_ACTIVE / BATTLE_PAIR_COOLDOWN) plus the cooldown end
    date the front-end needs to render a useful message.
  - Consistency: the existing battle write-path RPCs (`rpc_vote_with_feedback`,
    `rpc_create_battle_comment`, `respond_to_battle`) already use this pattern.
  - Defense in depth: the "Active producers can create battles" RLS INSERT
    policy is intentionally kept — a future dev who bypasses the RPC still hits
    the per-row quota and active-cap checks (the pair checks are only enforced
    in the RPC; that is acceptable because the RLS policy continues to gate
    every direct INSERT against the existing quota and active-cap guarantees).

  Title Match preparation:
  - `battle_type` already exists (mig. 147) as enum('user', 'admin'). The RPC
    accepts a `p_battle_type` parameter that defaults to 'user' and selects the
    cooldown duration from it. The 'title' branch is wired but inert until the
    enum value is added in a future migration — see TODO marker in the function.

  Idempotency: this migration is safe to replay (DROP FUNCTION IF EXISTS, CREATE
  INDEX IF NOT EXISTS, CREATE OR REPLACE everywhere).
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Composite index for bidirectional pair lookups
-- ---------------------------------------------------------------------------
-- The pair-active and pair-cooldown checks both scan battles where
-- {producer1_id, producer2_id} = {A, B} (unordered). Indexing on
-- (LEAST(p1, p2), GREATEST(p1, p2)) lets a single B-tree serve both directions.
-- voting_ends_at is included so the cooldown lookup can fetch the most recent
-- terminated battle via index-only scan.
CREATE INDEX IF NOT EXISTS idx_battles_pair_lookup
  ON public.battles (
    LEAST(producer1_id, producer2_id),
    GREATEST(producer1_id, producer2_id),
    status,
    voting_ends_at DESC
  )
  WHERE producer2_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1) Helper: is there an active battle between (A, B) right now?
-- ---------------------------------------------------------------------------
-- "Active" = pending_acceptance, awaiting_admin, active.
-- 'voting' is intentionally excluded — historically voting battles are part of
-- the active set in `can_create_active_battle`, but for the PAIR check we only
-- block while the invitation/admin/contest phases are open. Adjust here if
-- product decides voting should also block. (Aligned with spec May 24 2026.)
DROP FUNCTION IF EXISTS public.check_battle_pair_active(uuid, uuid);
CREATE FUNCTION public.check_battle_pair_active(
  p_producer_a uuid,
  p_producer_b uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_jwt_role text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_exists   boolean := false;
BEGIN
  IF p_producer_a IS NULL OR p_producer_b IS NULL OR p_producer_a = p_producer_b THEN
    RETURN false;
  END IF;

  -- Only the actor themselves or service_role may inspect this — the result
  -- exposes whether a given pair has an active battle, which we treat as
  -- semi-sensitive matchmaking info.
  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND (v_actor = p_producer_a OR v_actor = p_producer_b))
  ) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.battles b
    WHERE LEAST(b.producer1_id, b.producer2_id) = LEAST(p_producer_a, p_producer_b)
      AND GREATEST(b.producer1_id, b.producer2_id) = GREATEST(p_producer_a, p_producer_b)
      AND b.status IN ('pending_acceptance', 'awaiting_admin', 'active')
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_battle_pair_active(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_battle_pair_active(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_battle_pair_active(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_battle_pair_active(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Helper: when does the cooldown end for the pair (A, B)?
-- ---------------------------------------------------------------------------
-- Returns the timestamp at which the pair becomes eligible again. NULL means
-- no cooldown applies (no terminated battle within the window).
--
-- "Terminated" = completed, cancelled. We use COALESCE(voting_ends_at,
-- updated_at) as the completion proxy: voting_ends_at is the natural end for
-- 'completed' battles, and falls back to updated_at for 'cancelled' battles
-- which don't carry a dedicated end timestamp. This matches the audit
-- agreement (no schema change on `battles`).
--
-- p_cooldown_days is a parameter (not a hardcoded constant) so the value can
-- be tuned without a code change, and so the 'title' branch can use a
-- different duration.
DROP FUNCTION IF EXISTS public.get_battle_pair_cooldown_end(uuid, uuid, int);
CREATE FUNCTION public.get_battle_pair_cooldown_end(
  p_producer_a   uuid,
  p_producer_b   uuid,
  p_cooldown_days int DEFAULT 30
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor             uuid := auth.uid();
  v_jwt_role          text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
  v_last_terminated_at timestamptz;
  v_cooldown_end       timestamptz;
BEGIN
  IF p_producer_a IS NULL OR p_producer_b IS NULL OR p_producer_a = p_producer_b THEN
    RETURN NULL;
  END IF;

  IF p_cooldown_days IS NULL OR p_cooldown_days <= 0 THEN
    RETURN NULL;
  END IF;

  IF NOT (
    v_jwt_role = 'service_role'
    OR (v_actor IS NOT NULL AND (v_actor = p_producer_a OR v_actor = p_producer_b))
  ) THEN
    RETURN NULL;
  END IF;

  SELECT MAX(COALESCE(b.voting_ends_at, b.updated_at))
  INTO v_last_terminated_at
  FROM public.battles b
  WHERE LEAST(b.producer1_id, b.producer2_id) = LEAST(p_producer_a, p_producer_b)
    AND GREATEST(b.producer1_id, b.producer2_id) = GREATEST(p_producer_a, p_producer_b)
    AND b.status IN ('completed', 'cancelled');

  IF v_last_terminated_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_cooldown_end := v_last_terminated_at + make_interval(days => p_cooldown_days);

  -- Cooldown already elapsed → no block.
  IF v_cooldown_end <= now() THEN
    RETURN NULL;
  END IF;

  RETURN v_cooldown_end;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_battle_pair_cooldown_end(uuid, uuid, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Main RPC: atomic battle creation with full guard chain
-- ---------------------------------------------------------------------------
-- Order of checks (cheapest → most expensive):
--   1. Auth + same-producer guard
--   2. Monthly quota                  (existing — can_create_battle)
--   3. Active concurrency cap (≤ 3)   (existing — can_create_active_battle)
--   4. Pair-active uniqueness         (NEW — this migration)
--   5. Pair cooldown                  (NEW — this migration)
--   6. Slot/product/profile sanity    (delegated to the INSERT — the RLS
--      policy still validates it as defense in depth)
--
-- On violation, RAISE EXCEPTION with a stable short code + SQLSTATE so the
-- front-end can map it to a localized message. Cooldown error embeds the ISO
-- timestamp of the cooldown end after a colon (e.g. 'BATTLE_PAIR_COOLDOWN:
-- 2026-06-23T11:42:00+00:00').
DROP FUNCTION IF EXISTS public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, int);
CREATE FUNCTION public.rpc_create_battle(
  p_title         text,
  p_slug          text,
  p_producer2_id  uuid,
  p_description   text DEFAULT NULL,
  p_product1_id   uuid DEFAULT NULL,
  p_product2_id   uuid DEFAULT NULL,
  p_battle_type   text DEFAULT 'user',
  p_cooldown_days int  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_title          text := NULLIF(trim(COALESCE(p_title, '')), '');
  v_slug           text := NULLIF(trim(COALESCE(p_slug, '')), '');
  v_description    text := NULLIF(trim(COALESCE(p_description, '')), '');
  v_cooldown_days  int;
  v_cooldown_end   timestamptz;
  v_new_battle_id  uuid;
BEGIN
  -- 1. Auth + identity guards
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_producer2_id IS NULL THEN
    RAISE EXCEPTION 'opponent_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_producer2_id = v_actor THEN
    RAISE EXCEPTION 'cannot_battle_self' USING ERRCODE = 'P0001';
  END IF;

  -- battle_type gating. Today only 'user' battles flow through this RPC;
  -- 'admin' campaigns insert directly from privileged contexts.
  -- TODO(title-match): when `ALTER TYPE public.battle_type ADD VALUE 'title'`
  -- ships, allow p_battle_type = 'title' here. The cooldown selection below
  -- already supports it.
  IF p_battle_type IS NULL OR p_battle_type NOT IN ('user') THEN
    RAISE EXCEPTION 'unsupported_battle_type' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve the cooldown duration based on battle_type. Constant lives here
  -- rather than in CREATE TABLE / settings to keep it auditable in one place.
  v_cooldown_days := COALESCE(
    p_cooldown_days,
    CASE
      WHEN p_battle_type = 'title' THEN 7   -- Title Match: shorter rematch window
      ELSE 30                                -- Default: one season
    END
  );

  -- 2. Monthly quota
  IF NOT public.can_create_battle(v_actor) THEN
    RAISE EXCEPTION 'BATTLE_QUOTA_REACHED' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Active concurrency cap (≤ 3)
  IF NOT public.can_create_active_battle(v_actor) THEN
    RAISE EXCEPTION 'BATTLE_ACTIVE_CAP_REACHED' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Pair-active uniqueness (NEW)
  IF public.check_battle_pair_active(v_actor, p_producer2_id) THEN
    RAISE EXCEPTION 'BATTLE_PAIR_ALREADY_ACTIVE' USING ERRCODE = 'P0002';
  END IF;

  -- 5. Pair cooldown (NEW)
  v_cooldown_end := public.get_battle_pair_cooldown_end(
    v_actor,
    p_producer2_id,
    v_cooldown_days
  );

  IF v_cooldown_end IS NOT NULL THEN
    -- SQLSTATE 'P0003' is the stable handle. Structured payload is in DETAIL
    -- as a JSON string the front-end parses (cleaner than regex on MESSAGE).
    --   - cooldown_end_at  : ISO-8601 UTC timestamp when the pair becomes
    --                        eligible again
    --   - cooldown_days    : cooldown window applied (30 by default, 7 for
    --                        'title' battles)
    --   - opponent_id      : the locked opponent, for client-side caching
    RAISE EXCEPTION 'BATTLE_PAIR_COOLDOWN'
      USING ERRCODE = 'P0003',
            DETAIL = jsonb_build_object(
              'cooldown_end_at', to_char(v_cooldown_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              'cooldown_days',   v_cooldown_days,
              'opponent_id',     p_producer2_id
            )::text;
  END IF;

  -- 6. INSERT — the RLS policy "Active producers can create battles" still
  -- runs here as defense in depth and validates products/profiles.
  INSERT INTO public.battles (
    title,
    slug,
    description,
    producer1_id,
    producer2_id,
    product1_id,
    product2_id,
    status,
    winner_id,
    votes_producer1,
    votes_producer2
    -- battle_type defaults to 'user' on the column itself.
  )
  VALUES (
    v_title,
    v_slug,
    v_description,
    v_actor,
    p_producer2_id,
    p_product1_id,
    p_product2_id,
    'pending_acceptance',
    NULL,
    0,
    0
  )
  RETURNING id INTO v_new_battle_id;

  RETURN v_new_battle_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_battle(text, text, uuid, text, uuid, uuid, text, int) TO service_role;

COMMIT;
