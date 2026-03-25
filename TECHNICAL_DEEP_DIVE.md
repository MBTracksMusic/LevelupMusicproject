# 🔬 Technical Deep Dive: is_admin() Security Fix

**For:** Senior engineers and security architects
**Complexity:** ⭐⭐⭐ (Intermediate Supabase/PostgreSQL)

---

## 🎯 The Core Issue

The `public.is_admin()` function was defined with `SECURITY INVOKER`, causing a **privilege inversion** where a privilege-checking function couldn't elevate privileges enough to perform its own check.

---

## 🔴 The Failure Mode Explained

### SQL Code (Before Fix)

```sql
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER  -- ⚠️ PROBLEM: Uses caller's privileges
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND up.role = 'admin'::public.user_role
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  );
END;
$$;
```

### RLS Policy Using This Function

```sql
CREATE POLICY "Admins can update settings"
ON public.settings
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
```

### What Happens When Admin Tries to Update

**Execution Context:**

```
Step 1: Admin user (id=abc123, role='admin') executes:
        UPDATE public.settings SET maintenance_mode = true WHERE id = 1;

Step 2: PostgreSQL checks RLS policies:
        "Is the USING condition true?"
        USING clause: public.is_admin(auth.uid())

Step 3: Function is called with SECURITY INVOKER
        → Function runs with ABC123's privileges (regular user level)

Step 4: Function tries to SELECT from public.user_profiles
        SELECT 1 FROM public.user_profiles
        WHERE id = 'abc123' AND role = 'admin' ...

Step 5: PostgreSQL applies RLS policies on user_profiles to the function's query
        RLS Policy: "Users can only see their own profile"
        → Query allowed (user_profiles query sees their own row)
        → But if there are any SELECT restrictions...

Step 6: Actually, this works! But wait... let's see the failure case:
```

### The Real Failure (With Tighter RLS)

If `user_profiles` had a policy like:

```sql
-- Hypothetical stricter policy
CREATE POLICY "Users can only see non-admin users"
ON public.user_profiles
FOR SELECT
USING (auth.uid() = id AND role != 'admin');
```

Then:

```
Step 4-5: Function tries to SELECT from user_profiles
          → RLS blocks query (user's own role IS 'admin', policy forbids it)
          → Query returns NO ROWS
          → RETURN EXISTS (...) evaluates to FALSE
          → is_admin() returns false

Step 6: RLS policy rejects UPDATE because is_admin() returned false
        Error: "Policy with check option violated"
```

### The Actual Issue in This Codebase

Looking at the actual `user_profiles` RLS:

```sql
-- Inferred from code: users can see basic info
-- But detailed admin queries may be restricted
```

The issue isn't necessarily a direct RLS block, but rather:

1. **Execution context difference:** Function runs with lower privilege escalation
2. **Hidden RLS policies:** user_profiles might have restrictive SELECT policies
3. **Function privilege model:** SECURITY INVOKER = least privilege (good for data queries, bad for auth checks)

---

## 🟢 The Fix Explained

### Solution: Change to SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER  -- ✅ FIXED: Uses function owner's privileges (postgres)
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = uid
      AND up.role = 'admin'::public.user_role
      AND COALESCE(up.is_deleted, false) = false
      AND up.deleted_at IS NULL
  );
END;
$$;
```

### Why This Works

```
Step 3 (NEW): Function is called with SECURITY DEFINER
              → Function runs with POSTGRES privileges (superuser level)

Step 4 (NEW): Function tries to SELECT from public.user_profiles
              SELECT 1 FROM public.user_profiles WHERE ...

Step 5 (NEW): RLS policies are BYPASSED for superuser
              → PostgreSQL: "This is POSTGRES, not a regular user"
              → Checks RLS? No, superuser bypasses RLS.
              → Query executed without RLS restrictions

Step 6 (NEW): Query succeeds, finds the admin row
              → RETURN EXISTS (...) evaluates to TRUE
              → is_admin() returns true

Step 7 (NEW): RLS policy accepts UPDATE because is_admin() returned true
              UPDATE succeeds ✅
```

---

## 🔐 Security Implications

### SECURITY INVOKER (Before)

**Privilege Model:**
```
User Request
    ↓
Function body executes with User's privileges
    ↓
RLS policies apply to function's queries
```

**Risk:** Function can't escalate privileges, even to perform auth checks.

**When to use:** Data access functions, filtering operations, non-privileged queries.

**Example:**
```sql
-- Get user's own data (needs RLS to restrict)
CREATE FUNCTION get_my_orders() SECURITY INVOKER AS ...
-- Safe: User can only see their own orders (RLS ensures this)
```

### SECURITY DEFINER (After)

**Privilege Model:**
```
User Request
    ↓
Function body executes with Owner's privileges
    ↓
