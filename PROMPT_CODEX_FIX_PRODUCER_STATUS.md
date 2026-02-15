# Prompt Codex - Corriger le statut producteur qui ne change pas après validation du paiement

## 🔍 Contexte du problème

**Problème** : Après la validation d'un paiement Stripe (webhook `invoice.payment_succeeded`), le champ `is_producer_active` dans `user_profiles` et `producer_subscriptions` ne se mettent pas à jour.

**Fichier principal** : `supabase/functions/stripe-webhook/index.ts`

**Tables concernées** :
- `producer_subscriptions` (id, user_id, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, is_producer_active)
- `user_profiles` (id, stripe_customer_id, stripe_subscription_id, is_producer_active)
- `stripe_events` (id, type, processed, error, data)

**Migrations pertinentes** :
- `20260126201500_010_producer_subscription_single_plan.sql` : table `producer_subscriptions` + triggers pour synchroniser `is_producer_active`

---

## 📋 Checklist d'analyse à effectuer

1. **Vérifier le webhook `invoice.payment_succeeded`** :
   - Le `customerId` est-il présent dans le payload Stripe ?
   - Le `subscriptionId` est-il null ou vide ?
   - L'utilisateur est-il trouvé via `stripe_customer_id` dans `user_profiles` ?

2. **Vérifier l'appel `upsertProducerSubscriptionFromStripe`** :
   - La requête fetch vers Stripe API retourne-t-elle correctement le subscription ?
   - Les champs `status`, `current_period_end`, `customer` sont-ils présents et valides ?

3. **Vérifier la fonction `upsertProducerSubscription`** :
   - La recherche par `stripe_customer_id` trouve-t-elle l'utilisateur ?
   - Si oui, l'upsert dans `producer_subscriptions` réussit-il ? (vérifier `error` retourné)
   - Le trigger `set_producer_subscription_flags` calcule-t-il correctement `is_producer_active` ?
     - Condition : `subscription_status IN ('active','trialing') AND current_period_end > now()`
   - Le trigger `sync_user_profile_producer_flag` propage-t-il la mise à jour à `user_profiles` ?

4. **Vérifier dans Supabase** :
   - Aller à SQL editor et exécuter :
     ```sql
     SELECT * FROM stripe_events 
     WHERE type = 'invoice.payment_succeeded' 
     ORDER BY created_at DESC LIMIT 5;
     ```
   - Regarder le champ `error` : s'il n'est pas null, c'est l'erreur qui bloque.
   - Vérifier si `processed = true` et `processed_at` sont remplis (webhook a tournée).
   - Vérifier le contenu de `data` : voir les détails du payload Stripe.

5. **Vérifier les logs de la fonction** :
   - Dashboard Supabase → Functions → `stripe-webhook` → Logs
   - Chercher les erreurs lors de l'appel à `upsertProducerSubscriptionFromStripe`.

---

## 🛠️ Points critiques à corriger potentiellement

### Issue 1 : `stripe_customer_id` manquant en `user_profiles`
**Symptôme** : `upsertProducerSubscription` ne trouve pas l'utilisateur.

**Solution** :
- Dans `handleCheckoutCompleted` (abonnement producteur), s'assurer que `stripe_customer_id` est lié à l'utilisateur AVANT de faire l'upsert.
- Ou, dans `upsertProducerSubscription`, améliorer le fallback pour matcher l'utilisateur même sans metadata.

### Issue 2 : Timestamp `current_period_end` en secondes (Unix) au lieu de ISO
**Symptôme** : Stripe retourne `current_period_end` en secondes Unix (ex: 1707235200), mais faut convertir en ISO pour la comparaison `> now()`.

**Vérifier** :
```typescript
const currentEndIso = currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : new Date().toISOString();
```
Cette ligne est présente mais s'assurer que `currentPeriodEnd` est bien un nombre (pas une string).

### Issue 3 : `subscription_status` pas dans la liste whitelist
**Symptôme** : Stripe retourne un status (ex: `past_due`, `incomplete`) qui n'est pas `active` ou `trialing`.

**Vérifier** :
```sql
SELECT subscription_status FROM producer_subscriptions 
WHERE user_id = '<USER_UUID>';
```
Si le status est `past_due` → `is_producer_active` sera false même si `current_period_end` est valide.

### Issue 4 : Trigger de synchronisation n'est pas déclenché
**Symptôme** : Upsert dans `producer_subscriptions` réussit mais `user_profiles.is_producer_active` ne change pas.

**Cause probable** : Le trigger `sync_user_profile_producer_flag` ne s'exécute pas ou échoue silencieusement.

**Solution** : Ajouter un `ON CONFLICT DO UPDATE` explicite dans l'upsert pour garantir l'UPDATE et le déclenchement du trigger.

---

## 🔧 Corrections recommandées pour `index.ts`

### 1. Ajouter des logs détaillés dans `handlePaymentSucceeded`
```typescript
async function handlePaymentSucceeded(...) {
  const customerId = invoice.customer as string;
  const subscriptionId = invoice.subscription as string;

  console.log(`[handlePaymentSucceeded] customerId=${customerId}, subscriptionId=${subscriptionId}`);

  if (!subscriptionId) {
    console.warn(`[handlePaymentSucceeded] No subscriptionId in invoice, skipping`);
    return;
  }

  // ... reste du code
}
```

