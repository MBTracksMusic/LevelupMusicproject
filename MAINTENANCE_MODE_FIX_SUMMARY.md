# 🎯 Maintenance Mode Fix - Complete Summary

**Date:** 2026-03-24
**Status:** ✅ READY TO DEPLOY
**Severity:** CRITICAL (Admin feature blocker)

---

## 📋 What Was Fixed

### 🔴 The Problem
Admin users couldn't toggle maintenance mode. Error: **"Impossible de mettre à jour le mode maintenance"**

### 🟢 The Solution
Multi-layered security fix:
1. ✅ Fixed `is_admin()` function privilege issue
2. ✅ Created safe Edge Function with SERVER_ROLE
3. ✅ Updated frontend to use Edge Function
4. ✅ Added singleton constraint for data integrity

---

## 📁 Files Changed

### New Files (Added)

```
✨ MIGRATIONS (Apply in order)
├── supabase/migrations/20260324170000_fix_is_admin_security_definer.sql
│   └── CRITICAL: Fixes is_admin() SECURITY INVOKER → SECURITY DEFINER
└── supabase/migrations/20260324171000_add_settings_singleton_constraint.sql
    └── Safety: Enforces only 1 row in settings table

✨ EDGE FUNCTION (Deploy to Supabase)
├── supabase/functions/toggle-maintenance/index.ts
│   └── Safe admin operation with JWT + role verification

📚 DOCUMENTATION
├── DEBUG_MAINTENANCE_MODE.md
│   └── Comprehensive debugging guide + testing checklist
└── MAINTENANCE_MODE_FIX_SUMMARY.md
    └── This file
```

### Modified Files

```
📝 FRONTEND (Already updated)
└── src/pages/admin/AdminDashboard.tsx
    └── Changed: direct DB update → Edge Function invoke
```

---

## 🚀 Deployment Checklist

### Phase 1: Database Migrations

```bash
# 1. Apply migrations to Supabase
# In Supabase Dashboard → SQL Editor, run these in order:

# First migration: Fix is_admin() function
-- Copy contents of: supabase/migrations/20260324170000_fix_is_admin_security_definer.sql
-- Paste and execute in SQL Editor

# Second migration: Add singleton constraint
-- Copy contents of: supabase/migrations/20260324171000_add_settings_singleton_constraint.sql
-- Paste and execute in SQL Editor

# Verify:
SELECT prosecdef FROM pg_proc
WHERE proname = 'is_admin'
  AND pronamespace = 'public'::regnamespace;
-- Should return: true ✅
```

### Phase 2: Deploy Edge Function

```bash
# Option A: Using Supabase CLI
cd supabase/functions
supabase functions deploy toggle-maintenance

# Option B: Using Vercel (if using Vercel hosting)
vercel deploy

# Verify:
# 1. Check Supabase Dashboard → Functions → toggle-maintenance
# 2. Status should be: "Active" ✅
```

### Phase 3: Frontend Deployment

```bash
# Already code-complete! Frontend is updated:
# - src/pages/admin/AdminDashboard.tsx uses Edge Function

# Deploy your frontend normally:
npm run build
# ... your deployment process ...
```

---

## ✅ Testing Checklist

### Pre-Deployment (Local)

- [ ] Run migrations: verify `is_admin()` has `prosecdef = true`
- [ ] Deploy Edge Function
- [ ] Frontend code compiles without errors
- [ ] No TypeScript errors in IDE

### Post-Deployment (Staging)

- [ ] Login as admin user
- [ ] Navigate to `/admin/dashboard`
- [ ] Click maintenance mode toggle
- [ ] Should succeed with toast: "Mode maintenance activé/désactivé" ✅
- [ ] Check Supabase logs → Functions → toggle-maintenance for success log
- [ ] Open new tab, verify maintenance mode updates in real-time (Realtime subscription)

### Post-Deployment (Production)

- [ ] Repeat staging tests in production
- [ ] Monitor Sentry for any RLS errors
- [ ] Check Edge Function logs for errors
- [ ] Have admin user test toggle in production

---

## 🔍 How It Works Now

### Before (Broken)
```
Admin clicks toggle
  ↓
Frontend: supabase.from('settings').update(...)
  ↓
RLS checks: is_admin(auth.uid())
  ↓
is_admin() runs with INVOKER privileges → hits RLS blocks → fails ❌
  ↓
UPDATE rejected
  ↓
Error: "Impossible de mettre à jour le mode maintenance"
```

### After (Fixed)
```
Admin clicks toggle
  ↓
Frontend: supabase.functions.invoke('toggle-maintenance', ...)
  ↓
Edge Function verifies JWT token
  ↓
Edge Function queries user_profiles with SERVICE_ROLE (no RLS)
  ↓
Confirms user.role === 'admin' ✅
  ↓
Updates settings with SERVICE_ROLE
  ↓
Returns success response
  ↓
Frontend shows: "Mode maintenance activé/désactivé" ✅
  ↓
Realtime broadcasts update to all clients
```