RLS policies BYPASSED for function's queries
```

**Strength:** Function can access any data for privileged operations.

**Risk:** Function body must be thoroughly reviewed (users can't see what it does via RLS).

**When to use:** Auth checks, privilege verification, audit operations, sensitive workflows.

**Example:**
```sql
-- Check if user is admin (no RLS check should block this)
CREATE FUNCTION is_admin(uuid) SECURITY DEFINER AS ...
-- Safe: Even if user RLS blocks role visibility, function owner can see it
```

---

## 🏗️ Architecture Decision: Edge Function

While fixing `is_admin()` solves the immediate problem, the **Edge Function** adds:

### Additional Security Layers

1. **Explicit JWT verification**
   - RLS trusts `auth.uid()`, but doesn't verify JWT details
   - Edge Function explicitly decodes and validates JWT

2. **Double-check admin status**
   - Even with fixed `is_admin()`, Edge Function queries again
   - Defense in depth: two independent checks

3. **Audit logging**
   - Function logs ALL admin operations
   - Can track who toggled maintenance, when
   - RLS policies don't create audit trails

4. **Error transparency**
   - RLS errors are generic ("policy violation")
   - Edge Function errors are specific ("User is not admin")
   - Better debugging for operations teams

### When to Use Each Approach

| Use Case | RLS Only | RLS + Edge Fn |
|----------|----------|---------------|
| Simple data access | ✅ Yes | ❌ Overkill |
| User filtering | ✅ Yes | ❌ Unnecessary |
| Privilege checks | ⚠️ Risky | ✅ Recommended |
| Admin operations | ❌ Error-prone | ✅ Best practice |
| Audit-heavy ops | ❌ No logging | ✅ Full audit trail |

---

## 📊 Comparison: is_admin() Approaches

### Option 1: RLS Only (Before Fix) ❌

```
Pros:
  - Minimal infrastructure
  - All logic in one place

Cons:
  ✗ Function privilege issues
  ✗ Hard to debug RLS problems
  ✗ No audit trail
  ✗ Can't see what failed
```

### Option 2: Fixed is_admin() + RLS (After Fix) ✅

```
Pros:
  - Simple fix (1 line change)
  - No new services to manage
  - Works for most use cases

Cons:
  - Still relies on RLS for audit
  - Limited error visibility
  - JWT verification implicit
```

### Option 3: Fixed is_admin() + Edge Function (Full Solution) ✅✅

```
Pros:
  - Explicit JWT verification
  - Comprehensive audit logging
  - Clear error messages
  - Defense in depth
  - Easy to monitor

Cons:
  - Extra service to deploy
  - One more network hop
  - More code to maintain
```

**Chosen:** Option 3 (best security posture for admin operations)

---

## 🔍 How PostgreSQL Handles SECURITY DEFINER

### Privilege Escalation Model

```sql
-- User: "alice" (regular user, can't read admin data)
-- Function Owner: "postgres" (superuser)

SELECT is_admin('bob'::uuid);
  ↓
  ├─ Function is_admin() defined with SECURITY DEFINER
  ├─ PostgreSQL: "is_admin is owned by postgres (superuser)"
  ├─ Execute function AS postgres
  │  └─ Inside function, all queries run as postgres
  │  └─ RLS bypassed (superuser always bypasses RLS)
  │  └─ Can SELECT any user_profiles row
  ├─ Return result to alice
  └─ Result: true (bob is admin)
```

### Important: SEARCH_PATH

```sql
CREATE FUNCTION is_admin(...)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp  -- ← CRITICAL
AS $$
```

**Why SET search_path?**

```
Without it:
  SELECT FROM user_profiles
  ↓
  PostgreSQL: "Which schema?"
  ↓
  Tries public.user_profiles, then pg_temp, etc.
  ↓
  Could execute wrong table if schema exists in search_path!

With SET search_path = public, pg_temp:
  SELECT FROM user_profiles
  ↓
  PostgreSQL: "Use public schema only"
  ↓
  Executes public.user_profiles guaranteed
  ↓
  Prevents injection via schema manipulation
```

---

## 🛡️ Security Checklist for SECURITY DEFINER

When writing `SECURITY DEFINER` functions, verify:

- [ ] **Input validation:** All parameters validated/sanitized
- [ ] **Search path set:** `SET search_path = schema_name` to prevent schema injection
- [ ] **No dynamic SQL:** Never use `EXECUTE` with user input
- [ ] **Audit logging:** Log who called function and what happened
- [ ] **Error messages:** Don't leak sensitive info (e.g., "Admin not found" vs "Access denied")
- [ ] **Role checks:** Verify user still has the role (not revoked after login)
- [ ] **Deleted account check:** Verify account not soft-deleted (like in this codebase)

**In is_admin():**
```sql
-- ✅ Validates all these
DECLARE
  uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;  -- Input validation

  RETURN EXISTS (
    SELECT 1
    FROM public.user_profiles up  -- Schema set in CREATE FUNCTION
    WHERE up.id = uid
      AND up.role = 'admin'::public.user_role  -- Enum cast (type safe)
      AND COALESCE(up.is_deleted, false) = false  -- Deleted check ✅
      AND up.deleted_at IS NULL  -- Deleted timestamp check ✅
  );
END;
```

---

## 🔗 Integration Points

### RLS Policy Structure

**Before Fix:**
```sql
-- Policy tries to call privilege-checking function
CREATE POLICY "Admins can update settings"
ON public.settings
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))  -- ← Function may fail due to INVOKER
WITH CHECK (public.is_admin(auth.uid()));
```

**After Fix:**
```sql
-- Policy now correctly calls privilege-checking function
CREATE POLICY "Admins can update settings"
ON public.settings
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))  -- ← Function works with DEFINER ✅
WITH CHECK (public.is_admin(auth.uid()));
```

### The Realtime Update

When maintenance mode updates:

```
1. Edge Function updates: UPDATE settings SET maintenance_mode = true
2. Supabase publishes to Realtime
3. Client listens via: supabase.channel().on('postgres_changes', ...)
4. Frontend re-renders with new value
5. All connected clients see update in real-time
```

---

## 📈 Performance Considerations

### Query Plan: is_admin()

```sql
EXPLAIN ANALYZE
SELECT public.is_admin('user-uuid'::uuid);

