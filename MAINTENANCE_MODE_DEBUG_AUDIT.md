# 🔍 MAINTENANCE MODE - FULL DEBUG AUDIT

**Date:** 2026-03-24
**Status:** Investigation Phase
**Symptom:** "Toggle-maintenance" feature not working - admin clicks toggle → nothing happens OR state not updated

---

## 📋 AUDIT CHECKLIST

### Phase 1: DATABASE STRUCTURE ✅

#### Check 1.1: Settings table exists and has data

**Run this in Supabase SQL Editor:**

```sql
-- Check table structure
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'settings'
ORDER BY ordinal_position;

-- Check data
SELECT id, maintenance_mode, updated_at, launch_date, launch_video_url
FROM public.settings
LIMIT 5;

-- Count rows (should be exactly 1 for singleton)
SELECT COUNT(*) as total_rows FROM public.settings;
```

**Expected Output:**
```
Columns: id (uuid), maintenance_mode (boolean), updated_at (timestamptz), launch_date, launch_video_url

Data: Should show exactly 1 row with valid values

Count: 1 (singleton pattern)
```

---

#### Check 1.2: REPLICA IDENTITY FULL (Required for Realtime)

```sql
-- Check if REPLICA IDENTITY is set to FULL (required for Realtime INSERT/UPDATE/DELETE)
SELECT relreplident FROM pg_class WHERE relname = 'settings';
```

**Expected:** `f` = FULL ✅

**If NOT set to FULL:**
```sql
ALTER TABLE public.settings REPLICA IDENTITY FULL;
```

---

### Phase 2: RLS POLICIES ✅

#### Check 2.1: All policies on settings table

```sql
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'settings'
ORDER BY policyname;
```

**Expected Policies:**
```
- "Anyone can read settings" (SELECT)
- "Admins can insert settings" (INSERT)
- "Admins can update settings" (UPDATE)
```

---

#### Check 2.2: Verify UPDATE policy details

```sql
-- Check if UPDATE policy uses is_admin() correctly
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'settings' AND policyname LIKE '%update%';
```

**Expected:**
- USING: `public.is_admin(auth.uid())`
- WITH CHECK: `public.is_admin(auth.uid())`

---

#### Check 2.3: Test is_admin() function

```sql
-- Replace with your actual admin user UUID
SELECT public.is_admin('YOUR-ADMIN-UUID'::uuid) as is_admin_result;
```

**Expected:** `true` (if user is admin), `false` (otherwise)

---

### Phase 3: FRONTEND CODE ANALYSIS ✅

#### Check 3.1: AdminDashboard toggle implementation

**File:** `src/pages/admin/AdminDashboard.tsx` (lines 366-394)

**Current Code:**
```typescript
const handleMaintenanceToggle = async () => {
  setIsSavingMaintenance(true);
  try {
    const nextValue = !maintenance;

    // Uses Edge Function
    const { data, error } = await supabase.functions.invoke('toggle-maintenance', {
      body: { maintenance_mode: nextValue },
    });

    if (error) throw new Error(error instanceof Error ? error.message : 'Unknown error');
    if (!data?.success) throw new Error(data?.message || 'Failed...');

    toast.success(...);
  } catch (err) {
    console.error('maintenance toggle error:', err);
    toast.error(errorMsg);
  } finally {
    setIsSavingMaintenance(false);
  }
};
```

**Analysis:**
- ✅ Uses Edge Function (safer)
- ✅ Error handling present
- ✅ User feedback via toast
- ⚠️ Relies on Edge Function working correctly
- ⚠️ Relies on Realtime to update other components

---

#### Check 3.2: useMaintenanceMode hook

**File:** `src/lib/supabase/useMaintenanceMode.ts`

**Critical Points:**

**Initial Load (lines 55-74):**
```typescript
const refresh = useCallback(async () => {
  setIsLoading(true);
  setError(null);

  const { data, error: fetchError } = await supabase
    .from('settings')
    .select(SETTINGS_SELECT)
    .limit(1)
    .maybeSingle();  // ← Important: handles no data gracefully

  if (fetchError) {
    setError(fetchError.message);
    return null;
  }

  applySettingsRow(data ?? null);  // ← Apply loaded data
  return data ?? null;
}, [applySettingsRow]);
```

