# AUDIT COMPLET — BEATELION
> Généré le 2026-04-15

---

## 1. ARCHITECTURE ACTUELLE

**Stack technique :**
- Frontend : React + Vite + TypeScript (SPA pure, pas Next.js)
- Routing : react-router-dom v7
- State : Zustand
- Backend : Supabase (Auth + PostgreSQL + Edge Functions + RLS)
- Paiement : Stripe
- Deploy : Vercel
- Protection : hCaptcha + rate limiting + RLS

---

## 2. AUTHENTIFICATION

### Flow actuel

1. `/register` → Edge Function `auth-signup` → hCaptcha vérifié → Supabase `auth.signUp()`
2. `/login` → Edge Function `auth-login` → hCaptcha vérifié → `auth.signInWithPassword()`
3. Email de confirmation → `/email-confirmation` → échange PKCE → session créée
4. Google OAuth → redirect → `/auth/callback` → session

### Gestion de session

- Client Supabase : storage key custom `'sb-levelupmusic-auth'`
- Access token : 15min, auto-refresh via Supabase
- Zustand store (`useAuthStore`) : `user`, `session`, `profile` globaux
- Profile chargé depuis la vue `my_user_profile`

### Rôles utilisateur

```
visitor → user → confirmed_user → producer → admin
```

**Hooks clés** — `src/lib/auth/hooks.ts` :
- `useIsEmailVerified()` → `user.email_confirmed_at`
- `useIsConfirmedUser()` → `profile.is_confirmed`
- `useCanVote()` → confirmed + email vérifié

---

## 3. BASE DE DONNÉES — SCHÉMA

### Tables critiques

**`battles`**
```sql
id, title, slug (UNIQUE), description
producer1_id, producer2_id → user_profiles(id)
product1_id, product2_id  → products(id)
status: pending|pending_acceptance|awaiting_admin|approved|rejected|active|voting|completed|cancelled
starts_at, voting_ends_at
votes_producer1, votes_producer2  -- compteurs dénormalisés
winner_id, featured, prize_description
```

**`battle_votes`**
```sql
id, battle_id, user_id, voted_for_producer_id
UNIQUE (battle_id, user_id)  -- contrainte critique anti-doublon
```

**`battle_vote_feedback`**
```sql
vote_id, battle_id, winner_product_id, user_id, criterion
PRIMARY KEY (vote_id, criterion)
-- Critères : groove, melody, ambience, sound_design, drums, mix, originality, energy, artistic_vibe
```

**`user_profiles`**
```sql
role: visitor|user|confirmed_user|producer|admin
is_confirmed: boolean
engagement_score: integer  -- EXISTE DÉJÀ
is_email_verified (via auth)
```

---

## 4. SYSTÈME DE VOTE — ANALYSE CRITIQUE

### Flow complet

```
Clic vote → BattleVoteFeedbackModal → sélection 1-3 critères
         → supabase.rpc('rpc_vote_with_feedback')
         → RPC atomic (SECURITY DEFINER)
         → Vérifications en cascade
         → INSERT battle_votes + UPDATE battles + INSERT feedback
         → Mise à jour optimiste UI
```

### Vérifications actuelles dans `rpc_vote_with_feedback`

| Check | Implémentation |
|---|---|
| Authentifié | `auth.uid() IS NOT NULL` |
| Email vérifié | `is_email_verified_user(v_user_id)` |
| Compte > 24h | `is_account_old_enough(v_user_id, interval '24h')` |
| Rate limit | 6 votes/minute/user |
| Cooldown | 30 secondes entre votes |
| Battle active | `status = 'active'` et dans fenêtre temporelle |
| Pas participant | producteur1/2 exclus |
| Anti auto-vote | `voted_for_producer_id != auth.uid()` |
| Vote unique/battle | contrainte UNIQUE + check explicite |

### Qui peut voter aujourd'hui ?

Tout utilisateur **authentifié** avec :
- Email vérifié
- Compte de plus de 24h

**Les votes sont-ils pondérés ? NON.** Chaque vote vaut 1. Mais `engagement_score` existe déjà dans `user_profiles`.

### Protection RLS

La RLS exige le flag de config `app.battle_vote_rpc = '1'` — les INSERT directs depuis le client sont **bloqués**. Seul le RPC peut voter.

---

## 5. FRONTEND — COMPOSANTS CLÉS

