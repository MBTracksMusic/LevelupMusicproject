# 🔐 Supabase Vault Migration Fix - Complete Guide

**Date:** 2026-03-24
**Status:** Analysis & Solution Provided
**Severity:** Deployment Blocker

---

## 🔴 ROOT CAUSE ANALYSIS

### What is `vault.decrypted_secrets`?

**Supabase Vault** is a system for managing encrypted secrets in your PostgreSQL database.

```
Vault Architecture:
┌─────────────────────────────────────────────────────┐
│ Supabase Vault (Encryption Layer)                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ vault.secrets (encrypted storage)           │  │
│  │ - All data encrypted at rest                │  │
│  │ - Only Supabase can decrypt                 │  │
│  └──────────────────────────────────────────────┘  │
│                         ↕                           │
│  ┌──────────────────────────────────────────────┐  │
│  │ vault.decrypted_secrets (decrypted view)    │  │
│  │ - Shows decrypted values                    │  │
│  │ - RESTRICTED: Read-only access              │  │
│  │ - NO: INSERT, UPDATE, DELETE allowed        │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Why INSERT is Forbidden

**Architecture Principle:**

```
vault.decrypted_secrets = READ-ONLY VIEW
↓
Users cannot directly INSERT (would bypass encryption layer)
↓
Only vault.create_secret() function can create secrets safely
↓
Function ensures proper encryption before storage
```

### The Permission Model

```sql
-- What your migration is trying:
INSERT INTO vault.decrypted_secrets (name, secret, description)
VALUES ('SEND_EMAIL_HOOK_SECRET', 'value', 'description');
-- Result: ERROR: permission denied for view decrypted_secrets ❌

-- Why it fails:
-- 1. vault.decrypted_secrets is a VIEW (not a table)
-- 2. Views are read-only by default
-- 3. Supabase restricts INSERT to vault.secrets directly
-- 4. Even with permissions, inserting into a view is blocked
```

### Supabase Vault Security Guarantees

```
✅ Data at rest: AES-256 encryption
✅ Encryption keys: Isolated per project
✅ Access control: Via roles & policies
✅ Audit trail: All access logged
✅ Protection: INSERT/UPDATE/DELETE blocked on views
```

---

## ✅ SOLUTION COMPARISON

### Option A: CLI Secrets (RECOMMENDED ⭐)

**Method:**
```bash
supabase secrets set SEND_EMAIL_HOOK_SECRET=your_value
```

**Pros:**
- ✅ Designed for Supabase secrets
- ✅ Works seamlessly with Edge Functions
- ✅ Not in migrations (separation of concerns)
- ✅ Environment-specific values
- ✅ No database access required
- ✅ Easy to rotate secrets
- ✅ No schema pollution

**Cons:**
- Requires manual step (not automated in migrations)

**Best for:**
- Edge Function secrets
- API keys
- Integration credentials
- Sensitive environment values

---

### Option B: vault.create_secret() Function (SQL)

**Method:**
```sql
SELECT vault.create_secret(
  'SEND_EMAIL_HOOK_SECRET',
  gen_random_uuid()::text,
  'Secret for auth-send-email webhook'
);
```

**Pros:**
- ✅ Uses official Supabase function
- ✅ Can be called in migrations
- ✅ Handles encryption properly
- ✅ Returns secret ID for reference

**Cons:**
- ❌ `vault.create_secret()` may not exist or be available
- ❌ Requires special permissions
- ❌ Supabase doesn't recommend for most use cases
- ⚠️ May generate random values (not suitable for fixed secrets)

**Best for:**
- RLS policies that need secrets
- Database-stored sensitive data
- Complex encryption workflows

---

### Option C: Remove from Migration (SAFEST)

**Method:**
```sql
-- Leave migration empty or just create tables/policies
-- Manage secrets separately via CLI
```

**Pros:**
- ✅ Migrations only contain schema
- ✅ Secrets managed separately
- ✅ Clear separation of concerns
- ✅ Easy to audit

**Cons:**
- Requires additional deployment steps

**Best for:**
- Production systems
- Following best practices
- Separation of concerns

---

## 🟢 RECOMMENDED SOLUTION

### ✅ Use Option C + Option A

**Why:**
1. **Migrations = Schema only** (clean, versionable)
2. **Secrets = Environment config** (managed separately)
3. **No hardcoding** (security best practice)
4. **Works everywhere** (CLI, CI/CD, local)

---

## 🔧 FIX #1: Rewrite the Migration (Remove Vault INSERT)

**File:** `supabase/migrations/20260324160000_create_auth_send_email_webhook.sql`

### ❌ CURRENT (BROKEN)

```sql
/*
  # Create the webhook for auth email sending
*/

BEGIN;