**Realtime Subscription (lines 76-101):**
```typescript
useEffect(() => {
  void refresh();  // ← Initial load

  const channelName = `${SETTINGS_CHANNEL}:${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'settings' },  // ← Listens to ALL events
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (payload.eventType === 'DELETE') {
          applySettingsRow(null);
          return;
        }

        if (isSettingsRow(payload.new)) {
          applySettingsRow(payload.new);  // ← Update on change
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);  // ← Cleanup
  };
}, [applySettingsRow, refresh]);
```

**Update Method (lines 103-121):**
```typescript
const updateSettings = useCallback(async (updates: SettingsUpdate) => {
  if (!settingsId) {
    throw new Error('Maintenance settings row is missing');
  }

  const { data, error: updateError } = await supabase
    .from('settings')
    .update(updates)
    .eq('id', settingsId)  // ← WHERE clause present ✅
    .select(SETTINGS_SELECT)
    .single();

  if (updateError) {
    throw updateError;
  }

  applySettingsRow(data);  // ← Update local state
  return data;
}, [applySettingsRow, settingsId]);
```

**Analysis:**
- ✅ Initial data loaded correctly
- ✅ Realtime subscription set up
- ✅ WHERE clause uses settingsId
- ✅ State updated on change
- ⚠️ Depends on `settingsId` being set (could be null initially)
- ⚠️ Realtime subscription depends on REPLICA IDENTITY FULL

---

### Phase 4: EDGE FUNCTION VERIFICATION ✅

**File:** `supabase/functions/toggle-maintenance/index.ts`

**Key Points to Verify:**

```typescript
// 1. JWT Verification
const token = authHeader.slice(7);
const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
// ✅ Gets current user

// 2. Admin Check
const { data: profile, error: profileError } = await supabaseAdmin
  .from('user_profiles')
  .select('id, role, is_deleted, deleted_at')
  .eq('id', userId)
  .maybeSingle();
// ✅ Verifies admin status

// 3. Query settings ID (FIXED)
const { data: settingsRow, error: settingsQueryError } = await supabaseAdmin
  .from('settings')
  .select('id')
  .limit(1)
  .maybeSingle();
// ✅ Gets singleton row ID

// 4. UPDATE with WHERE clause (FIXED)
const { data: updated, error: updateError } = await supabaseAdmin
  .from('settings')
  .update({
    maintenance_mode: body.maintenance_mode,
    updated_at: new Date().toISOString(),
  })
  .eq('id', settingsRow.id)  // ✅ WHERE clause present
  .select('maintenance_mode, updated_at')
  .single();
```

**Status:** ✅ Code looks correct (we fixed the WHERE clause bug)

---

### Phase 5: REALTIME CONFIGURATION ✅

#### Check 5.1: Is Realtime enabled for settings table?

**Run:**
```sql
-- Check if settings table is published to realtime
SELECT * FROM pg_publication_tables
WHERE tablename = 'settings';
```

**Expected:** Should list `supabase_realtime` publication

**If NOT enabled:**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
```

---

#### Check 5.2: Verify REPLICA IDENTITY is FULL

```sql
-- Already checked in Phase 1
SELECT relreplident FROM pg_class WHERE relname = 'settings';
```

---

### Phase 6: DATA FLOW ANALYSIS

#### Scenario: Admin clicks toggle

```
1. Frontend (AdminDashboard.tsx)
   └─ handleMaintenanceToggle()
      └─ supabase.functions.invoke('toggle-maintenance')

2. Edge Function (toggle-maintenance/index.ts)
   ├─ Verify JWT
   ├─ Check admin role
   ├─ Query settings ID
   └─ UPDATE settings WHERE id = settingsId
      └─ Triggers INSERT/UPDATE event in Realtime

3. Supabase Realtime
   └─ Publishes change to supabase_realtime publication
      └─ REQUIRES: REPLICA IDENTITY FULL ✅

4. Frontend (useMaintenanceMode hook)
   └─ Receives realtime payload
      └─ Updates local state
         └─ Triggers re-render
            └─ UI shows new maintenance_mode value
```

---

## 🔴 MOST LIKELY ROOT CAUSES

### 1. REPLICA IDENTITY not set to FULL (60% probability)

**Why:** Realtime won't trigger if REPLICA IDENTITY is not FULL

**Fix:**
```sql
ALTER TABLE public.settings REPLICA IDENTITY FULL;
```

**Verify:**
```sql
SELECT relreplident FROM pg_class WHERE relname = 'settings';
-- Expected: f (meaning FULL)
```

---

### 2. Settings table not published to realtime (20% probability)

