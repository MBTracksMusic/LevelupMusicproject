# 🔧 Maintenance Mode Toggle - Debug Guide

**Last Updated:** 2026-03-24
**Status:** ✅ FIXED

---

## 🎯 Problem Summary

**Error:** "Impossible de mettre à jour le mode maintenance"
**Affected Flow:** Admin Dashboard → Toggle Maintenance Mode Button → RLS Rejection

---

## 🔴 Root Cause

The `is_admin()` function was defined with **`SECURITY INVOKER`** instead of **`SECURITY DEFINER`**.

### What This Means

| Setting | Privilege Level | User's RLS Applied? | Issue |
|---------|-----------------|-------------------|-------|
| SECURITY INVOKER | User's privileges | ✅ YES | **BUG**: Can't read own role if RLS blocks it |
| SECURITY DEFINER | Function owner (postgres) | ❌ NO | ✅ Can always read user_profiles |

### The Failure Chain

```
1. Admin clicks "Toggle Maintenance"
   ↓
2. Frontend calls: supabase.from('settings').update({ maintenance_mode: true })
   ↓
3. RLS policy checks: public.is_admin(auth.uid())
   ↓
4. is_admin() tries to SELECT from user_profiles with INVOKER privileges
   ↓
5. User's RLS policies block the query (typical policy: "users can only see themselves")
   ↓
6. is_admin() returns NULL/false (function query failed)
   ↓
7. RLS policy REJECTS UPDATE
   ↓
8. Frontend catches error: "Impossible de mettre à jour le mode maintenance"
```

---

## ✅ Solution Overview

### 1. Fix is_admin() Function ✅
**File:** `supabase/migrations/20260324170000_fix_is_admin_security_definer.sql`

Changed from:
```sql
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER  -- ❌ WRONG: Uses user's privileges
SET search_path = public, pg_temp
AS $$
```

Changed to:
```sql
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER  -- ✅ FIXED: Uses function owner privileges
SET search_path = public, pg_temp
AS $$
```

**Why this works:** Now the function runs with postgres's privileges, bypassing user RLS policies on user_profiles. Can always read role column.

---

### 2. Add Safety Constraint ✅
**File:** `supabase/migrations/20260324171000_add_settings_singleton_constraint.sql`

```sql
ALTER TABLE public.settings
ADD CONSTRAINT settings_singleton_check
CHECK (id = v_singleton_id);
```

**Why:** Prevents accidental duplicate rows that could cause multiple maintenance modes.

---

### 3. Create Edge Function (Fallback) ✅
**File:** `supabase/functions/toggle-maintenance/index.ts`

**Security layers:**
1. ✅ JWT verification (extracts user from token)
2. ✅ Admin role check via SERVICE_ROLE (bypasses RLS)
3. ✅ Clear error messages for debugging
4. ✅ Comprehensive logging

**Usage from frontend:**
```typescript
const { data, error } = await supabase.functions.invoke('toggle-maintenance', {
  body: { maintenance_mode: true }
});
```

---

### 4. Update Frontend ✅
**File:** `src/pages/admin/AdminDashboard.tsx`

Changed from:
```typescript
await updateMaintenanceMode(nextValue);  // Direct DB call - vulnerable to RLS
```

Changed to:
```typescript
const { data, error } = await supabase.functions.invoke('toggle-maintenance', {
  body: { maintenance_mode: nextValue }
});
```

**Benefits:**
- Uses SERVER_ROLE internally (bypasses RLS)
- Proper admin verification server-side
- Clearer error messages
- Auditability (logs in function)

---

## 🧪 Testing Checklist

### Unit Tests (SQL)

```sql
-- Verify is_admin() works with SECURITY DEFINER
-- (Run in terminal as postgres user)

SELECT public.is_admin('ADMIN-USER-UUID'::uuid);
-- Should return: true

SELECT public.is_admin('REGULAR-USER-UUID'::uuid);
-- Should return: false

SELECT public.is_admin(NULL::uuid);
-- Should return: false
```

### Integration Tests

```typescript
// Test 1: Admin can toggle
const { data, error } = await supabase.functions.invoke('toggle-maintenance', {
  body: { maintenance_mode: true }
});
// Should succeed: { success: true, maintenance_mode: true, ... }

// Test 2: Non-admin cannot toggle
const { data, error } = await supabase.functions.invoke('toggle-maintenance', {
  body: { maintenance_mode: false }
});
// Should fail: { error: 'forbidden', message: 'Only admins can...' }

// Test 3: Frontend receives update
const maintenance = await useMaintenanceMode();
// Should auto-update via Realtime
```

### Manual Testing

1. **Login as admin**
   - Navigate to `/admin/dashboard`
   - Find "Mode Maintenance" toggle
   - Click toggle button
   - Should see success: "Mode maintenance activé."

2. **Login as regular user**
   - Try accessing Edge Function endpoint
   - Should get 403 Forbidden

3. **Check Realtime updates**
   - Toggle in Admin Dashboard
   - Check other browser tabs
   - Should see maintenance mode change in real-time

---

## 🔍 Debugging Steps (If Still Failing)

