# Stripe Connect Implementation - BeatElion

## Overview

BeatElion supports two payment flows:

### 1. **Stripe Connect Flow** (Recommended - Direct to Producer)
- Producer activates Stripe Connect (Express account)
- `stripe_account_id` + `charges_enabled = true`
- Payment split: 80% Producer, 20% Platform
- **Automatic**: Money goes directly to producer account

### 2. **Simple Stripe Flow** (Fallback - Manual Payout)
- Producer has NOT activated Stripe Connect
- `stripe_account_id = NULL` OR `charges_enabled = false`
- Payment goes 100% to platform account
- **Manual**: Support team must process payout separately

---

## Payment Flow Diagram

### Stripe Connect (Active)
```
Client Pays 100€
    ↓
Stripe Platform Account receives 100€
    ↓
Transfer to Producer (80€) + Platform Fee (20€)
    ↓
Producer Account: +80€
Platform Account: +20€ (already in platform account)
```

### Simple Stripe (Fallback)
```
Client Pays 100€
    ↓
Stripe Platform Account receives 100€
    ↓
(No automatic transfer - Manual process required)
    ↓
Support team must:
  1. Calculate producer share: 80€
  2. Transfer via bank/Stripe connect
  3. Update simple_stripe_payments.paid_at
```

---

## Code Flow

### 1. Checkout Creation (create-checkout)

```typescript
// 1. Fetch producer profile
const producerProfile = await db
  .from("user_profiles")
  .select("stripe_account_id, stripe_account_charges_enabled")
  .eq("id", productRow.producer_id)

// 2. Check if Stripe Connect is available
const hasStripeConnect =
  producerProfile?.stripe_account_id &&
  producerProfile?.stripe_account_charges_enabled

// 3. Create Stripe Checkout Session
const sessionParams = {
  mode: "payment",
  ...(hasStripeConnect
    ? {
        // Direct transfer to producer
        "payment_intent_data[transfer_data][destination]": producerProfile.stripe_account_id,
        "payment_intent_data[application_fee_amount]": Math.round(checkoutAmount * 0.2),
      }
    : {
        // Fallback: all money to platform
        // (Manual payout will be required)
      })
}
```

### 2. Webhook Processing (stripe-webhook)

```typescript
// When checkout.session.completed arrives:

if (hasStripeConnect) {
  // Money already transferred by Stripe
  // Just create purchase record
  await db.from("purchases").insert({...})

  // Optional: Track transfer in stripe_transfers table
  await db.from("stripe_transfers").insert({
    transfer_id: session.payment_intent?.charges.data[0]?.transfer?.id,
    amount: producerAmount,
    status: "pending" // Will update when transfer.updated arrives
  })
} else {
  // Fallback: Log payment for manual processing
  await db.from("simple_stripe_payments").insert({
    purchase_id: purchase.id,
    producer_id: productRow.producer_id,
    amount: checkoutAmount,
    producer_amount: Math.round(checkoutAmount * 0.8),
    payment_status: "pending"
  })

  // TODO: Notify support team to process payout
}
```

### 3. Stripe Connect Webhook (stripe-connect-webhook)

```typescript
// When producer completes onboarding or account status changes:
if (event.type === "account.updated") {
  const { charges_enabled, details_submitted } = event.data.object

  await db
    .from("user_profiles")
    .update({
      stripe_account_charges_enabled: charges_enabled,
      stripe_account_details_submitted: details_submitted
    })
    .eq("stripe_account_id", event.data.object.id)
}
```

---

## Critical Fields

### user_profiles
```sql
stripe_account_id                -- Stripe Express account ID (acct_...)
stripe_account_charges_enabled   -- Can receive charges? (true = ready)
stripe_account_details_submitted -- Did producer complete onboarding?
stripe_account_created_at        -- When account was created
```

### stripe_transfers (NEW - for auditing)
```sql
purchase_id                      -- Links to purchase
stripe_account_id               -- Producer's Stripe account
transfer_id                     -- Stripe transfer ID
amount                          -- Amount transferred (cents)
status                          -- 'pending', 'in_transit', 'paid', 'failed'
failure_code                    -- If status = 'failed'
```

### simple_stripe_payments (NEW - for fallback tracking)
```sql
purchase_id                     -- Links to purchase
producer_id                     -- Who should get paid
producer_amount                 -- How much they should receive
payment_status                  -- 'pending', 'needs_connect', 'paid'
paid_at                         -- When support processed payout
```

---

## Fee Calculation

**Always: 80% Producer, 20% Platform**

```
checkoutAmount = 100€
applicationFeeAmount = 100 * 0.2 = 20€
producerAmount = 100 - 20 = 80€

Platform receives: 20€
Producer receives: 80€
```

---

## IMPORTANT: Risks & Gotchas

### ⚠️ Risk 1: Fallback to Simple Stripe
- **When**: Producer hasn't activated Stripe Connect
- **What happens**: Money goes to platform, but producer gets nothing automatically
- **Mitigation**:
  - Support team monitors `simple_stripe_payments` table
  - Must manually process payouts
  - Consider sending push notification to producer to activate Connect

### ⚠️ Risk 2: charges_enabled Becomes False
- **When**: Producer account is suspended (compliance issue, risk, etc.)
- **What happens**: New purchases won't transfer to producer (fallback to simple Stripe)
- **Mitigation**:
  - Webhook updates `stripe_account_charges_enabled` immediately
  - Producer should see alert in dashboard
  - Support team should investigate

### ⚠️ Risk 3: Transfer Failures
- **When**: Stripe fails to transfer money (insufficient reserves, closed account, etc.)
- **What happens**: Money stuck in platform account, producer doesn't get paid
- **Mitigation**:
  - Table `stripe_payout_failures` tracks failures
  - Support team notified to retry or investigate
  - Producer can check `stripe_payout_failures` view

---

## Monitoring & Support

### Queries for Support Team

**Find unpaid simple Stripe payments:**
```sql
SELECT * FROM simple_stripe_payments
WHERE payment_status = 'pending'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at;
```

**Find transfers with failures:**
```sql
SELECT * FROM stripe_transfers
WHERE status = 'failed'
ORDER BY created_at DESC;
```

**Find producers without Connect activated:**
```sql
SELECT id, email, stripe_account_id, stripe_account_charges_enabled
FROM user_profiles
WHERE is_producer_active = true
  AND (stripe_account_id IS NULL OR stripe_account_charges_enabled = false);
```

---

## Testing Checklist

- [ ] Producer successfully completes Stripe Connect onboarding
- [ ] `stripe_account_id` is saved
- [ ] Webhook updates `charges_enabled` correctly
- [ ] Payment with Connect producer → Transfer created
- [ ] Payment with non-Connect producer → Logged in simple_stripe_payments
- [ ] Failed transfer → Logged in stripe_payout_failures
- [ ] Producer can view own transfers
- [ ] Support team can view all transfers & failures