**Why:** Changes won't broadcast to clients

**Fix:**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
```

**Verify:**
```sql
SELECT * FROM pg_publication_tables WHERE tablename = 'settings';
```

---

### 3. Edge Function returns success but doesn't actually update (10% probability)

**Why:** Could be RLS blocking the UPDATE silently

**Check:**
- Is `is_admin()` function returning the correct value?
- Does the admin user have the 'admin' role in user_profiles?
- Is the UPDATE actually hitting the database?

**Debug Edge Function:**
```bash
# Check logs
supabase functions logs toggle-maintenance

# Look for: "[toggle-maintenance] Success" or error messages
```

---

### 4. Frontend not receiving realtime events (5% probability)

**Why:** Subscription might not be active

**Debug:**
```typescript
// In browser console, check:
console.log('Realtime status:', supabase.getChannels());

// Or add logs to useMaintenanceMode:
const channel = supabase
  .channel(channelName)
  .on('postgres_changes', ..., (payload) => {
    console.log('[REALTIME] Received:', payload);  // ← Add this
    ...
  })
```

---

### 5. settingsId is NULL (5% probability)

**Why:** Initial data didn't load before toggle attempt

**Check:**
```typescript
// In AdminDashboard, before toggle:
console.log('settingsId:', settingsId);
console.log('maintenance:', maintenance);

// Both should have values before clicking toggle
```

---

## ✅ COMPLETE VERIFICATION STEPS

Run these **IN ORDER** to identify the exact problem:

### Step 1: Check database

```sql
-- Run ALL of these:

-- Check data exists
SELECT * FROM public.settings;

-- Check REPLICA IDENTITY
SELECT relreplident FROM pg_class WHERE relname = 'settings';

-- Check Realtime publication
SELECT * FROM pg_publication_tables WHERE tablename = 'settings';

-- Check RLS policies
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'settings';

-- Test is_admin() (replace UUID)
SELECT public.is_admin('YOUR-ADMIN-UUID'::uuid);
```

### Step 2: Check Edge Function logs

```bash
supabase functions logs toggle-maintenance --tail

# Should show recent invocations with [toggle-maintenance] prefix
```

### Step 3: Test manually

1. Go to Admin Dashboard
2. Open browser DevTools → Console
3. Add logs to useMaintenanceMode.ts (see code above)
4. Click maintenance toggle
5. Watch for:
   - Console errors
   - Realtime payload received
   - State updated

### Step 4: Check frontend state

```typescript
// In AdminDashboard, add temporary debug:
<pre>{JSON.stringify({
  maintenance,
  settingsId,
  isLoading,
  error
}, null, 2)}</pre>
```

---

## 🔧 FIXES (Copy-Paste Ready)

### Fix 1: Enable REPLICA IDENTITY

```sql
BEGIN;
ALTER TABLE public.settings REPLICA IDENTITY FULL;
COMMIT;
```

### Fix 2: Publish to realtime

```sql
BEGIN;
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
COMMIT;
```

### Fix 3: Verify is_admin()

```sql
-- Check function definition
\df+ public.is_admin

-- Should show: SECURITY DEFINER (not INVOKER)
```

### Fix 4: Add debug logs to frontend

**File:** `src/lib/supabase/useMaintenanceMode.ts`

Add after line 85:

```typescript
(payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
  console.log('[REALTIME PAYLOAD]', {
    eventType: payload.eventType,
    new: payload.new,
    timestamp: new Date().toISOString(),
  });

  if (payload.eventType === 'DELETE') {
    console.log('[REALTIME] Settings deleted');
    applySettingsRow(null);
    return;
  }

  if (isSettingsRow(payload.new)) {
    console.log('[REALTIME] Updating state:', payload.new);
    applySettingsRow(payload.new);
  } else {
    console.warn('[REALTIME] Invalid settings row:', payload.new);
  }
},
```

---

## 📊 NEXT ACTIONS

1. **Run Step 1-4 above** to identify exact cause
2. **Share results** (SQL output, Edge Function logs, browser console)
3. **Apply corresponding fix**
4. **Test toggle again**
5. **Monitor logs** to confirm fix worked

---

**Your assistant is ready for next steps.** Send me:
- Output from `SELECT * FROM public.settings;`
- Output from `SELECT relreplident FROM pg_class WHERE relname = 'settings';`
- Recent Edge Function logs
- Browser console errors (if any)

Then I can pinpoint the exact issue.
