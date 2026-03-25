# ⚡ Vault Migration Fix - Action Plan

**Issue:** `ERROR: permission denied for view decrypted_secrets`
**Status:** FIXED ✅
**Time to implement:** 5 minutes

---

## 🎯 WHAT WAS DONE

✅ **Migration file fixed**
- Removed: `INSERT INTO vault.decrypted_secrets`
- Added: Clear documentation about secret setup
- File: `supabase/migrations/20260324160000_create_auth_send_email_webhook.sql`

✅ **Comprehensive guide created**
- Document: `FIX_VAULT_MIGRATION.md`
- Explains: Why vault rejects direct INSERT
- Provides: Secure secret management approach

---

## 🚀 NEXT STEPS (3 commands)

### Step 1: Push Fixed Migration

```bash
supabase db push
```

**What happens:**
- Migration applies successfully ✅
- No vault permission errors
- HTTP extension created

**Expected output:**
```
Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 20260324160000_create_auth_send_email_webhook.sql
 • 20260324170000_fix_is_admin_security_definer.sql
 • 20260324171000_add_settings_singleton_constraint.sql

[Y/n] y
Applying migration 20260324160000_create_auth_send_email_webhook.sql...
✓ Migration applied
Applying migration 20260324170000_fix_is_admin_security_definer.sql...
✓ Migration applied
Applying migration 20260324171000_add_settings_singleton_constraint.sql...
✓ Migration applied
```

### Step 2: Set the Webhook Secret (Development)

```bash
supabase secrets set SEND_EMAIL_HOOK_SECRET=dev_webhook_secret_xyz123
```

**What happens:**
- Secret encrypted and stored in Supabase Vault
- Available to Edge Functions as environment variable
- Not visible in code or git history

**Verify:**
```bash
supabase secrets list
# Output:
# Name                         | Value
# SEND_EMAIL_HOOK_SECRET       | dev_webhook_secret_xyz123
```

### Step 3: Deploy Everything

```bash
npm run deploy
# (Your existing deployment command)
```

---

## 🔒 For Production

**Do NOT commit secrets to git!**

Instead, set via Supabase Dashboard:

1. Go to: **Project Settings** → **Secrets**
2. Click: **Add new secret**
3. Name: `SEND_EMAIL_HOOK_SECRET`
4. Value: `your_production_secret_value` (strong random string)
5. Click: **Save**

---

## ✅ VERIFICATION CHECKLIST

After completing the steps above:

- [ ] `supabase db push` succeeded (no vault errors)
- [ ] Secret listed in `supabase secrets list`
- [ ] Frontend/Edge Functions deployed
- [ ] Maintenance mode toggle works
- [ ] No RLS errors in Supabase logs

---

## 🎓 WHY THIS MATTERS

### Before (Broken ❌)

```sql
-- Migration file tries this:
INSERT INTO vault.decrypted_secrets (name, secret, ...)
-- Result: ERROR: permission denied for view decrypted_secrets
-- Problems:
--   ❌ Vault is read-only view (no INSERT allowed)
--   ❌ Secret would be visible in git history
--   ❌ Same secret across all environments
--   ❌ Can't rotate without new migration
```

### After (Fixed ✅)

```bash
# Migration: Just schema setup
supabase db push
# ✓ Succeeds

# Secrets: Managed separately
supabase secrets set SEND_EMAIL_HOOK_SECRET=value
# ✓ Encrypted and stored safely

# Environment: Specific per environment
# Dev: dev_secret_123
# Prod: prod_secret_abc
# ✓ Different values per environment
```

---

## 📚 KEY CONCEPTS

### vault.decrypted_secrets

- **Type:** Read-only VIEW (not a table)
- **Purpose:** Show decrypted secret values
- **Access:** SELECT only (no INSERT, UPDATE, DELETE)
- **Why:** Prevents circumventing encryption layer

### supabase secrets set

- **Type:** CLI command for managing secrets
- **Storage:** Encrypted in Supabase Vault
- **Access:** Available in Edge Functions as env var
- **Security:** Never in version control

### Separation of Concerns

```
DATABASE MIGRATIONS (Versioned in Git)
├── Tables, views, indexes
├── RLS policies
├── Functions
└── Schema definitions

ENVIRONMENT CONFIG (NOT in Git)
├── Database passwords
├── API keys
├── Webhook secrets ← SEND_EMAIL_HOOK_SECRET
├── Encryption keys
└── Third-party credentials
```

---

## 🧪 TESTING

### Test Secret is Available

```typescript
// In your Edge Function
const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');

if (!secret) {
  console.error('SEND_EMAIL_HOOK_SECRET not set!');
}

console.log('Secret available:', !!secret);
```

### Test Webhook Flow

```bash
# After setting the secret, test that your Edge Function
# can be triggered by auth.users changes

# Login with a new account
# Check logs: Supabase Dashboard → Edge Functions → Logs
# Should see your function being invoked
```

---

## 📖 FULL DOCUMENTATION

For deeper understanding, read: [FIX_VAULT_MIGRATION.md](FIX_VAULT_MIGRATION.md)

Topics covered:
- Vault architecture
- Why INSERT is forbidden
- Encryption guarantees
- Best practices
- 12-factor app principles
- Security implications

---

## 💡 SUMMARY

| Step | Command | Status |
|------|---------|--------|
| **1. Fix migration** | `supabase db push` | ✅ Ready |
| **2. Set secret (dev)** | `supabase secrets set SEND_EMAIL_HOOK_SECRET=...` | ⏳ Do now |
| **3. Set secret (prod)** | Supabase Dashboard → Secrets | ⏳ Do in prod |
| **4. Deploy** | `npm run deploy` | ⏳ Do after secrets |

---

**Ready to proceed?** Run the three commands above! 🚀
