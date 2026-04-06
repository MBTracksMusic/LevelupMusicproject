/*
  # Fix waitlist & access_whitelist grants for admin operations

  Problems fixed:
  1. public.waitlist — authenticated role only had SELECT (from migration 221).
     Admins need INSERT, UPDATE, DELETE too (accept/reject actions in admin panel).
  2. public.access_whitelist — no explicit grants for authenticated at all.
     Admins need full CRUD (add email, toggle is_active).
  3. Re-ensure RLS policies exist and are correct (idempotent).
*/

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. waitlist: full CRUD grants for authenticated (RLS still filters rows)
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.waitlist TO authenticated;

-- Re-ensure admin policy (idempotent — safe to re-run)
DROP POLICY IF EXISTS "Admins manage waitlist" ON public.waitlist;
CREATE POLICY "Admins manage waitlist"
ON public.waitlist
FOR ALL
TO authenticated
USING  (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Re-ensure user self-read policy (idempotent)
DROP POLICY IF EXISTS "User reads own waitlist entry" ON public.waitlist;
CREATE POLICY "User reads own waitlist entry"
ON public.waitlist
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR lower(email) = (
    SELECT lower(au.email)
    FROM auth.users au
    WHERE au.id = auth.uid()
    LIMIT 1
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. access_whitelist: full CRUD grants for authenticated (RLS still filters)
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_whitelist TO authenticated;

-- Re-ensure admin policy (idempotent)
DROP POLICY IF EXISTS "Admins manage access_whitelist" ON public.access_whitelist;
CREATE POLICY "Admins manage access_whitelist"
ON public.access_whitelist
FOR ALL
TO authenticated
USING  (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

COMMIT;
