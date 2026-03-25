# 🔍 Edge Function Code Audit - toggle-maintenance

**Date:** 2026-03-24
**Status:** ⚠️ **CRITICAL BUGS FOUND**
**Severity:** HIGH

---

## 🔴 BUG #1: UPDATE WITHOUT WHERE CLAUSE (CRITICAL!)

### Location
Lines 194-202

### Broken Code
```typescript
const { data: updated, error: updateError } = await supabaseAdmin
  .from('settings')
  .update({
    maintenance_mode: body.maintenance_mode,
    updated_at: new Date().toISOString(),
  })
  .limit(1)                                    // ← Limits RESULTS, not rows updated
  .select('maintenance_mode, updated_at')
  .single();
```

### The Problem
**No WHERE clause!** This UPDATE will modify **ALL rows** in the settings table!

```
Without WHERE:
UPDATE settings SET maintenance_mode = true, updated_at = now()
↓
Affects: ALL rows ❌

With WHERE (what we need):
UPDATE settings SET maintenance_mode = true, updated_at = now()
WHERE id = '...'
↓
Affects: Only the singleton row ✅
```

### Why .limit(1) Doesn't Help
- `.limit(1)` limits the RESULT SET (what gets returned)
- It does NOT limit the UPDATE target rows
- UPDATE still hits all rows, then returns only 1

### Impact
- **High risk:** If user changes maintenance_mode while another request is processing, could cause race conditions
- **Data corruption:** If settings table ever had multiple rows, ALL would update

### Fix Required
```typescript
// FIXED: Add WHERE clause to target only the settings row
const { data: updated, error: updateError } = await supabaseAdmin
  .from('settings')
  .update({
    maintenance_mode: body.maintenance_mode,
    updated_at: new Date().toISOString(),
  })
  .eq('id', settingsId)  // ← ADD THIS: Where to update
  .select('maintenance_mode, updated_at')
  .single();
```

**But wait:** We don't know the settings row ID! We need to:

**Option A: Query the ID first**
```typescript
const { data: settings, error: settingsError } = await supabaseAdmin
  .from('settings')
  .select('id')
  .limit(1)
  .single();

if (settingsError || !settings?.id) {
  throw new Error('Settings not found');
}

const { data: updated, error: updateError } = await supabaseAdmin
  .from('settings')
  .update({
    maintenance_mode: body.maintenance_mode,
    updated_at: new Date().toISOString(),
  })
  .eq('id', settings.id)  // ← Use the ID
  .select('maintenance_mode, updated_at')
  .single();
```

**Option B: Since it's singleton, safely assume id exists**
```typescript
// After adding the singleton constraint, we know there's exactly 1 row
// But still need to find its ID somehow...
```

---

## 🔴 BUG #2: Confusing Client Initialization (SECURITY)

### Location
Lines 118-121

### Broken Code
```typescript
// Client with user's token (for auth verification)
const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {  // ← SERVICE_ROLE key!
  auth: { persistSession: false },
  global: { headers: { authorization: `Bearer ${token}` } },         // ← User token!
});
```

### The Problem
1. Creating client with **SERVICE_ROLE key** (superuser privileges)
2. But overriding Authorization header with **user token**
3. This is **confusing and potentially unsafe**

**What's happening:**
```
supabaseAuth = Supabase client
├─ Initialized with: SERVICE_ROLE_KEY (superuser)
├─ But headers.authorization = user token (regular user)
└─ Unclear which privileges are being used!
```

**This might work by accident**, but it's:
- ❌ Semantically wrong
- ❌ Hard to audit
- ❌ Could break if Supabase changes implementation
- ❌ Confusing for future maintainers

### Why It's Wrong
To verify a JWT token, you should:

**Option A: Use PUBLIC key + user token**
```typescript
const supabaseAuth = createClient(supabaseUrl, publicKey, {
  auth: { persistSession: false },
  global: { headers: { authorization: `Bearer ${token}` } },
});

// Client will have regular user privileges
// auth.getUser() will verify the token
```

**Option B: Use SERVICE_ROLE + manual JWT verification**
```typescript
// Manually decode and verify the JWT instead
// Using crypto or a JWT library

// Then query with SERVICE_ROLE for admin operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
```

### Recommended Fix
```typescript
// Step 1: Verify JWT token explicitly (using JWT verification)
// This is clearer and more secure

// For now, use PUBLIC key for auth verification
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');

if (!publicKey) {
  throw new Error('SUPABASE_ANON_KEY not set');
}

// Client with PUBLIC key for user-level operations
const supabaseAuth = createClient(supabaseUrl, publicKey, {
  auth: { persistSession: false },
  global: { headers: { authorization: `Bearer ${token}` } },
});

// Separate: Client with SERVICE_ROLE for admin operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
```

**OR better yet:**