INSERT INTO vault.decrypted_secrets (name, secret, description)
VALUES (
  'SEND_EMAIL_HOOK_SECRET',
  gen_random_uuid()::text,
  'Secret for auth-send-email webhook'
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
```

### ✅ FIXED (SAFE)

```sql
/*
  # Auth email webhook secret - Setup Guide

  ⚠️  IMPORTANT: Secrets are managed via Supabase CLI, NOT migrations.

  After this migration completes, run:

    supabase secrets set SEND_EMAIL_HOOK_SECRET=your_secret_value

  Where your_secret_value is a strong random string.

  The secret will be available to Edge Functions as:
    const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
*/

BEGIN;

-- This migration is intentionally minimal.
-- Vault secrets are managed outside of migrations.
-- See comments above for setup instructions.

COMMIT;
```

**Why this is better:**
- ✅ No permission errors
- ✅ Migrations only contain schema
- ✅ Secrets managed via CLI (industry standard)
- ✅ Different per environment
- ✅ Easy to rotate
- ✅ Follows Supabase best practices

---

## 📋 DEPLOYMENT WORKFLOW

### Step 1: Apply Migration (No Secrets)

```bash
supabase db push
# Applies schema migrations
# ✅ Should succeed now (no vault permission issues)
```

### Step 2: Set the Secret

```bash
# For development
supabase secrets set SEND_EMAIL_HOOK_SECRET=dev_webhook_secret_12345

# For production (via Supabase Dashboard or CI/CD)
# Dashboard → Settings → Secrets → Add new secret
# Name: SEND_EMAIL_HOOK_SECRET
# Value: your_production_secret_value
```

### Step 3: Use in Edge Function

**File:** `supabase/functions/YOUR_FUNCTION/index.ts`

```typescript
const webhookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');

if (!webhookSecret) {
  throw new Error('SEND_EMAIL_HOOK_SECRET not set');
}

// Use the secret
console.log('Webhook secret available:', !!webhookSecret);
```

---

## 🎓 BEST PRACTICES EXPLAINED

### Why NOT to Insert Secrets in Migrations

```
❌ ANTI-PATTERN: Hardcode secret in migration
  INSERT INTO vault.secrets VALUES ('secret_value');
  Problems:
    1. Secret visible in git history
    2. Same secret across all environments
    3. Can't rotate without new migration
    4. Breaks separation of concerns
    5. Violates vault security model

✅ PATTERN: Manage secrets separately
  # Migration: Just structure
  # Secrets: Set via CLI per environment
  Benefits:
    1. Secrets never in code
    2. Different per environment
    3. Easy rotation
    4. Clean migration history
    5. Follows best practices
```

### Separation of Concerns

```
DATABASE MIGRATIONS (Versioned in Git)
├── Schema definitions (tables, views, functions)
├── RLS policies
├── Indexes
└── Initial data (non-sensitive)

ENVIRONMENT CONFIGURATION (NOT in Git)
├── Database passwords
├── API keys
├── Webhook secrets
├── Encryption keys
└── Third-party credentials
```

### The 12-Factor App Model

From https://12factor.net/:

```
⭐ RULE: Store secrets in environment, not code
├── Why: Secret rotation without code changes
├── Why: Different per environment (dev/staging/prod)
├── Why: Never in version control
└── Why: Flexible deployment across platforms
```

---

## 🔒 VAULT SECURITY DETAILS

### How Supabase Vault Works

```sql
-- User inserts secret via CLI
supabase secrets set MY_KEY=my_value

-- Supabase encrypts and stores in vault.secrets
SELECT * FROM vault.secrets;
-- Output (encrypted):
-- id | name   | secret                          | ...
-- 1  | MY_KEY | ENCRYPTED_BLOB_BYTES_12345...  | ...

-- User can view decrypted version (with permission)
SELECT * FROM vault.decrypted_secrets;
-- Output (decrypted):
-- id | name   | secret        | ...
-- 1  | MY_KEY | my_value      | ...

-- But user CANNOT directly INSERT into vault.decrypted_secrets
INSERT INTO vault.decrypted_secrets VALUES (...);
-- ERROR: permission denied for view decrypted_secrets ❌

-- Why?
-- 1. decrypted_secrets is a VIEW, not a table
-- 2. Views are read-only by default
-- 3. Even with permissions, encryption layer prevents it
-- 4. Only vault.create_secret() function properly encrypts
```

### Encryption Guarantees

```
At Rest:
┌──────────────────────────────────────────┐
│ vault.secrets (PostgreSQL table)         │
├──────────────────────────────────────────┤
│ secret: [ENCRYPTED AES-256 CIPHERTEXT]   │
│ key: [Stored in Supabase key management] │
│ algorithm: aes-256-cbc                   │
└──────────────────────────────────────────┘

In Transit:
├── TLS 1.3 encryption (network)
├── HTTPS only (no HTTP)
└── Secrets never logged

Access Control:
├── RLS policies enforce who can read
├── Audit logs track all access
├── Permission denied prevents direct manipulation
└── Functions provide safe API
```

---

## ✅ FIXED MIGRATION FILE

Replace your current migration with this:

```sql
/*
  # Auth Email Webhook Secret Setup

  IMPORTANT: This migration does NOT create the secret itself.
  Secrets are managed via CLI, not migrations, following best practices.

  After running `supabase db push`, set the secret:

    supabase secrets set SEND_EMAIL_HOOK_SECRET=<your_secret_value>

  The secret will be available in Edge Functions:
    const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');

  This separation ensures:
  ✅ Secrets are never in version control
  ✅ Different secrets per environment
  ✅ Easy secret rotation
  ✅ Follows Supabase & 12-factor best practices
*/

BEGIN;

-- Migration complete
-- Secret setup is handled via: supabase secrets set

COMMIT;
```

---

## 🚀 IMPLEMENTATION STEPS

### Step 1: Fix the Migration File

```bash
# Edit the broken migration
cat > supabase/migrations/20260324160000_create_auth_send_email_webhook.sql << 'EOF'
/*
  # Auth Email Webhook Secret Setup

  Secrets are managed via CLI, not migrations.
  After running supabase db push:

    supabase secrets set SEND_EMAIL_HOOK_SECRET=your_secret_value

  Then secrets are available in Edge Functions.
*/

BEGIN;

-- Secrets are managed separately via CLI

COMMIT;
EOF
```

### Step 2: Push the Fixed Migration

```bash
supabase db push
# Should succeed now ✅
```

### Step 3: Set the Secret (Development)

```bash
supabase secrets set SEND_EMAIL_HOOK_SECRET=dev_webhook_secret_12345
```

### Step 4: Set the Secret (Production)

```bash
# Via Supabase Dashboard:
# 1. Go to Project Settings
# 2. Click "Secrets"
# 3. Add new secret
# 4. Name: SEND_EMAIL_HOOK_SECRET
# 5. Value: your_production_secret
# 6. Click Save

# OR via CI/CD environment variables
```

### Step 5: Use in Edge Functions

```typescript
// supabase/functions/YOUR_FUNCTION/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req: Request) => {
  // Access the secret
  const webhookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');

  if (!webhookSecret) {
    return new Response(
      JSON.stringify({ error: 'Secret not configured' }),
      { status: 500 }
    );
  }

  // Use the secret to verify webhook, authenticate, etc.
  console.log('Webhook secret available');

  return new Response(JSON.stringify({ success: true }));
});
```

---

## 🧪 VERIFICATION

### Check Migration Succeeded

```bash
# After: supabase db push
supabase db list
# Should show migration as applied ✅
```

### Check Secret is Set

```bash
# List all secrets
supabase secrets list

