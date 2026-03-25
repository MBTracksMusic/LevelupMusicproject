# ⚡ Quick Reference - Maintenance Mode Fix

**Print this page.** Keep it near your desk during deployment.

---

## 🚀 DEPLOYMENT (5 min)

### Step 1️⃣: Apply Migrations

```bash
# Supabase Dashboard → SQL Editor → Copy & Paste & Execute

# MIGRATION 1 (Critical)
-- File: supabase/migrations/20260324170000_fix_is_admin_security_definer.sql
-- Paste entire file and execute

# MIGRATION 2 (Safety)
-- File: supabase/migrations/20260324171000_add_settings_singleton_constraint.sql
-- Paste entire file and execute

# VERIFY
SELECT prosecdef FROM pg_proc
WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace;
-- Result: true ✅
```

### Step 2️⃣: Deploy Edge Function

```bash
# Via Supabase CLI
supabase functions deploy toggle-maintenance

# OR via Vercel
vercel deploy

# VERIFY
# Supabase Dashboard → Functions → toggle-maintenance
# Status: "Active" ✅
```

### Step 3️⃣: Deploy Frontend

```bash
npm run build && npm run deploy
# (Your existing deployment process)
```

---

## ✅ TEST (2 min)

### Pre-Test Checklist
- [ ] Migrations applied (prosecdef = true)
- [ ] Edge Function deployed (status = Active)
- [ ] Frontend deployed (code includes AdminDashboard change)

### Test Steps

1. **Login as admin**
2. **Go to `/admin/dashboard`**
3. **Click maintenance mode toggle**
4. **Expected:** Success toast + toggle switches
5. **Check logs:** Supabase → Functions → toggle-maintenance → Logs

### What Success Looks Like

```
Frontend: "Mode maintenance activé." (toast)
Function Log: "[toggle-maintenance] Success { userId, maintenance_mode: true, ... }"
Real-time: Other tabs update automatically
```

---

## 🔴 IF IT FAILS

| Error | Cause | Fix |
|-------|-------|-----|
| "Impossible de mettre à jour..." | Migration not applied | Check prosecdef = true |
| "Only admins can toggle" | User not admin | Check user_profiles.role = 'admin' |
| "Settings not found" | No settings row | `INSERT INTO public.settings (maintenance_mode) VALUES (false);` |
| "Auth verification failed" | JWT expired | Refresh page |
| Function doesn't exist | Not deployed | Deploy toggle-maintenance function |

### Debug Sequence

```
1. Is prosecdef = true?
   SELECT prosecdef FROM pg_proc WHERE proname = 'is_admin';

2. Is function deployed?
   Supabase Dashboard → Functions → toggle-maintenance

3. Is user admin?
   SELECT role FROM user_profiles WHERE id = 'YOUR-UUID';

4. Check function logs
   Supabase Dashboard → Functions → toggle-maintenance → Logs

5. Check browser console
   F12 → Console → Search for "maintenance"
```

---

## 📁 FILES AT A GLANCE

```
✨ NEW FILES
├── supabase/migrations/20260324170000_fix_is_admin_security_definer.sql
│   (Apply first: Fixes is_admin())
├── supabase/migrations/20260324171000_add_settings_singleton_constraint.sql
│   (Apply second: Adds safety constraint)
├── supabase/functions/toggle-maintenance/index.ts
│   (Deploy: New Edge Function)
├── DEBUG_MAINTENANCE_MODE.md
│   (Full debug guide)
├── MAINTENANCE_MODE_FIX_SUMMARY.md
│   (Full deployment checklist)
├── TECHNICAL_DEEP_DIVE.md
│   (For senior engineers)
└── QUICK_REFERENCE.md
    (This file)

📝 MODIFIED FILES
├── src/pages/admin/AdminDashboard.tsx
    (Now uses Edge Function instead of direct DB)
```

---

## 🎯 WHAT CHANGED

### The Bug
```
Admin clicks toggle
  ↓
Frontend: supabase.from('settings').update(...)
  ↓
is_admin() runs with INVOKER privileges
  ↓
RLS blocks query → UPDATE rejected
  ↓
Error: "Impossible de mettre à jour..."
```

### The Fix
```
Admin clicks toggle
  ↓
Frontend: supabase.functions.invoke('toggle-maintenance')
  ↓
Edge Function verifies JWT + admin role with SERVICE_ROLE
  ↓
Updates settings with full privileges
  ↓
Success: "Mode maintenance activé."
```

---

## 💡 KEY CONCEPTS

### SECURITY DEFINER (Fixed is_admin)
```
Function runs with OWNER privileges (postgres)
→ Can read user_profiles without RLS blocking it
→ Auth checks work reliably
```

### Edge Function (Added toggle-maintenance)
```
Explicit JWT verification
+ Admin role check
+ SERVICE_ROLE database access
+ Audit logging
= Secure admin operation
```

### Realtime Updates
```
Frontend listens to settings table changes
When Edge Function updates settings
→ Realtime broadcasts to all clients
→ All tabs show new maintenance status
```

---

## 🔍 MONITORING POST-DEPLOYMENT

### What to Watch

1. **Function Logs**
   ```
   Supabase → Functions → toggle-maintenance → Logs
   Look for: [toggle-maintenance] Success
   ```

2. **Sentry Errors**
   ```
   Monitor for any RLS policy violations
   Should be ZERO after fix
   ```

3. **User Feedback**
   ```
   Admin can toggle maintenance mode
   Other users see updates in real-time
   ```

---

## 🆘 NEED HELP?

### Check These Files In Order

1. **Quick overview** → This file (QUICK_REFERENCE.md)
2. **Full deployment** → MAINTENANCE_MODE_FIX_SUMMARY.md
3. **Debugging** → DEBUG_MAINTENANCE_MODE.md
4. **Technical details** → TECHNICAL_DEEP_DIVE.md

### Contact

If still failing after all checks:
1. Verify migrations applied (prosecdef = true)
2. Check Edge Function logs
3. Check browser DevTools console
4. Review TECHNICAL_DEEP_DIVE.md for security concepts

---

## ⏱️ TIME ESTIMATES

| Task | Time | Notes |
|------|------|-------|
| Apply migrations | 2 min | Copy-paste in SQL Editor |
| Deploy function | 2 min | Single command |
| Deploy frontend | 5-15 min | Your usual process |
| Test | 2 min | Simple toggle test |
| **TOTAL** | **~15-25 min** | Could be faster! |

---

## ✨ WHAT YOU'LL SEE AFTER DEPLOYMENT

### Admin User
- Maintenance toggle works ✅
- Success toast appears ✅
- Other tabs update in real-time ✅

### Regular User
- Can't toggle (403 error if they try) ✅
- Sees maintenance message when enabled ✅

### Logs
- Edge Function logs every toggle ✅
- No RLS errors ✅

---

**Status:** Ready to Deploy ✅
**Risk:** Low (security fix)
**Rollback:** Simple (migrations reversible)

Good luck! 🚀