### 2. Ajouter des logs dans `upsertProducerSubscriptionFromStripe`
```typescript
async function upsertProducerSubscriptionFromStripe(...) {
  console.log(`[upsertProducerSubscriptionFromStripe] Fetching subscription: ${subscriptionId}`);
  
  const resp = await fetch(...);
  const sub = await resp.json();
  
  if (!resp.ok || sub.error) {
    console.error(`[upsertProducerSubscriptionFromStripe] Stripe API error:`, sub);
    return;
  }

  console.log(`[upsertProducerSubscriptionFromStripe] Stripe subscription:`, {
    customer: sub.customer,
    status: sub.status,
    current_period_end: sub.current_period_end,
    metadata: sub.metadata,
  });

  await upsertProducerSubscription(supabase, { ... });
}
```

### 3. Ajouter des logs dans `upsertProducerSubscription`
```typescript
async function upsertProducerSubscription(...) {
  const { customerId, subscriptionId, status, currentPeriodEnd, ... } = params;

  console.log(`[upsertProducerSubscription] Params:`, params);

  // Recherche par stripe_customer_id
  let { data: profile } = await supabase
    .from("user_profiles")
    .select("id, stripe_customer_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  console.log(`[upsertProducerSubscription] Found profile by customerId=${customerId}:`, profile);

  // Fallback via userId
  if (!profile && userId) {
    const { data: profileById } = await supabase
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();

    console.log(`[upsertProducerSubscription] Fallback by userId=${userId}:`, profileById);
    // ... reste du fallback
  }

  if (!profile) {
    console.error(`[upsertProducerSubscription] No user found for customerId=${customerId}, userId=${userId}`);
    return;
  }

  const isActive = ["active", "trialing"].includes(status) && new Date(currentEndIso) > new Date();
  console.log(`[upsertProducerSubscription] Computed isActive=${isActive} (status=${status}, periodEnd=${currentEndIso})`);

  const { error } = await supabase
    .from("producer_subscriptions")
    .upsert({ ... }, { onConflict: "user_id" });

  if (error) {
    console.error(`[upsertProducerSubscription] Upsert error:`, error);
  } else {
    console.log(`[upsertProducerSubscription] Upsert success for user_id=${profile.id}`);
  }
}
```

### 4. S'assurer que l'upsert utilise `onConflict` pour forcer l'UPDATE
```typescript
const { error } = await supabase
  .from("producer_subscriptions")
  .upsert({
    user_id: profile.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    subscription_status: status,
    current_period_end: currentEndIso,
    cancel_at_period_end: cancelAtPeriodEnd ?? false,
    is_producer_active: isActive,
  }, { onConflict: "user_id" }); // Important : force l'UPDATE sur la clé UNIQUE
```

---

## 📝 Commandes de diagnostic dans Supabase SQL Editor

Exécutez ces requêtes pour identifier le problème :

```sql
-- 1. Voir les 10 derniers webhooks invoice.payment_succeeded
SELECT id, type, processed, error, created_at, data->>'customer' as customer_id
FROM stripe_events
WHERE type = 'invoice.payment_succeeded'
ORDER BY created_at DESC
LIMIT 10;

-- 2. Voir les abonnements producteur et leur status
SELECT 
  ps.user_id, 
  ps.stripe_customer_id, 
  ps.subscription_status, 
  ps.current_period_end, 
  ps.is_producer_active,
  up.stripe_customer_id as profile_stripe_customer_id,
  up.is_producer_active as profile_is_producer_active
FROM producer_subscriptions ps
LEFT JOIN user_profiles up ON ps.user_id = up.id
ORDER BY ps.created_at DESC
LIMIT 10;

-- 3. Vérifier si les triggers existent et sont actifs
SELECT trigger_name, event_object_table, action_statement
FROM information_schema.triggers
WHERE event_object_table IN ('producer_subscriptions', 'user_profiles');

-- 4. Tester manuellement le trigger en mettant à jour un abonnement
UPDATE producer_subscriptions
SET subscription_status = 'active', current_period_end = now() + interval '30 days'
WHERE user_id = '<USER_UUID>'
RETURNING id, is_producer_active;

-- 5. Vérifier que la sync s'est faite dans user_profiles
SELECT id, is_producer_active, updated_at
FROM user_profiles
WHERE id = '<USER_UUID>';
```

---

## ✅ Étapes pour déployer la fix

1. Ajouter les logs détaillés dans `supabase/functions/stripe-webhook/index.ts`
2. Exécuter les commandes SQL de diagnostic dans Supabase
3. Déployer la fonction : `supabase functions deploy stripe-webhook`
4. Déclencher un nouveau webhook de test (depuis Stripe dashboard ou Postman)
5. Regarder les logs et les données dans `stripe_events`
6. Vérifier que `is_producer_active` passe à `true` dans `producer_subscriptions` et `user_profiles`

---

## 🎯 Résumé

**À corriger** :
- [ ] Ajouter logs dans `handlePaymentSucceeded`, `upsertProducerSubscriptionFromStripe`, `upsertProducerSubscription`
- [ ] S'assurer que `stripe_customer_id` est lié à l'utilisateur avant l'upsert (handle checkout)
- [ ] Vérifier que `onConflict: "user_id"` est utilisé dans l'upsert
- [ ] Vérifier dans Supabase que les triggers `set_producer_subscription_flags` et `sync_user_profile_producer_flag` existent et sont actifs
- [ ] Exécuter les requêtes SQL de diagnostic pour isoler le problème