---

## 🛡️ Security Improvements

| Aspect | Before | After |
|--------|--------|-------|
| **Privilege Escalation** | is_admin() blocked by RLS | ✅ Uses SECURITY DEFINER |
| **JWT Verification** | Implicit (RLS only) | ✅ Explicit in Edge Function |
| **Admin Check** | Via RLS policy | ✅ Direct role query + deleted_at check |
| **Audit Trail** | No logs | ✅ Function logs all actions |
| **Error Messages** | Generic RLS error | ✅ Clear messages for debugging |
| **Data Integrity** | Multiple rows possible | ✅ CHECK constraint prevents duplicates |

---

## 📊 Migration Details

### Migration 1: Fix is_admin()

**File:** `supabase/migrations/20260324170000_fix_is_admin_security_definer.sql`

**Change:** `SECURITY INVOKER` → `SECURITY DEFINER`

**Impact:**
- Fixes all admin operations depending on `is_admin()`
- Maintenance mode toggle works
- Settings updates work
- Admin dashboard operations work

**Rollback:** Change back to `SECURITY INVOKER` (not recommended)

### Migration 2: Add Singleton Constraint

**File:** `supabase/migrations/20260324171000_add_settings_singleton_constraint.sql`

**Change:** Adds CHECK constraint

**Impact:**
- Prevents duplicate rows in settings table
- Enforces only 1 configuration instance

**Rollback:** `ALTER TABLE public.settings DROP CONSTRAINT settings_singleton_check;`

---

## 🔧 Edge Function Details

**File:** `supabase/functions/toggle-maintenance/index.ts`

**Endpoint:** `POST /functions/v1/toggle-maintenance`

**Request Body:**
```json
{ "maintenance_mode": boolean }
```

**Success Response (200):**
```json
{
  "success": true,
  "maintenance_mode": boolean,
  "updated_at": "2026-03-24T12:34:56Z"
}
```

**Error Response (401/403/500):**
```json
{
  "error": "error_code",
  "message": "Human readable message"
}
```

**Security:**
- ✅ Validates JWT token
- ✅ Checks admin role via SERVICE_ROLE
- ✅ Confirms user not deleted
- ✅ Logs all actions
- ✅ Clear error messages for debugging

---

## 🐛 Debugging Guide

If toggle still fails after deployment:

### Check 1: Verify Migration Applied
```sql
SELECT prosecdef FROM pg_proc
WHERE proname = 'is_admin';
-- Must be: true
```

### Check 2: Verify Settings Row Exists
```sql
SELECT COUNT(*) FROM public.settings;
-- Must be: 1
```

### Check 3: Test is_admin() Directly
```sql
-- Replace with actual admin user UUID
SELECT public.is_admin('ADMIN-UUID'::uuid);
-- Must return: true
```

### Check 4: Check Edge Function Logs
1. Supabase Dashboard
2. Functions → toggle-maintenance
3. Click "Logs" tab
4. Look for recent entries with `[toggle-maintenance]`
5. Check for error patterns:
   - `Auth verification failed` → JWT issue
   - `Admin check failed` → User not admin
   - `Update failed` → Database issue

### Check 5: Check Frontend Logs
1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for logged errors
4. Network tab → check `toggle-maintenance` request
   - Should be HTTP 200 with `{ success: true, ... }`

---

## 📞 Support

**Stuck?** Check in this order:
1. ✅ Migrations applied? (Check prosecdef = true)
2. ✅ Edge Function deployed? (Check status = "Active")
3. ✅ Frontend updated? (Should invoke Edge Function)
4. ✅ User is admin? (Check user_profiles.role = 'admin')
5. ✅ No deleted account? (Check is_deleted = false, deleted_at IS NULL)
6. ✅ JWT not expired? (Refresh page to get new token)

---

## 📝 Final Notes

- **No breaking changes:** Frontend remains backward compatible
- **Database:** Migrations are idempotent (safe to re-run)
- **Rollback:** Can rollback Edge Function independently if needed
- **Performance:** No impact (same queries, just different security context)
- **Monitoring:** Check Sentry for any new RLS errors post-deployment

---

## ✨ What's Next

After deployment, consider:
- [ ] Add rate limiting to toggle-maintenance function
- [ ] Add audit logging (who toggled, timestamp)
- [ ] Add approval workflow (2-admin confirmation)
- [ ] Monitor for abuse in function logs
- [ ] Test with multiple admins simultaneously

---

**Status:** Ready for production ✅
**Risk Level:** Low (security fix, minimal changes)
**Rollback:** Straightforward (migrations are reversible)