| Composant | Rôle |
|---|---|
| `src/pages/BattleDetail.tsx` | Page battle par slug, temps réel via Postgres Changes |
| `src/components/battles/VotePanel.tsx` | Boutons vote, checks éligibilité côté client |
| `src/components/battles/BattleVoteFeedbackModal.tsx` | Modal feedback + appel RPC |
| `src/components/battles/CommentsPanel.tsx` | Commentaires |
| `src/components/auth/ProtectedRoute.tsx` | Guard routes auth/producer/admin |

---

## 6. FLOW UTILISATEUR ACTUEL — ÉTAPE PAR ÉTAPE

```
1. Arrivée sur /battles
   → visible sans login (page publique)

2. Clic sur une battle → /battles/:slug
   → page chargée sans login
   → VotePanel affiche "connectez-vous pour voter"

3. Utilisateur s'inscrit → /register
   → hCaptcha → email envoyé → confirm email
   → profil créé avec is_confirmed = false initialement

4. Utilisateur accède à /battles/:slug
   → si email non vérifié → "vérifiez votre email"
   → si account < 24h → bloqué par RPC
   → si confirmed → peut voter

5. Vote
   → sélection critères → RPC atomic
   → update optimiste → temps réel pour les autres
```

---

## 7. IDENTIFICATION DES RISQUES

### 🔴 RISQUES MAJEURS

**R1 — Partage de liens : accès public aux données de battle**
- La page `/battles/:slug` charge des données via le client Supabase avec l'anon key
- Si les RLS sur `battles` et `battle_votes` ne sont pas correctement configurées pour l'accès public, un lien partagé peut crasher ou exposer des données sensibles
- **Vérifier avant tout** : les policies SELECT sur `battles` pour les users non-authentifiés

**R2 — Système de poids des votes : rétrocompatibilité des scores**
- `votes_producer1` et `votes_producer2` sont des compteurs entiers dénormalisés
- Ajouter des poids sans recalculer ces compteurs créera une **incohérence entre les scores affichés et la réalité**
- Tous les affichages de pourcentage dépendent de ces deux colonnes

**R3 — Modification du RPC `rpc_vote_with_feedback`**
- Ce RPC est SECURITY DEFINER et central. Toute erreur de syntaxe SQL le casse entièrement
- Il n'y a pas de fallback — si le RPC échoue, **plus personne ne peut voter**

### 🟠 RISQUES MOYENS

**R4 — `is_confirmed` vs rôles : logique floue**
- `useCanVote()` check `is_confirmed` mais aussi le rôle
- L'ajout d'une condition "vote qualifié" peut entrer en conflit avec cette logique existante si mal intégrée

**R5 — Optimistic update UI**
- `src/pages/BattleDetail.tsx` fait une mise à jour optimiste des compteurs
- Si les compteurs deviennent pondérés, l'optimistic update sera faux (elle incrémente de 1)

**R6 — Partage : état `LaunchControlBypassPaths`**
- `src/App.tsx` a une liste de paths qui bypass le "launch control"
- Un lien partagé vers `/battles/:slug` ne bypass pas → comportement à vérifier

### 🟢 SAFE (modifiable sans danger)