# Output:
# Name                         | Value
# SEND_EMAIL_HOOK_SECRET       | dev_webhook_secret_12345
```

### Check Edge Function Can Access

```bash
# Test in browser console or via curl
const response = await fetch('https://YOUR_PROJECT.supabase.co/functions/v1/YOUR_FUNCTION');
// Should work ✅
```

---

## 📚 WHY THIS MATTERS

### Problem This Solves

```
❌ Before:
  - Migration tries to INSERT into vault.decrypted_secrets
  - Permission denied error
  - Deployment blocked
  - Secret visible in migration file (security risk)

✅ After:
  - Migration only contains schema
  - Secrets set separately via CLI
  - Deployment succeeds
  - No secrets in version control
```

### Security Benefits

```
✅ Secrets never in git
✅ Different per environment
✅ Rotatable without code changes
✅ Follows industry best practices
✅ Matches 12-factor app model
✅ Aligns with Supabase recommendations
```

---

## 🎓 REFERENCE: Vault Documentation

**Official Supabase Vault Docs:**
- https://supabase.com/docs/guides/database/vault

**Key Points:**
1. `vault.secrets` - Encrypted storage table
2. `vault.decrypted_secrets` - Read-only decrypted view
3. `vault.create_secret()` - Official function to create secrets
4. `vault.update_secret()` - Update existing secret
5. `vault.read_secret()` - Read secret value

**Never used:**
- Direct INSERT into vault.decrypted_secrets
- Hardcoding secrets in migrations
- Using same secret across environments

---

## ✨ SUMMARY

| Aspect | Solution |
|--------|----------|
| **Problem** | Migration tries INSERT into read-only vault.decrypted_secrets view |
| **Root Cause** | Vault enforces permission model - INSERTs forbidden |
| **Fix** | Remove secret INSERT from migration |
| **Secret Storage** | Use `supabase secrets set` (CLI) instead |
| **Availability** | Secrets available as `Deno.env.get()` in Edge Functions |
| **Security** | Secrets never in version control |
| **Best Practice** | Separation: schema in migrations, config via environment |

---

## ⚡ QUICK CHECKLIST

- [ ] Read this entire document (15 min)
- [ ] Replace migration file (1 min)
- [ ] Run `supabase db push` (2 min)
- [ ] Set secret: `supabase secrets set SEND_EMAIL_HOOK_SECRET=value` (1 min)
- [ ] Verify with `supabase secrets list` (1 min)
- [ ] Test Edge Function can access it (2 min)
- [ ] **DONE** ✅

---

**Status:** Ready to implement ✅
**Risk:** None (migration only)
**Deployment Impact:** Fixes deployment blocker
**Best Practice:** Aligns with industry standards