### Step 1: Check is_admin() function exists
```sql
-- In Supabase SQL Editor
SELECT prosecdef
FROM pg_proc
WHERE proname = 'is_admin'
  AND pronamespace = 'public'::regnamespace;
-- Should return: true (SECURITY DEFINER = true)
```

### Step 2: Test is_admin() directly
```sql
-- With your actual admin user UUID
SELECT public.is_admin('YOUR-ADMIN-UUID'::uuid);
-- Should return: true
```

### Step 3: Check RLS policy
```sql
-- View all policies on settings table
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'settings';
```

Should show:
```
"Admins can update settings" | public.is_admin(auth.uid()) | public.is_admin(auth.uid())
```

### Step 4: Check Edge Function logs

**In Supabase Dashboard:**
1. Go to Functions → toggle-maintenance
2. Click "Logs" tab
3. Filter by recent timestamp
4. Look for errors in format: `[toggle-maintenance] ...`

**Key log messages:**
```
✅ Success:
[toggle-maintenance] Success { userId, maintenance_mode, updated_at }

❌ Auth failed:
[toggle-maintenance] Auth verification failed

❌ Admin check failed:
[toggle-maintenance] Admin check failed { userId, role, is_deleted }

❌ Update failed:
[toggle-maintenance] Update failed: ...error message...
```

### Step 5: Check browser console
```javascript
// Frontend should show:
// Success: "Mode maintenance activé/désactivé"
// Error: Full error message from Edge Function
```

---

## 🚨 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "Auth verification failed" | JWT expired or invalid | Refresh page (triggers new session) |
| "Only admins can toggle" | User role is not 'admin' | Check user_profiles.role in DB |
| "Settings not found" | No row in settings table | Run: `INSERT INTO public.settings (maintenance_mode) VALUES (false)` |
| "Profile not found" | User profile doesn't exist | Check auth.users vs user_profiles sync |
| Realtime not updating | Channel not subscribed | Refresh page, check browser console |

---

## 📋 Files Changed

1. ✅ `supabase/migrations/20260324170000_fix_is_admin_security_definer.sql` - Fixed function
2. ✅ `supabase/migrations/20260324171000_add_settings_singleton_constraint.sql` - Added constraint
3. ✅ `supabase/functions/toggle-maintenance/index.ts` - New Edge Function
4. ✅ `src/pages/admin/AdminDashboard.tsx` - Updated frontend

---

## 📚 Related Security Concepts

### SECURITY DEFINER vs INVOKER

**SECURITY DEFINER (Used by is_admin):**
```sql
CREATE FUNCTION check_admin() SECURITY DEFINER AS ...
-- Runs as function owner (postgres)
-- Bypasses RLS policies
-- Useful for: role checks, privilege verification
-- Risk: Function must validate its own inputs
```

**SECURITY INVOKER (Default):**
```sql
CREATE FUNCTION low_level_operation() SECURITY INVOKER AS ...
-- Runs as calling user
-- Subject to RLS policies
-- Useful: filtering data based on user
-- Risk: Can't elevate privileges
```

### RLS Policy Behavior

```sql
CREATE POLICY "Users can only see themselves"
ON user_profiles
FOR SELECT
USING (auth.uid() = id);

-- With SECURITY INVOKER function:
-- Regular user → function runs with THEIR privileges
--             → can only see their own row
--             → query fails if checking other users

-- With SECURITY DEFINER function:
-- Regular user → function runs as POSTGRES
--             → can see ALL rows
--             → query succeeds, returns correct result
```

---

## 🎓 Lessons Learned

1. **SECURITY DEFINER for privilege checks**
   - Functions that verify roles/permissions must use SECURITY DEFINER
   - Otherwise they're blocked by the very RLS they're checking

2. **Test RLS + Functions together**
   - RLS policies interact with function privileges
   - Test: "Can admin update" vs "Can user update"

3. **Edge Functions as security boundary**
   - Can verify JWT
   - Can use SERVICE_ROLE for admin operations
   - Clearer audit trail
   - Better error messages

4. **Singleton pattern safety**
   - Use CHECK constraints to enforce 1 row
   - Prevents accidental data duplication

---

## 💡 Next Steps (Optional Hardening)

- [ ] Add rate limiting to toggle-maintenance function
- [ ] Add audit logging (log who toggled, when)
- [ ] Add approval workflow (2-admin toggle)
- [ ] Add maintenance mode grace period (5 min warning)
- [ ] Monitor Sentry for RLS errors during toggle

---

## 📞 Support

**If toggle still fails after these fixes:**

1. Check migration status: `SELECT * FROM supabase_migrations;`
2. Verify is_admin() prosecdef: `SELECT prosecdef FROM pg_proc WHERE proname = 'is_admin';`
3. Check Edge Function logs in dashboard
4. Verify user has 'admin' role in user_profiles table
5. Clear browser cache/localStorage
6. Check JWT token isn't expired (refresh page)

**Still stuck?** Check the logs from:
- Supabase Functions → toggle-maintenance → Logs
- Browser DevTools → Network tab → toggle-maintenance request
- Supabase SQL Editor → test is_admin() with your UUID