- Ajouter des colonnes nullable aux tables existantes
- Ajouter de nouvelles tables sans toucher aux existantes
- Ajouter de nouvelles Edge Functions
- Créer un nouveau RPC (sans modifier l'existant)
- Modifier `VotePanel` pour afficher de nouvelles informations (sans changer la logique de vote)
- Ajouter des routes nouvelles dans App.tsx

---

## 8. STRATÉGIE D'INTÉGRATION SAFE

---

### FEATURE 1 — PARTAGE DE BATTLES (liens publics)

**Bonne nouvelle** : `/battles/:slug` existe déjà et est probablement accessible sans login (SPA publique). La page charge déjà les données battle.

**Ce qu'il faut faire :**

1. **Vérifier la RLS sur `battles`** pour les users non-auth :
   ```sql
   -- Ajouter si absent :
   CREATE POLICY "Public battles are viewable by everyone"
   ON public.battles FOR SELECT
   TO anon
   USING (status IN ('active', 'voting', 'completed'));
   ```

2. **Vérifier la RLS sur `battle_votes`** (pour afficher les compteurs publiquement) — les colonnes `votes_producer1/2` sont sur la table `battles` donc ce n'est probablement pas un problème.

3. **Générer l'URL de partage** côté frontend uniquement :
   ```typescript
   const shareUrl = `${window.location.origin}/battles/${battle.slug}`;
   ```
   Pas de migration, pas de risque.

4. **Bouton "Partager"** : ajouter sur la page BattleDetail, afficher l'URL + Open Graph meta tags.

**Non destructif :** Cette feature ne touche pas au flow de vote ni à l'auth.

---

### FEATURE 2 — VOTE QUALIFIÉ (conditions supplémentaires)

**Approche recommandée : ajouter des checks dans le RPC existant via une fonction helper dédiée.**

**Définir "utilisateur qualifié"** (options) :
- A. `engagement_score >= seuil` (colonne existe déjà)
- B. A voté sur X battles précédentes
- C. A un compte confirmé depuis N jours

**Implémentation safe :**

1. Ajouter une **fonction helper** dans Supabase :
   ```sql
   CREATE OR REPLACE FUNCTION is_qualified_voter(p_user_id uuid)
   RETURNS boolean
   LANGUAGE sql SECURITY DEFINER AS $$
     SELECT engagement_score >= 10  -- seuil à définir
     FROM user_profiles WHERE id = p_user_id;
   $$;
   ```

2. Ajouter le check dans `rpc_vote_with_feedback` **en dessous des checks existants** :
   ```sql
   IF NOT is_qualified_voter(v_user_id) THEN
     RETURN jsonb_build_object('error', 'not_qualified_voter');
   END IF;
   ```

3. Ajouter le message d'erreur dans `BattleVoteFeedbackModal.tsx` (map d'erreurs existante lignes 30-56).

4. Mettre à jour `useCanVote()` dans `src/lib/auth/hooks.ts` pour afficher le bon message avant même que le modal s'ouvre.

**Point critique :** Définir la logique dans une fonction SQL séparée permet de la modifier sans retoucher le RPC principal.

---

### FEATURE 3 — POIDS DES VOTES

**C'est la feature la plus risquée.** Voici l'approche non-destructive :

**Option A (recommandée) — Score pondéré calculé, compteurs raw inchangés :**

1. **Ne pas toucher** à `votes_producer1` / `votes_producer2` (continuent de compter les votes bruts)

2. Ajouter une colonne `vote_weight` dans `battle_votes` :
   ```sql
   ALTER TABLE battle_votes ADD COLUMN vote_weight numeric DEFAULT 1.0;
   ```

3. Créer une fonction pour le score pondéré :
   ```sql
   CREATE OR REPLACE FUNCTION get_battle_weighted_scores(p_battle_id uuid)
   RETURNS TABLE(producer1_score numeric, producer2_score numeric)
   LANGUAGE sql AS $$
     SELECT
       COALESCE(SUM(CASE WHEN v.voted_for_producer_id = b.producer1_id THEN v.vote_weight ELSE 0 END), 0),
       COALESCE(SUM(CASE WHEN v.voted_for_producer_id = b.producer2_id THEN v.vote_weight ELSE 0 END), 0)
     FROM battles b
     LEFT JOIN battle_votes v ON v.battle_id = b.id
     WHERE b.id = p_battle_id;
   $$;
   ```

4. Dans le RPC `rpc_vote_with_feedback`, calculer et stocker le poids au moment du vote :
   ```sql
   v_weight := get_user_vote_weight(v_user_id);  -- nouvelle fonction
   INSERT INTO battle_votes (..., vote_weight) VALUES (..., v_weight);
   ```

5. L'affichage frontend reste compatible : utiliser les compteurs bruts pour l'ordre de grandeur, ajouter optionnellement les scores pondérés en parallèle.

**Rétrocompatibilité :** Les votes existants gardent `vote_weight = 1.0` (valeur DEFAULT), donc les scores pondérés actuels sont identiques aux scores bruts. Pas de régression.

---

## 9. PLAN D'IMPLÉMENTATION SAFE

### Étape 1 — PARTAGE (risque : quasi nul)

- [ ] Vérifier les policies RLS SELECT sur `battles` pour `anon`
- [ ] Ajouter bouton "Copier le lien" sur BattleDetail
- [ ] Ajouter meta tags Open Graph dans l'index HTML (ou dynamiquement)
- [ ] Tester : accès `/battles/:slug` sans être connecté

**Testable seul, rollback = supprimer le bouton.**

---

### Étape 2 — VOTE QUALIFIÉ (risque : faible si via fonction helper)