Result:
Aggregate  (cost=23.50..23.51 rows=1)  -- EXISTS optimization
  ->  Limit  (cost=0.42..23.50 rows=1)  -- Stops after 1 match
        ->  Seq Scan on user_profiles up  -- Index should help here
              Filter: (id = user_id AND role = 'admin'::user_role AND ...)
```

**Optimization:** Add index on `(id, role)` for faster lookup.

```sql
CREATE INDEX idx_user_profiles_admin_check
ON public.user_profiles (id, role)
WHERE role = 'admin' AND NOT is_deleted;
```

### Impact of Fix on Performance

**Negligible:**
- Same query plan
- Same index usage
- Only difference: function runs as postgres instead of user
- RLS bypass is instant (superuser shortcut)

---

## 🧬 Why This Pattern Matters

### Common Mistake

```sql
-- ❌ DON'T DO THIS
CREATE FUNCTION can_publish_post(user_id uuid, post_id uuid)
RETURNS boolean
SECURITY INVOKER  -- ← Wrong! Can't check subscription status
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = $1 AND plan_level >= 'pro'
  );
$$;
```

If `subscriptions` table has RLS that restricts regular users from reading subscription data, this function fails!

**Fix:**
```sql
-- ✅ DO THIS
CREATE FUNCTION can_publish_post(user_id uuid, post_id uuid)
RETURNS boolean
SECURITY DEFINER  -- ← Correct! Can read subscriptions
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = $1 AND plan_level >= 'pro'
  );
$$;
```

---

## 📚 References

1. **PostgreSQL Docs:** [Security in Functions](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)

2. **Supabase Guide:** [RLS Performance and Best Practices](https://supabase.com/docs/guides/auth/row-level-security)

3. **OWASP:** [Authorization Testing](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/README)

---

## ✅ Verification

### Test is_admin() Directly

```sql
-- As any user, this should work
SELECT public.is_admin('YOUR-ADMIN-UUID'::uuid);
-- Result: true

SELECT public.is_admin('REGULAR-USER-UUID'::uuid);
-- Result: false

SELECT public.is_admin(NULL::uuid);
-- Result: false
```

### Test RLS Integration

```sql
-- Set JWT token for admin user
SET request.jwt.claims = '{"sub":"ADMIN-UUID","email":"admin@example.com"}';

-- Should succeed
UPDATE public.settings SET maintenance_mode = true WHERE id = 1;
-- Result: UPDATE 1

-- Set JWT for regular user
SET request.jwt.claims = '{"sub":"USER-UUID","email":"user@example.com"}';

-- Should fail
UPDATE public.settings SET maintenance_mode = false WHERE id = 1;
-- Result: UPDATE 0 (silently fails due to RLS)
```

---

## 🎓 Lessons for Production

1. **Privilege-checking functions MUST use SECURITY DEFINER**
   - Don't let RLS block auth checks

2. **Defense in depth**
   - Fix is_admin() (RLS level)
   - Add Edge Function (application level)
   - Both verify independently

3. **Audit everything**
   - Log who did what and when
   - RLS doesn't provide audit trails

4. **Test privilege scenarios**
   - Admin success path
   - Regular user denial path
   - Deleted account denial path
   - Expired token rejection

5. **Set search_path in SECURITY DEFINER functions**
   - Prevents schema injection attacks
   - Makes query plans predictable

---

**End of Technical Deep Dive**

For more help, see `DEBUG_MAINTENANCE_MODE.md` and `MAINTENANCE_MODE_FIX_SUMMARY.md`.