Use JWT verification library:
```typescript
// Verify JWT manually (safer, clearer intent)
import { verify } from 'https://deno.land/std@0.208.0/crypto/mod.ts';

const payload = await verify(token, jwtSecret, 'HS256');
const userId = payload.sub; // Extract user ID from JWT

// Now use SERVICE_ROLE for all operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
```

---

## ✅ WHAT WORKS WELL

Good practices found:

✅ CORS handling (lines 40-48)
- Correct preflight response
- Proper headers

✅ Input validation (lines 77-86)
- Type checking for maintenance_mode
- Clear error message

✅ Error handling
- Try-catch wrapper
- Specific error messages for each failure point
- Appropriate HTTP status codes

✅ Security checks
- JWT verification (even if implementation is odd)
- Admin role verification
- Deleted account check

✅ Logging
- Info logs for success
- Warning logs for auth failures
- Error logs for exceptions

✅ Type safety
- TypeScript interfaces for request/response
- Type guards

---

## 🔧 FIXES REQUIRED

### Priority 1: CRITICAL (Breaks functionality)

**Fix: Add WHERE clause to UPDATE**

Replace lines 193-202 with:

```typescript
// === 10. Query the settings singleton to get its ID
const { data: settingsRow, error: settingsQueryError } = await supabaseAdmin
  .from('settings')
  .select('id')
  .limit(1)
  .maybeSingle();

if (settingsQueryError) {
  console.error('[toggle-maintenance] Settings query failed:', settingsQueryError.message);
  return new Response(JSON.stringify({
    error: 'settings_query_failed',
    message: 'Failed to query settings',
  } as ErrorResponse), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

if (!settingsRow?.id) {
  console.warn('[toggle-maintenance] Settings singleton not found');
  return new Response(JSON.stringify({
    error: 'settings_not_found',
    message: 'Settings singleton row not found. Database may not be initialized.',
  } as ErrorResponse), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

// === 11. Update ONLY the settings singleton
const { data: updated, error: updateError } = await supabaseAdmin
  .from('settings')
  .update({
    maintenance_mode: body.maintenance_mode,
    updated_at: new Date().toISOString(),
  })
  .eq('id', settingsRow.id)  // ← WHERE clause: update only this row
  .select('maintenance_mode, updated_at')
  .single();

if (updateError) {
  console.error('[toggle-maintenance] Update failed:', updateError.message);
  return new Response(JSON.stringify({
    error: 'update_failed',
    message: 'Failed to update maintenance mode',
    details: updateError.message,
  } as ErrorResponse), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

if (!updated) {
  console.warn('[toggle-maintenance] Settings row not found after update');
  return new Response(JSON.stringify({
    error: 'update_result_not_found',
    message: 'Settings update succeeded but result not found.',
  } as ErrorResponse), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

// === 12. Success - log action
console.log('[toggle-maintenance] Success', {
  userId,
  settingsId: settingsRow.id,
  maintenance_mode: updated.maintenance_mode,
  updated_at: updated.updated_at,
});
```

---

### Priority 2: Important (Security clarity)

**Fix: Use PUBLIC key for auth verification**

Replace lines 118-121 with:

```typescript
// Client with PUBLIC key for auth verification
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');

if (!publicKey) {
  console.error('[toggle-maintenance] Missing SUPABASE_ANON_KEY');
  return new Response(JSON.stringify({
    error: 'internal_error',
    message: 'Server configuration error',
  } as ErrorResponse), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

const supabaseAuth = createClient(supabaseUrl, publicKey, {
  auth: { persistSession: false },
  global: { headers: { authorization: `Bearer ${token}` } },
});
```

Add comment clarifying the intent:

```typescript
// Step 1: Verify JWT with PUBLIC key (user privileges)
const supabaseAuth = createClient(...);  // Regular user level

// Step 2: Query with SERVICE_ROLE (admin privileges)
const supabaseAdmin = createClient(...); // Superuser level
```

---

## 📋 COMPLETE FIXED CODE

I'll provide the corrected version in the next file.

---

## 🧪 TESTING NOTES

After fixing these bugs, test:

```typescript
// Test 1: Verify UPDATE targets only 1 row
// Check logs show correct settingsId

// Test 2: Rapid requests don't cause conflicts
// Send 2 concurrent toggle requests
// Both should succeed

// Test 3: No unintended side effects
// Insert test row in settings table
// Toggle maintenance
// Verify only singleton row updated (test row unchanged)
```

---

## 📊 SUMMARY

| Issue | Severity | Impact | Fixed? |
|-------|----------|--------|--------|
| UPDATE without WHERE | CRITICAL | Could update all rows | ❌ NO |
| Confusing client init | HIGH | Security audit failure | ❌ NO |
| Missing ANON_KEY env | HIGH | Function fails | ❌ NO |

**Status:** ⚠️ Function is BROKEN and needs fixes before deployment

---

**Next Step:** Provide corrected function code (FIXED_toggle_maintenance.ts)