- [ ] Définir précisément les critères de qualification
- [ ] Créer la fonction SQL `is_qualified_voter()` (nouvelle, sans modifier l'existant)
- [ ] Tester la fonction en isolation sur quelques user_ids
- [ ] Ajouter le check dans `rpc_vote_with_feedback` (1 bloc IF/RETURN)
- [ ] Ajouter le message d'erreur dans le frontend
- [ ] Mettre à jour `useCanVote()` pour l'affichage UI

**Testable seul : activer uniquement avec un seuil à 0 pour valider le flow sans bloquer personne.**

---

### Étape 3 — POIDS DES VOTES (risque : moyen, isolé)

- [ ] `ALTER TABLE battle_votes ADD COLUMN vote_weight numeric DEFAULT 1.0`
- [ ] Créer `get_user_vote_weight()` et `get_battle_weighted_scores()`
- [ ] Mettre à jour le RPC pour stocker le poids
- [ ] Ajouter l'affichage du score pondéré sur BattleDetail (champ distinct du compteur brut)
- [ ] Définir la logique de calcul du poids (`engagement_score` ? historique de votes ? achats ?)

**Testable seul : démarrer avec weight = 1.0 pour tous → résultats identiques à aujourd'hui.**

---

## 10. TESTS & MONITORING

### Avant déploiement

```
□ Accès /battles/:slug sans login → page charge
□ Vote avec un compte < 24h → message d'erreur correct
□ Vote deux fois sur la même battle → bloqué
□ Producteur participant → bouton vote masqué
□ Double clic rapide sur "Voter" → un seul vote enregistré
□ Vérifier la vue my_user_profile après vote pour engagement_score
```

### Métriques à surveiller

- Taux d'erreur sur `rpc_vote_with_feedback` (Sentry est déjà configuré)
- Nombre de votes par battle avant/après le déploiement
- Ratio `qualified_voters / total_voters` après activation du vote qualifié
- Conversions depuis les liens partagés (nouveau traffic → inscription)

### Rollback

- **Partage** : supprimer le bouton frontend, aucune DB modifiée
- **Vote qualifié** : retirer le bloc IF dans le RPC, ou passer le seuil à 0
- **Poids des votes** : la colonne `vote_weight` est nullable avec DEFAULT 1.0, pas de rollback nécessaire — l'affichage pondéré peut être désactivé côté frontend

---

## 11. QUESTIONS À TRANCHER AVANT IMPLÉMENTATION

1. **Qu'est-ce qu'un votant "qualifié" concrètement ?**
   - Nombre de battles votées ?
   - Score d'engagement ?
   - Ancienneté du compte ?
   - Achat(s) sur la plateforme ?

2. **Comment le poids est-il calculé ?**
   - Linéaire sur `engagement_score` ?
   - Tiers (niveau 1/2/3) ?
   - Plafonné à un maximum pour éviter les super-votants ?

3. **Les votes passés sont-ils repondérés rétroactivement ?**
   - Si oui → migration lourde, attention aux battles déjà terminées
   - Si non → poids = 1.0 sur l'historique, nouveau système sur les futures battles

---

## 12. LOCALISATION DES FICHIERS CRITIQUES

| Fichier | Rôle |
|---|---|
| `src/lib/auth/store.ts` | État global auth (Zustand) |
| `src/lib/auth/hooks.ts` | `useCanVote`, `useIsConfirmedUser`, etc. |
| `src/lib/auth/service.ts` | Appels Supabase Auth |
| `src/lib/supabase/client.ts` | Initialisation client Supabase |
| `src/lib/supabase/types.ts` | Types TypeScript (UserProfile, Battle, etc.) |
| `src/pages/BattleDetail.tsx` | Page battle, real-time, vote optimiste |
| `src/pages/Battles.tsx` | Liste des battles |
| `src/components/battles/VotePanel.tsx` | Checks éligibilité côté client |
| `src/components/battles/BattleVoteFeedbackModal.tsx` | Appel RPC vote + feedback |
| `src/components/auth/ProtectedRoute.tsx` | Guards de navigation |
| `src/App.tsx` | Router principal, LaunchControlBypassPaths |
| `supabase/migrations/20260306120000_142_atomic_vote_with_feedback.sql` | RPC vote atomic (CRITIQUE) |
| `supabase/migrations/20260221140000_034_secure_battles_vote_rpc_and_execute.sql` | RPC vote legacy |
| `supabase/migrations/20260125151124_004_create_battles_schema.sql` | Schéma initial battles |
| `supabase/functions/auth-signup/index.ts` | Inscription + hCaptcha |
| `supabase/functions/auth-login/index.ts` | Login + hCaptcha |
