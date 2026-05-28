# 📋 AUDIT & PLAN — Système de feedback automatisé post-battle

**Projet** : Beatelion
**Auteur** : Audit Claude (Opus 4.7, 1M context)
**Date** : 2026-05-24
**Statut** : Diagnostic + Plan d'implémentation — AUCUNE LIGNE DE CODE ÉCRITE
**Source data** : 5 audits parallèles (DB battles, emails, admin/modération, infra/scaling, docs LT) + requêtes prod read-only

---

## 0. TL;DR exécutif (lisez ça si vous lisez rien d'autre)

1. **L'infra est prête à 80%**. Le pipeline `event_outbox → process-outbox → email_queue → process-email-queue → Resend` existe, est documenté ([docs/email-event-architecture.md](docs/email-event-architecture.md)) et tourne déjà pour 11 templates transactionnels. Réutiliser, ne pas refaire.
2. **3 bloquants opérationnels à corriger AVANT toute nouvelle feature** :
   - Le cron prod `agent-finalize-expired-battles` est cassé (URL avec placeholder `<STAGING_PROJECT_REF>` non substitué) → les battles ne se finalisent probablement jamais en prod, donc aucun feedback ne pourrait partir.
   - Les jobs cron `process-email-queue`, `process-outbox`, `process-events` sont **absents de la prod** malgré la migration 175 qui devait les créer → l'email queue n'est pas drainée.
   - Aucune CI GitHub Actions, couverture tests battles < 5% → ajouter du code critique sans garde-fou est risqué.
3. **La prod est vide** (0 battles, 0 votes, 12 users, 25 emails de log). Bonne nouvelle : pas de migration de données à craindre. Mauvaise : aucune mesure historique pour calibrer les seuils (anti-spam 15 char, prioritisation, etc).
4. **Architecture cible recommandée** : un nouvel `event_type = BATTLE_COMPLETED` publié par trigger DB sur transition `status → 'completed'` (couvre les égalités, contrairement à `BATTLE_WON` qui ne se déclenche que si `winner_id IS NOT NULL`), consommé par un nouveau handler `battle_feedback_email` dans `process-events`. Le score qualité (`battle_quality_snapshots`) doit être calculé **avant** le rendu de l'email — soit dans `private.finalize_battle()`, soit dans le handler email.
5. **Délais réalistes pour les 4 phases** (un dev solo, à temps partiel) :
   - Phase 1 (Stats) : **3-5 jours**
   - Phase 2 (Growth Report auto) : **8-12 jours**
   - Phase 3 (Curated admin queue) : **10-15 jours**
   - Phase 4 (Signature vocale) : **6-10 jours**
   - + Prérequis bloquants : **2-4 jours**
   - **TOTAL : ~7 à 10 semaines en sprint serré, ~3 mois en pratique part-time**

---

## PHASE 1 — RAPPORT D'AUDIT (état des lieux)

### 1.1 Stack technique observée

| Couche | Détail |
|---|---|
| Frontend | React 18 + Vite 7 + TS + Tailwind 3 + Zustand + React Query + react-router-dom 7 (SPA pure, pas Next.js) |
| Backend | Supabase (Postgres + Auth + Edge Functions Deno + Storage 3 buckets) — projet prod `ftcyybcbaqxyrombfmqp` (eu-west-1), staging `haebgsnncuikvfgivxwk` (eu-west-3) |
| Workers | `audio-worker/` (Docker, Node 20, polling) sur Render (single instance, pas d'autoscale) — pointe directement sur prod |
| API externe | `api/` Vercel Functions (Node classique, pas Fluid Compute) — 3 endpoints contracts |
| Service séparé | `contract-service/` (Express, génération PDF) sur Render |
| Mail | **Resend uniquement** (`Beatelion <contact@beatelion.com>`) |
| Observabilité | Sentry partout (`@sentry/deno`, `@sentry/node`), pas de Logflare/Datadog |
| Tests | Cypress E2E + `node --test`. **Pas de Vitest/Jest**. Couverture battles **< 5%** |
| CI | **Aucune.** Pas de `.github/workflows/`. Deploy manuel via `deploy-prod.sh` / `deploy-staging.sh` |
| Migrations | **377** fichiers SQL dans `supabase/migrations/`. Dernière : `20260524160000_235_battle_pair_active_and_cooldown_limits.sql` |
| i18n | 4 langues `fr/en/de/es`. fr = source de vérité, typage `NestedKeyOf<typeof fr>` ([src/lib/i18n/index.ts](src/lib/i18n/index.ts)) |

### 1.2 Modèle de données battles & votes

**Table `battles`** ([supabase/migrations/20260125151124_004_create_battles_schema.sql:63-84](supabase/migrations/20260125151124_004_create_battles_schema.sql#L63-L84)) — 27 colonnes en prod, key fields :
- `producer1_id` / `producer2_id` (uuid → user_profiles)
- `product1_id` / `product2_id` (uuid → products)
- `status` : enum **9 valeurs** (pas 8 comme la mémoire le disait) — `pending, active, voting, completed, cancelled, pending_acceptance, rejected, awaiting_admin, approved`
- `battle_type` enum : `user | admin`
- `winner_id` (nullable — `NULL` si égalité parfaite)
- `votes_producer1` / `votes_producer2` (dénormalisés)
- `starts_at, voting_ends_at, response_deadline, accepted_at, rejected_at, admin_validated_at`
- **Pas de `completed_at`** (utiliser `voting_ends_at` ou `updated_at`)
- **Pas de notion de "battle finale" / "title match"** → à créer si nécessaire pour le niveau Signature

**Table `battle_votes`** ([supabase/migrations/20260125151124_004_create_battles_schema.sql:87-95](supabase/migrations/20260125151124_004_create_battles_schema.sql#L87-L95)) :
- `id, battle_id, user_id, voted_for_producer_id, created_at`
- UNIQUE `(battle_id, user_id)`
- **Aucun commentaire dans cette table** — c'est binaire

**Table `battle_vote_feedback`** ([supabase/migrations/20260306100000_137_battle_vote_feedback_and_preferences.sql](supabase/migrations/20260306100000_137_battle_vote_feedback_and_preferences.sql)) — **C'est ici qu'est la richesse qualitative** :
- `vote_id, battle_id, winner_product_id, user_id, criterion text`
- Vocabulaire fermé 9 critères : `groove, melody, ambience, sound_design, drums, mix, originality, energy, artistic_vibe`
- Max 3 critères par vote
- **Pas de texte libre dans le feedback** — uniquement des tags

**Table `battle_comments`** ([004:98-108](supabase/migrations/20260125151124_004_create_battles_schema.sql#L98-L108)) :
- `content` text CHECK ≤ 1000 chars
- Modération : `is_hidden`, `hidden_reason`
- Threading via `parent_id`
- Trigger AI : `trg_process_ai_comment_moderation` auto-classify safe/borderline/toxic/spam, auto-hide si score ≥ 0.95
- **Attachés à la battle, pas au vote** → ne portent pas naturellement de critique d'un beat précis

**Table `battle_quality_snapshots`** (Migrations 138-139) — **Or pur pour le feedback** :
- `votes_total, votes_for_product, win_rate, preference_score` (lissage Laplace)
- `artistic_score` (somme pondérée des critères)
- `coherence_score` (= 0 si < 5 feedbacks distincts)
- `credibility_score` (constante 50 actuellement)
- `quality_index` (0.45×pref + 0.30×artistic + 0.15×coherence + 0.10×credibility)
- `meta` jsonb (poids, top_share, weighted_share)

**Lifecycle complet** :
```
[rpc_create_battle] → pending_acceptance
    → (respond_to_battle accept) → pending → awaiting_admin
        → (admin_validate_battle) → approved
            → (producer_start_battle_voting) → voting
                → (voting_ends_at < now() + cron */15min) → completed
                                                              └─ winner_id calculé
                                                              └─ triggers AFTER UPDATE x3
                                                              └─ event_outbox 'BATTLE_WON' (si winner_id NOT NULL)
```

**Hooks de clôture déjà existants** (à brancher dessus, pas à recréer) :
- `trg_battle_completed_reputation` → update reputation
- `trg_battle_completed_competitive` → Elo + badges
- `on_battle_winner_publish_event` → outbox `BATTLE_WON` (**limitation** : ne se déclenche pas en cas d'égalité car `winner_id IS NULL`)
- `event_outbox` + `event_handlers` mapping table → consommé par `process-events` edge function

### 1.3 Système email — état réel

**Architecture documentée et FIABLE** ([docs/email-event-architecture.md](docs/email-event-architecture.md)) :
```
table métier → publish_event() → event_outbox (source de vérité, dedupe via dedupe_key)
                                       ↓
                               process-outbox (edge fn)
                                       ↓
                                 event_bus (compat)
                                       ↓
                              process-events (edge fn, dispatch via event_handlers)
                                       ↓
                                 email_queue (state machine pending/processing/sent/failed)
                                       ↓
                              process-email-queue (edge fn, batch 20, Resend)
                                       ↓
                                    Resend API
```

**11 templates déjà en place** ([supabase/functions/_shared/emailTemplates.ts:1-12](supabase/functions/_shared/emailTemplates.ts#L1-L12)) : `confirm_account, welcome_user, producer_activation, purchase_receipt, license_ready, battle_won, battle_invitation, battle_awaiting_admin, comment_received, contact_reply, contact_admin_notification`.

**11 Edge Functions email** : `process-email-queue, process-outbox, process-events, repair-email-delivery, auth-send-email, broadcast-news, join-waitlist, accept-waitlist-entry, send-waitlist-campaign, contact-submit, admin-reply-contact-message`.

**Garde-fous existants** :
- Trigger DB qui bloque tout insert dans `email_queue` sans `source_event_id` ou `source_outbox_id` → impossible de bypasser le pipeline
- Idempotence via `dedupe_key` outbox + UNIQUE `source_event_id` sur email_queue
- Singletons (`confirm_account, welcome_user, producer_activation`) uniques par `(user_id, template)` ; repeatables (`purchase_receipt, license_ready, battle_won, comment_received`) autorisés multi
- Marketing guardrails : domain warmup (Day 1 = 20, Day 5+ = 250), bloque les marketing en warmup ([supabase/functions/_shared/email.ts:302-368](supabase/functions/_shared/email.ts#L302-L368))
- Logs : table `notification_email_log` (catégorie, recipient, dedupe_key, send_state, provider_message_id, last_error)

**TROUS CRITIQUES** :
- 🚨 **Tous les templates sont en français hardcodé** — pas d'i18n malgré `user_profiles.language` qui existe (fr/en/de/es). Risque international au lancement.
- 🚨 **Aucune table de préférences utilisateur** : pas de `notification_preferences`, pas d'`opt_in`. Footer marketing pointe vers `/unsubscribe` mais la route **est en 404**. RGPD/CNIL risque.
- 🚨 **Pas de webhook Resend bounce/complaint** : aucune Edge Function `*-webhook`, aucune table `email_bounces`. Deliverability monitorée uniquement via le retour API synchrone Resend, pas les events async.
- 🚨 **Notification in-app `notifications` minimale** : pas de `is_read`, pas de `payload jsonb`, pas de Realtime subscribe ([src/lib/notifications/hooks.ts:17-63](src/lib/notifications/hooks.ts#L17-L63)). La cloche du header existe mais le système est immature.

### 1.4 Backoffice admin — capacités existantes

**14 pages admin** sous `/admin/*` ([src/App.tsx:298-321](src/App.tsx#L298-L321)) derrière `<ProtectedRoute requireAdmin>` + `<AdminLayout/>` + `AdminSidebar`.

| Route | Rôle |
|---|---|
| `/admin` | Dashboard analytics |
| `/admin/pilotage` | KPIs + charts |
| `/admin/battles` | **AdminBattles.tsx (2641 lignes)** — validation, cancel, finalize, extend, modération commentaires, IA actions |
| `/admin/news`, `/admin/forum*`, `/admin/messages*`, `/admin/reputation`, `/admin/revenue`, `/admin/payouts`, `/admin/elite-access`, `/admin/beat-analytics`, `/admin/launch`, `/admin/settings` | divers |

**Patterns réutilisables** :
- ✅ "Inbox IA" (`ai_admin_actions` avec statuts proposed/executed/failed/overridden, apply/reject + feedback dans `ai_training_feedback`) — **C'est le pattern le plus proche d'une "review queue" qu'on cherche pour Curated** ([src/pages/AdminBattles.tsx:2440-2513](src/pages/AdminBattles.tsx#L2440-L2513))
- ✅ `AdminPriorityCards` — pattern de triage
- ✅ `SearchSortFilterBar` — barre recherche/tri/filtres générique réutilisable
- ✅ Sidebar avec badges counts (`battlesAwaitingAdminCount`) — pattern à reproduire pour "Feedback queue count"

**Manques bloquants pour Curated/Signature** :
- ❌ **Pas de composant `DataTable` générique** — tout est `<ul>` à la main
- ❌ **Pas de composant `Drawer` générique** — pour le panneau "review extraits", on devra étendre `Modal` ou créer un Drawer
- ❌ **Pas de système de tags / labels / priorités** réutilisable sur les battles
- ❌ **Pas de file d'attente générique avec SLA / urgence**

**Auth admin** : enum `user_role = visitor | user | confirmed_user | producer | admin`, helper SQL `is_admin()` SECURITY DEFINER ([20260324170000_fix_is_admin_security_definer.sql](supabase/migrations/20260324170000_fix_is_admin_security_definer.sql)), check client = `profile?.role === 'admin'` ([ProtectedRoute.tsx:47](src/components/auth/ProtectedRoute.tsx#L47)).

### 1.5 Modération existante

**Filtres mots** : **listes hardcodées en DOUBLE** :
- SQL : [supabase/migrations/20260222122000_047_add_rule_based_comment_moderation_trigger.sql:37-52](supabase/migrations/20260222122000_047_add_rule_based_comment_moderation_trigger.sql#L37-L52)
- Edge : [supabase/functions/ai-moderate-comment/index.ts:57-59](supabase/functions/ai-moderate-comment/index.ts#L57-L59)

Listes courtes (~9 toxic / 7 spam / 7 borderline) fr+en. **À synchroniser manuellement → dette technique**. Pas de lib externe (`bad-words`, `obscenity`).

**Score qualité** : Edge `ai-moderate-comment` classify `safe|borderline|toxic|spam` avec score 0-1, auto-hide si ≥ 0.95.

**Anti-spam infra mature** :
- Tables `rpc_rate_limit_rules`, `rpc_rate_limit_counters`, `rpc_rate_limit_hits`
- RPC `check_rpc_rate_limit`, `check_rate_limit`, etc.
- hCaptcha sur auth-signup/login/forgot-password/contact mais **PAS** sur commentaires/votes
- `sybil_min_account_age` (compte trop neuf), `fraud_event_logs`

**Trous** :
- ❌ **Aucun signalement utilisateur** : pas de table `reports/flags/user_reports`, pas d'UI "signaler ce commentaire"
- ❌ **Aucune longueur minimale** sur commentaires (seul check : `trim() ≠ ''` et `≤ 1000`)

### 1.6 Infra & volumétrie

**Volume prod (read-only, 2026-05-24)** :
| Métrique | Prod | Staging |
|---|---|---|
| `battles` total | **0** | 1 |
| `battle_votes` | 0 | 1 |
| `battle_vote_feedback` | 0 | 3 |
| `battle_comments` | 0 | 1 (17 char) |
| `email_queue` | 0 | — |
| `notification_email_log` | 25 | — |
| `event_outbox` 30j | 21 | — |
| `auth.users` total / 7j | 12 / 4 | — |

**La prod est pré-launch**. Toute estimation de volume futur (1000 battles/j cible) est prospective.

**Cron jobs prod** (`SELECT * FROM cron.job`) — **SEULEMENT 2 JOBS ACTIFS** :
| jobid | jobname | schedule | cible |
|---|---|---|---|
| 3 | `agent-finalize-expired-battles` | `*/15 * * * *` | **CASSÉ** — URL contient `<STAGING_PROJECT_REF>` non substitué |
| 5 | `agent-auto-execute-ai-actions` | `*/15 * * * *` | OK |

**Migration 175** (`20260311190000_175_fix_signup_email_pipeline_workers.sql`) prétend créer les jobs `process-email-queue, process-outbox, process-events, repair-email-delivery` → **ils ne sont pas en prod**. Soit jamais appliquée, soit supprimés manuellement.

**Coût Resend estimé** (à 2 emails/battle, 30j) :
| Battles/j | Emails/mo | Resend cost |
|---|---|---|
| 100 | 6 k | $20/mo (Pro, déjà actif) |
| 500 | 30 k | $20/mo |
| 1000 | 60 k | $90/mo (Scale 500 k) |

---

## PHASE 2 — DIAGNOSTIC

### 2.1 ✅ Ce qui est RÉUTILISABLE (gros gain de temps)

| Brique | Localisation | Réutilisation |
|---|---|---|
| Pipeline event_outbox → email | [docs/email-event-architecture.md](docs/email-event-architecture.md) | Backbone de tous les envois feedback. Ajouter event_type + handler + template, point. |
| `email_queue` + `process-email-queue` | [supabase/functions/process-email-queue/index.ts](supabase/functions/process-email-queue/index.ts) | Batch 20, retry, dedupe — prêt à l'emploi |
| `event_handlers` mapping | table DB | INSERT `('BATTLE_COMPLETED', 'email', 'battle_feedback', true)` |
| `battle_vote_feedback` + `battle_quality_snapshots` + RPC `rpc_compute_battle_quality_snapshot` | Migrations 137-139 | Source de toute la data qualitative pour les emails |
| Trigger pattern `AFTER UPDATE ON battles WHEN OLD.status <> 'completed' AND NEW.status = 'completed'` | déjà répliqué 3× | Copier pour publish `BATTLE_COMPLETED` |
| Helper `sendEmailWithResend` + guardrails marketing | [supabase/functions/_shared/email.ts:302-436](supabase/functions/_shared/email.ts#L302-L436) | Garde domain warmup + footer + unsubscribe |
| Pattern "Inbox IA" `ai_admin_actions` | [src/pages/AdminBattles.tsx:2440-2513](src/pages/AdminBattles.tsx#L2440-L2513) | Modèle pour la review queue Curated |
| `AdminPriorityCards` | [src/components/admin/AdminPriorityCards.tsx](src/components/admin/AdminPriorityCards.tsx) | Cartes "à traiter" à étendre avec "Curated en attente / Signature en attente" |
| `SearchSortFilterBar` | [src/components/ui/SearchSortFilterBar.tsx](src/components/ui/SearchSortFilterBar.tsx) | Filtres/tris de la file d'attente |
| Badge count sidebar | [src/components/admin/AdminSidebar.tsx:111-121](src/components/admin/AdminSidebar.tsx#L111-L121) | Compteur "Feedback queue" |
| `ai-moderate-comment` Edge | [supabase/functions/ai-moderate-comment/index.ts](supabase/functions/ai-moderate-comment/index.ts) | Score qualité auto pour filtrer extraits Curated |
| i18n typed `NestedKeyOf<typeof fr>` | [src/lib/i18n/index.ts](src/lib/i18n/index.ts) | Pour wording UI front (pas pour les templates email actuellement) |
| Pattern claim job RPC (`claim_*_jobs(limit, worker)`) | [audio-worker/src/queue.ts:40-43](audio-worker/src/queue.ts#L40-L43) | Si on crée une queue dédiée feedback |
| Sentry instrumented partout | `_shared/sentry.ts` | Traces et erreurs gratuites |
| Tables `notification_email_log` + `email_queue.send_state` | DB | Audit trail prêt à l'emploi |
| RLS / SECURITY DEFINER + SECURITY INVOKER wrappers pattern | Migration `20260430203000` | À répliquer obligatoirement sur nouvelles RPC |

### 2.2 ⚠️ Ce qui MANQUE (à créer)

#### DB / migrations
- 🆕 Trigger `on_battle_completed_publish_event` (couvre les égalités contrairement à `BATTLE_WON`)
- 🆕 Row dans `event_handlers` : `('BATTLE_COMPLETED', 'email', 'battle_feedback', true)`
- 🆕 RPC `get_battle_feedback_payload(battle_id, recipient_user_id)` (agrège snapshots + critères + ranking)
- 🆕 Table `battle_feedback_runs(id, battle_id, kind enum('stats','growth','curated','signature'), status enum, assigned_admin_id, published_at, ...)`
- 🆕 Table `battle_curated_excerpts(id, run_id, source enum('comment','vote_feedback'), source_id, content, order_index, admin_id)`
- 🆕 Table `battle_admin_notes(id, run_id, admin_id, body, audio_url, transcript, published_at)`
- 🆕 Table `notification_preferences(user_id, email_feedback bool, email_battle_invitation bool, email_marketing bool, ...)`
- 🆕 Colonne `notifications.is_read boolean DEFAULT false` (manquante actuellement)
- 🆕 Table `email_bounces(provider_message_id, recipient_email, reason, received_at)` + `email_complaints(...)`
- 🆕 (optionnel Phase 4) colonne `battles.is_final boolean DEFAULT false` ou `battles.tier text` si on veut formaliser les "title matches"
- 🆕 Table `banned_words(word text pk, severity, lang)` pour dédupliquer les listes hardcodées
- 🆕 (optionnel) Table `comment_reports(id, comment_id, reporter_id, reason, status)` pour signalement utilisateur

#### Edge Functions
- 🆕 `process-battle-feedback` (handler dispatch dans `process-events` plutôt qu'une edge fn dédiée — préférable)
- 🆕 `api/resend-webhook.ts` Vercel Function (verify svix-signature, update email_queue.send_state)
- 🆕 (Phase 4) `transcribe-admin-note` (Whisper API si vocal)

#### Templates email
- 🆕 `battle_feedback_stats` (placeholder Phase 1 — pas d'envoi auto, juste dashboard)
- 🆕 `battle_feedback_growth_winner` + `battle_feedback_growth_loser` (Phase 2)
- 🆕 `battle_feedback_curated_winner` + `battle_feedback_curated_loser` (Phase 3)
- 🆕 `battle_feedback_signature_winner` + `battle_feedback_signature_loser` (Phase 4)
- 🆕 Lib de templates variabilisés (intros, formulations forces/axes) — fichier TS de pools de strings + sélecteur déterministe basé sur hash(battle_id + recipient_id)

#### Frontend
- 🆕 Page `/producer/battles/:id/feedback` (dashboard Stats public + CTA "Voir le feedback complet")
- 🆕 Composants `BattleStatsCard`, `BattleScoreRadar` (data: artistic, coherence, preference)
- 🆕 Page admin `/admin/battles/feedback-queue` avec file priorisée
- 🆕 `CuratedReviewDrawer` (drawer générique ou modal étendu)
- 🆕 `SignatureNoteEditor` (rich text + audio uploader + preview)
- 🆕 Page `/notifications/preferences` (gestion opt-in/opt-out)
- 🆕 Page `/unsubscribe` (lien direct depuis email, one-click)
- 🆕 Ajout item sidebar `AdminSidebar` "Feedback queue" + badge count

#### Composants UI génériques (à créer une fois, utilisables ailleurs)
- 🆕 `DataTable` générique (rien d'équivalent — tout est `<ul>` à la main)
- 🆕 `Drawer` générique (extension `Modal`)
- 🆕 `Priority` badge réutilisable

#### Infra cron / ops
- 🆕 Job pg_cron `process-email-queue` (recréer)
- 🆕 Job pg_cron `process-outbox` (recréer)
- 🆕 Job pg_cron `process-events` (recréer)
- 🆕 Job pg_cron `process-battle-feedback-queue` (rendre la file admin visible, alertes SLA)
- 🆕 Fix URL cron `agent-finalize-expired-battles`

#### Tests / CI
- 🆕 `.github/workflows/ci.yml` (typecheck + lint + cypress smoke a minima)
- 🆕 Tests unitaires RPC feedback (psql / pgTAP idéalement)
- 🆕 Cypress `feedback-flow.cy.ts`

#### i18n
- 🆕 Refactor templates email pour lire `user_profiles.language` (chantier indépendant mais BLOCKING pour international)

### 2.3 🚨 Risques techniques identifiés

| # | Risque | Criticité | Mitigation |
|---|---|---|---|
| 1 | **Cron `agent-finalize-expired-battles` cassé en prod** → battles ne se finalisent jamais → feedback ne part jamais | 🔴 Critique | Fix URL placeholder en priorité absolue (Pré-Phase 1) |
| 2 | **Jobs cron `process-email-queue/outbox/events` absents en prod** → email queue jamais drainée | 🔴 Critique | Réappliquer migration 175 + vérifier en prod |
| 3 | **`BATTLE_WON` ne publie pas en cas d'égalité** (`winner_id IS NULL`) | 🟠 Élevé | Créer `BATTLE_COMPLETED` séparé (couvre tous les cas) ou modifier le critère du trigger existant |
| 4 | **`rpc_compute_battle_quality_snapshot` non appelée auto par `finalize_battle`** | 🟠 Élevé | L'appeler soit dans `private.finalize_battle`, soit dans le handler email avant rendu |
| 5 | **Coherence_score = 0 si < 5 feedbacks** → "0" cru dans l'email pour les premières battles | 🟡 Moyen | Wording email qui omet ou contextualise quand insuffisant |
| 6 | **Tous les templates email en français hardcodé** | 🟠 Élevé pour international, 🟡 sinon | Chantier i18n templates avant Phase 2 si fr+en visé |
| 7 | **Aucune table `notification_preferences`** + `/unsubscribe` en 404 | 🔴 Critique RGPD | Doit être prêt avant tout email non-strictement-transactionnel (cf CNIL, le feedback peut être considéré comme service connexe → zone grise) |
| 8 | **Aucun webhook bounce/complaint Resend** | 🟠 Élevé à scale | Vercel Function `api/resend-webhook.ts` avant 500 emails/j |
| 9 | **Single worker Render** | 🟡 Moyen | Pas bloquant si on passe par email_queue. Si on crée un worker dédié, séparer service Render |
| 10 | **Couverture tests battles < 5%, aucune CI** | 🟠 Élevé | Mettre CI GitHub Actions avant code feedback. Tests pgTAP sur RPC critiques |
| 11 | **Listes banned_words dupliquées (SQL + TS) → drift** | 🟡 Moyen | Migrer vers table `banned_words` |
| 12 | **`database.types.ts` stale** (waitlist au moins) | 🟡 Moyen | Régénérer types avant tout nouveau code consommant les nouvelles tables |
| 13 | **MCP `apply_migration` désaligne `schema_migrations.version`** | 🟡 Moyen (récurrent) | Toujours réaligner après apply (cf mémoire utilisateur) |
| 14 | **Latence cron 15 min entre fin vote et `status=completed`** | 🟢 Bas (acceptable) | Communiquer dans le wording email "envoyé sous 30 min" |
| 15 | **Marketing footer pointe vers `/unsubscribe` 404** | 🟠 Élevé | Créer la route avant Phase 2 (sinon impact deliverability si users marquent en spam) |

### 2.4 💡 Recommandation d'architecture

**Reco principale** : **réutiliser le pipeline outbox existant**, ne pas créer de worker dédié, ne pas créer d'edge function dédiée à l'envoi.

```
[battle status → 'completed']
        │
        ▼ trigger DB on_battle_completed_publish_event
        │
        ▼ INSERT event_outbox (event_type='BATTLE_COMPLETED', payload={battle_id, winner_id, producer_ids})
        │
        ▼ process-outbox (cron */1min) → INSERT event_bus + handler dispatch
        │
        ▼ process-events (cron */1min)
        │   ├─ Handler 'battle_feedback' (NOUVEAU):
        │   │     1. RPC rpc_compute_battle_quality_snapshot(battle_id)
        │   │     2. RPC get_battle_feedback_payload(battle_id, producer1_id)
        │   │     3. INSERT email_queue (template='battle_feedback_growth_loser', source_event_id=...)
        │   │     4. RPC get_battle_feedback_payload(battle_id, producer2_id)
        │   │     5. INSERT email_queue (template='battle_feedback_growth_winner', source_event_id=...)
        │   │     6. INSERT public.notifications (in-app jumelle, type='battle_feedback')
        │   │     7. Si tier battle ≥ X ou is_final : INSERT battle_feedback_runs (kind='curated' ou 'signature', status='queued')
        │   │
        │   └─ Handler 'battle_won' (existant) : inchangé
        │
        ▼ process-email-queue (cron */5min, batch 20)
        │
        ▼ Resend API
        │
        ▼ Resend webhook bounce/complaint
        │
        ▼ api/resend-webhook.ts (Vercel) → UPDATE email_queue.send_state / désactiver opt-in user
```

**Pourquoi ce design** :
1. **Zéro nouvelle infra** (réutilise crons + tables + edge fns existantes)
2. **Idempotence native** (event_outbox.dedupe_key + email_queue.source_event_id UNIQUE)
3. **Backpressure native** (email_queue + batch 20 + retry)
4. **Audit trail natif** (event_outbox + notification_email_log + email_queue.send_state)
5. **Couvre les égalités** (trigger sur status, pas sur winner_id)
6. **Niveau Curated / Signature s'intègre proprement** via `battle_feedback_runs` (la run est créée auto, l'admin la prend, et la publication = re-insert dans email_queue avec un template différent)

**Pourquoi PAS d'autres options envisagées** :
- ❌ Worker audio étendu : possible mais mélange responsabilités, mono-instance, Docker-heavy
- ❌ Edge function dédiée : `process-email-queue` couvre déjà l'envoi, inutile
- ❌ Vercel Function de polling : crée une 3e infrastructure de scheduling, pas justifié
- ❌ Trigger d'envoi direct : viole le garde-rail DB (insert sans source_event_id bloqué) et casse l'idempotence

---

## PHASE 3 — PLAN D'IMPLÉMENTATION (4 phases progressives)

### Pré-requis bloquants (avant Phase 1)

**P0-1. Réparer le cron `agent-finalize-expired-battles`**
- Fichier : `supabase/migrations/20260413030000_234_setup_finalize_expired_battles_cron.sql` (à patcher via nouvelle migration)
- Action : Re-créer le cron job en prod avec l'URL réelle substituée (pas le placeholder)
- Validation : `SELECT * FROM cron.job WHERE jobname='agent-finalize-expired-battles'` ; puis créer 1 battle test en staging, attendre 15 min, vérifier `status='completed'`
- **Estimation : 1-2 heures**

**P0-2. Réinstaller les cron jobs email pipeline**
- Vérifier l'état de la migration `20260311190000_175_fix_signup_email_pipeline_workers.sql` (appliquée ou pas ?)
- Si pas appliquée : appliquer en prod (timestamp à réaligner suite à MCP apply)
- Si appliquée mais cron supprimés : nouvelle migration `XXX_restore_email_pipeline_cron_jobs.sql`
- Jobs à recréer : `process-outbox` (`*/1 * * * *`), `process-events` (`*/1 * * * *`), `process-email-queue` (`*/5 * * * *`), `repair-email-delivery` (`*/15 * * * *`)
- Validation : insérer un `event_outbox` test, voir s'il transite jusqu'à `email_queue` puis `notification_email_log`
- **Estimation : 2-4 heures**

**P0-3. Mettre en place une CI minimale**
- Fichier : `.github/workflows/ci.yml` (à créer)
- Steps : `npm install && npm run typecheck && npm run lint && npm run build`
- Bonus : run cypress smoke tests sur PR
- Validation : ouvrir une PR test, vérifier que la CI passe
- **Estimation : 2-3 heures**

**Total prérequis : 1 journée**

---

### Phase 1 — Niveau "STATS" (dashboard public, pas d'email)

**Objectif** : chaque battle terminée a un dashboard public consultable montrant ses scores (artistic, coherence, preference, quality_index), top critères, ranking. **AUCUN email** envoyé. Effort admin = 0s.

**Fichiers à créer/modifier**

| Fichier | Action |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_feedback_compute_on_finalize.sql` | NEW — Patche `private.finalize_battle()` pour appeler `rpc_compute_battle_quality_snapshot(p_battle_id)` après mise à jour status. Wrap dans try/exception pour ne pas bloquer la finalisation. |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_feedback_helpers.sql` | NEW — RPC `public.get_battle_feedback_payload(battle_id, viewer_id)` SECURITY DEFINER → INVOKER wrapper, retourne jsonb `{snapshots, top_criteria, ranking, my_score}` |
| `src/pages/battles/BattleFeedback.tsx` | NEW — Page publique dashboard, route `/battles/:slug/feedback` |
| `src/components/battles/feedback/BattleStatsCard.tsx` | NEW — Carte par producteur (score, win rate, top criteria) |
| `src/components/battles/feedback/BattleScoreRadar.tsx` | NEW — Radar chart 4 dimensions (utiliser `recharts` ou similaire — vérifier ce qui est déjà installé, sinon SVG manuel) |
| `src/components/battles/feedback/BattleCriteriaList.tsx` | NEW — Top 3 critères avec barres de progression |
| `src/App.tsx` | MODIFY — Ajouter route `/battles/:slug/feedback` (pas protégée — public) |
| `src/lib/i18n/translations/{fr,en,de,es}.ts` | MODIFY — Ajouter clés `battles.feedback.*` (4 langues) |
| `src/pages/BattleDetail.tsx` (si existe) | MODIFY — Ajouter CTA "Voir le feedback" visible quand `status='completed'` |

**Migrations DB** : 2 (compute on finalize + RPC helper)

**Services / Jobs** : aucun (purement frontend + RPC read)

**Endpoints API** : aucun (Supabase RPC direct depuis le client)

**Pages admin** : aucune (Phase 1 est purement user-facing)

**Tests**
- Unit pgTAP : `rpc_compute_battle_quality_snapshot` retourne quality_index correct sur dataset fixture
- Unit pgTAP : `get_battle_feedback_payload` retourne payload bien formé + RLS
- Cypress e2e : `battles-feedback-page.cy.ts` — visiter `/battles/:slug/feedback`, vérifier rendu

**Critère de validation pour passer à Phase 2**
- ✅ 5 battles staging finalisées avec snapshots calculés auto
- ✅ Page `/battles/:slug/feedback` rendue sans erreur en 4 langues
- ✅ Pas de régression sur `finalize_battle` (les triggers reputation/competitive marchent toujours)
- ✅ CI verte

**Estimation : 3-5 jours**

---

### Phase 2 — Niveau "GROWTH REPORT" (email auto avec template variabilisé)

**Objectif** : après chaque battle terminée (toutes, sans filtre), envoyer un email à chaque producteur (winner + loser) avec un growth report personnalisé. Pool de phrases variabilisées. Anti-spam de base. Préférences user respectées.

**Décisions de design à valider en amont** (voir section "Décisions ouvertes" en fin de doc)
- D-1 : `BATTLE_COMPLETED` (event nouveau) vs étendre `BATTLE_WON` ?
- D-2 : i18n templates dès Phase 2 ou français seul ?
- D-3 : `notification_preferences` + `/unsubscribe` avant Phase 2 ou en parallèle ?

**Fichiers à créer/modifier**

| Fichier | Action |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_notification_preferences.sql` | NEW — Table `notification_preferences(user_id pk, email_feedback bool default true, email_battle_invitation bool default true, email_marketing bool default false, updated_at)` + RLS user-scoped + trigger backfill pour users existants |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_completed_event.sql` | NEW — Trigger `on_battle_completed_publish_event` AFTER UPDATE OF status sur `battles` WHEN OLD.status <> 'completed' AND NEW.status = 'completed' → INSERT event_outbox `BATTLE_COMPLETED` avec payload `{battle_id, producer1_id, producer2_id, winner_id, scores}`. **dedupe_key = battle_id + '-completed'** |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_event_handlers_battle_feedback.sql` | NEW — INSERT INTO `event_handlers` ('BATTLE_COMPLETED', 'email', 'battle_feedback', true) |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_feedback_in_app_notifs.sql` | NEW — Ajouter `notifications.is_read boolean DEFAULT false` (manquant), `notifications.payload jsonb`, RPC `mark_notification_read(notification_id)` |
| `supabase/functions/process-events/index.ts` | MODIFY — Ajouter case `handler_key='battle_feedback'` : calcul snapshot, fetch payload, lookup `notification_preferences` (si opt-out → skip email mais log + insert in-app), INSERT email_queue pour chaque destinataire, INSERT public.notifications |
| `supabase/functions/process-email-queue/index.ts` | MODIFY — Ajouter case `template='battle_feedback_growth_winner'` et `template='battle_feedback_growth_loser'` dans `getTemplateContent` |
| `supabase/functions/_shared/emailTemplates.ts` | MODIFY — Ajouter `battle_feedback_growth_winner`, `battle_feedback_growth_loser` à `EmailTemplate` |
| `supabase/functions/_shared/templatePools/battleFeedback.ts` | NEW — Pools de phrases : `INTROS_WINNER[8]`, `INTROS_LOSER[8]`, `STRENGTHS_FORMULATIONS[12]`, `IMPROVEMENT_ANGLES[6]`. Sélecteur déterministe `pickFromPool(pool, seed)` où seed = hash(battle_id + recipient_id) → reproductible (re-render = même output) |
| `supabase/functions/_shared/templatePools/battleFeedback.fr.ts` | NEW — Pool fr (obligatoire) |
| `supabase/functions/_shared/templatePools/battleFeedback.en.ts` | NEW — Pool en (si D-2 = oui) |
| `src/pages/notifications/Preferences.tsx` | NEW — Page `/notifications/preferences` : toggles email_feedback / email_battle_invitation / email_marketing |
| `src/pages/Unsubscribe.tsx` | NEW — Route `/unsubscribe?token=...` (token signé HMAC contenant user_id + category) — one-click unsubscribe |
| `supabase/functions/unsubscribe-one-click/index.ts` | NEW — Endpoint POST one-click qui flip `notification_preferences.email_*` à false en vérifiant le token |
| `src/lib/notifications/hooks.ts` | MODIFY — Ajouter `useUpdatePreferences`, `useMarkNotificationRead`, Realtime subscribe (optionnel mais clean) |
| `src/components/notifications/NotificationsPanel.tsx` | MODIFY — Afficher `is_read` badge, action mark all read, déeplink vers `/battles/:slug/feedback` |
| `api/resend-webhook.ts` | NEW — Vercel Function. Vérifie signature svix. Update `notification_email_log.send_state='bounced'` ou `'complained'`. Si hard bounce → set `notification_preferences.email_feedback=false`. |

**Migrations DB** : 4 (preferences, trigger, handler row, notifications enhancement)

**Services / Jobs** : Handler `battle_feedback` dans `process-events` (extension, pas nouveau service)

**Endpoints API** : 
- Edge `unsubscribe-one-click` (POST)
- Vercel `api/resend-webhook` (POST)

**Pages admin** : aucune nouvelle (Curated arrive en Phase 3)

**Tests**
- Unit pgTAP : trigger `on_battle_completed_publish_event` publie 1 outbox row par transition, dedupe sur re-update
- Unit Deno : `pickFromPool(seed)` est reproductible
- Cypress : `feedback-flow.cy.ts` end-to-end (créer 1 battle staging, finaliser, vérifier email reçu via mailpit/inbox)
- Cypress : `preferences-page.cy.ts` (toggle opt-out, vérifier prochain envoi skipped)
- Cypress : `unsubscribe-one-click.cy.ts`

**Critère de validation pour passer à Phase 3**
- ✅ 10 battles staging avec 2 emails reçus chacune (20 emails)
- ✅ Page `/notifications/preferences` fonctionnelle
- ✅ Webhook bounce confirmé (envoyer à un email invalide, vérifier flip preferences)
- ✅ Footer marketing pointe vers `/unsubscribe` ET la route répond 200
- ✅ Texte fr (et en si D-2=oui) variabilisé : 5 battles consécutives → 5 intros différentes
- ✅ Aucune régression sur les 11 templates email existants

**Estimation : 8-12 jours**

---

### Phase 3 — Niveau "CURATED" (admin panel avec file d'attente)

**Objectif** : un sous-ensemble des battles (filtre tier ou flag) déclenche une `battle_feedback_run` en statut `queued`. L'admin a une file d'attente priorisée. Pour chaque battle, l'admin sélectionne 3-5 extraits de commentaires/critères → publication. L'email "Curated" est envoyé en remplacement (ou en complément) du Growth Report.

**Décisions de design à valider**
- D-4 : "Curated" remplace ou s'ajoute au "Growth" ?
- D-5 : Quelle est la règle pour qu'une battle déclenche une run `curated` ? (tier producteur, flag manuel, votes_total > seuil, featured=true ?)
- D-6 : SLA souhaité pour Curated ? (ex: 48h max)

**Fichiers à créer/modifier**

| Fichier | Action |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_feedback_runs.sql` | NEW — Tables `battle_feedback_runs`, `battle_curated_excerpts`. Enum `feedback_run_kind` ('growth_auto', 'curated', 'signature'), enum `feedback_run_status` ('queued', 'in_progress', 'published', 'skipped'). RLS admin-only sauf SELECT sur `published`. |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_feedback_priority.sql` | NEW — Fonction `compute_feedback_priority(battle_id) returns int` = `tier_battle*10 + days_waiting*2 + engagement_user` (formule du brief). View `v_battle_feedback_queue` qui ordonne par priorité descendante. |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_feedback_run_rpc.sql` | NEW — RPC `admin_assign_feedback_run(run_id)` (claim), `admin_publish_curated_feedback(run_id, excerpts jsonb[])` (atomic : INSERT excerpts + UPDATE run status='published' + INSERT email_queue). Toutes SECURITY DEFINER + wrapper INVOKER. |
| `supabase/functions/process-events/index.ts` | MODIFY — Handler `battle_feedback` étendu : si battle match les critères Curated → créer `battle_feedback_runs` kind='curated' status='queued' au lieu d'envoyer immédiatement Growth ; sinon envoie Growth comme Phase 2 |
| `supabase/functions/_shared/emailTemplates.ts` | MODIFY — Ajouter `battle_feedback_curated_winner`, `battle_feedback_curated_loser` |
| `supabase/functions/process-email-queue/index.ts` | MODIFY — Cases templates curated avec rendu des extraits |
| `supabase/functions/_shared/templatePools/battleFeedbackCurated.{fr,en}.ts` | NEW — Pools spécifiques curated (ton plus éditorial) |
| `src/components/ui/DataTable.tsx` | NEW — Composant générique (sera réutilisé partout) |
| `src/components/ui/Drawer.tsx` | NEW — Composant générique |
| `src/components/admin/Priority.tsx` | NEW — Badge priorité (P0/P1/P2/P3) |
| `src/pages/admin/AdminFeedbackQueue.tsx` | NEW — Page `/admin/battles/feedback-queue`. Liste battles en attente (DataTable, tri par priority desc). Action "Prendre" → ouvre Drawer. |
| `src/components/admin/feedback/CuratedReviewDrawer.tsx` | NEW — Drawer 2 panneaux : gauche = battle context (scores, ranking, commentaires complets, vote_feedback critères), droite = "Mes picks" (checkbox + drag-drop ordre). Bouton "Publier" → appelle `admin_publish_curated_feedback`. |
| `src/components/admin/AdminSidebar.tsx` | MODIFY — Ajouter item "Feedback queue" + badge count (`useFeedbackQueueCount()`) |
| `src/components/admin/AdminPriorityCards.tsx` | MODIFY — Ajouter card "Curated en attente" avec lien vers `/admin/battles/feedback-queue` |
| `src/App.tsx` | MODIFY — Route `/admin/battles/feedback-queue` (requireAdmin) |
| `src/lib/i18n/translations/{fr,en,de,es}.ts` | MODIFY — Clés `admin.feedback.*` |

**Migrations DB** : 3 (runs+excerpts, priority fn, RPCs)

**Services / Jobs** : 
- Cron job (optionnel) `notify-stale-feedback-runs` — alerte admin si une run reste `queued` > SLA (ex: 48h)

**Endpoints API** : aucun (tout via Supabase RPC)

**Pages admin** : 1 nouvelle (`/admin/battles/feedback-queue`) + items sidebar + cards

**Tests**
- Unit pgTAP : `compute_feedback_priority` retourne valeur attendue sur dataset fixture
- Unit pgTAP : `admin_publish_curated_feedback` atomique (rollback si email_queue insert fail)
- Cypress : `admin-feedback-queue.cy.ts` (admin se connecte, voit queue, prend une battle, publie 3 extraits, vérifie email envoyé)
- Tests RLS : non-admin ne peut pas voir `feedback-queue`, ne peut pas appeler RPC admin_*

**Critère de validation pour passer à Phase 4**
- ✅ 5 battles staging traitées en Curated < 30s chacune (mesure réelle via timer admin UI)
- ✅ File d'attente priorisée correctement (P0 affichées avant P3)
- ✅ Alerte SLA déclenchée si run > 48h queued
- ✅ Composant `DataTable` réutilisable validé (utilisé dans une autre page admin pour stress test)
- ✅ Pas de régression Phase 2 (Growth Report toujours OK pour battles non-curated)

**Estimation : 10-15 jours**

---

### Phase 4 — Niveau "SIGNATURE" (note perso admin, idéalement vocal)

**Objectif** : pour les battles "finales" / "title matches" / battles d'élite, l'admin écrit (et idéalement enregistre vocalement) une note personnelle. Transcription automatique optionnelle. Inclusion d'un fichier audio en pièce jointe ou hébergé.

**Décisions de design à valider**
- D-7 : Notion "battle finale" — ajouter colonne `battles.is_final` ou flag manuel via admin UI ?
- D-8 : Vocal — texte uniquement, audio + texte, audio seul, ou audio + transcription auto Whisper ?
- D-9 : Audio storage — bucket Supabase `battle-admin-notes` privé avec URL signée 90j ?
- D-10 : Cible audience Signature — uniquement battles "title", ou opt-in admin par battle dans la queue Curated ?

**Fichiers à créer/modifier**

| Fichier | Action |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battle_admin_notes.sql` | NEW — Table `battle_admin_notes(id, run_id, admin_id, body text, audio_storage_path text, audio_duration_sec int, transcript text, published_at, ...)` + RLS |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_battles_is_final.sql` | NEW — Colonne `battles.is_final boolean DEFAULT false` (si D-7 = oui) |
| `supabase/migrations/YYYYMMDDHHMMSS_NNN_admin_publish_signature_rpc.sql` | NEW — RPC `admin_publish_signature_feedback(run_id, body, audio_storage_path, transcript)` |
| `supabase/storage` | NEW bucket — `battle-admin-notes` (private, RLS lecture admin + winner+loser de la battle) |
| `supabase/functions/transcribe-admin-note/index.ts` | NEW (si D-8 inclut transcription) — Reçoit audio_storage_path, télécharge depuis storage, appelle OpenAI Whisper API, UPDATE `battle_admin_notes.transcript`. Async. |
| `supabase/functions/process-events/index.ts` | MODIFY — Handler `battle_feedback` étendu : si `battles.is_final OR admin_marked_for_signature` → run kind='signature' au lieu de 'curated' |
| `supabase/functions/_shared/emailTemplates.ts` | MODIFY — `battle_feedback_signature_winner`, `battle_feedback_signature_loser` |
| `supabase/functions/process-email-queue/index.ts` | MODIFY — Cases signature : email html embed audio player (HTML5 `<audio>` ou link vers page web si bounce), inclure transcript en fallback |
| `src/components/admin/feedback/SignatureNoteEditor.tsx` | NEW — Drawer/Modal : textarea rich text (markdown) + bouton "Enregistrer vocal" (MediaRecorder API browser-native, pas de lib externe), upload vers Storage, attente transcription, preview, publish |
| `src/components/admin/feedback/AudioRecorder.tsx` | NEW — Composant standalone enregistrement (MediaRecorder + waveform visualization) |
| `src/pages/admin/AdminFeedbackQueue.tsx` | MODIFY — Filtre tab "Signature" vs "Curated", toggle "Marquer pour Signature" sur les runs `curated` (escalation) |
| `src/pages/battles/BattleFeedback.tsx` | MODIFY — Si une signature_note existe, l'afficher avec audio player |
| `src/lib/i18n/translations/{fr,en,de,es}.ts` | MODIFY — Clés signature |

**Migrations DB** : 3 (notes table, is_final col optionnelle, RPC)

**Services / Jobs** :
- Edge `transcribe-admin-note` (déclenché en async par RPC publish, ou cron qui scanne `transcript IS NULL`)

**Endpoints API** : aucun nouveau Vercel

**Pages admin** : extension de `/admin/battles/feedback-queue` avec tab Signature

**Tests**
- Unit Deno : `transcribe-admin-note` handle audio < 25MB, ≤ 10 min
- Cypress : `admin-signature-flow.cy.ts` (admin enregistre 30s d'audio, publie, vérifie transcript + email reçu avec audio link)
- Test RLS : seuls admin + winner_id + loser_id peuvent télécharger l'audio storage

**Critère de validation = livrable complet**
- ✅ 3 battles staging avec signature publiée (1 texte seul, 1 audio+transcript, 1 audio seul)
- ✅ Email contient audio player fonctionnel sur Gmail/Outlook/Apple Mail
- ✅ Whisper transcription précision acceptable sur audio fr 30s
- ✅ Storage RLS validée (autre user ne peut pas télécharger)
- ✅ KPI tracking opérationnel : taux de retour 7j post-feedback (perdant qui reposte une battle)

**Estimation : 6-10 jours**

---

## 4. ROADMAP VISUELLE

```
                                                                                ┌────────────┐
                                                                                │  Phase 4   │
                                                                                │  Signature │  6-10j
                                                                                │            │
                                                                ┌───────────────┤────────────┤
                                                                │   Phase 3     │
                                                                │   Curated     │  10-15j
                                                                │               │
                                                ┌───────────────┤───────────────┤
                                                │   Phase 2     │
                                                │   Growth Auto │  8-12j
                                                │               │
                                ┌───────────────┤───────────────┤
                                │   Phase 1     │
                                │   Stats       │  3-5j
                                │   (dashboard) │
                ┌───────────────┤───────────────┤
                │  Pré-requis   │
                │  cron fix +   │  1-2j
                │  CI + 175     │
                └───────────────┴───────────────┴───────────────┴───────────────┴────────────┘
   Jour 0     ~Jour 2          ~Jour 7          ~Jour 19         ~Jour 34       ~Jour 44

Sprint serré (full-time)   : ~7 semaines
Part-time réaliste (~50%)  : ~14 semaines (~3.5 mois)
```

**Chemin critique** : Pré-requis → Phase 1 → Phase 2 (le plus de risques i18n + RGPD) → Phases 3 et 4 en parallèle possible si 2 devs.

**Gates entre phases** :
- Gate Pré-req → Phase 1 : crons prod opérationnels, 1 battle finalisée auto en prod
- Gate Phase 1 → Phase 2 : dashboard rendu OK 4 langues, snapshots auto sur finalize
- Gate Phase 2 → Phase 3 : 10 battles avec emails reçus, opt-out fonctionnel, webhook bounce OK
- Gate Phase 3 → Phase 4 : 5 battles Curated < 30s admin time, DataTable réutilisé ailleurs
- Final : KPI taux de retour 7j mesurable

**Modularité (exigence du brief)** :
Chaque phase est désactivable indépendamment via un flag dans `notification_preferences` (granularité user) ET un kill-switch admin dans la table `app_settings` (granularité plateforme : `feedback_growth_enabled`, `feedback_curated_enabled`, `feedback_signature_enabled`). À implémenter en Phase 2 (le flag plateforme global).

---

## 5. KPI à mettre en place (instrumentation)

À builder en Phase 2, à exploiter à partir de Phase 3.

**Principal (brief)** :
- **Taux de retour 7j** : % de producteurs perdants qui créent une nouvelle battle ≤ 7 jours après réception du feedback. Vue SQL `v_feedback_retention_7d`.

**Secondaires** :
- Open rate par template (`battle_feedback_growth_*` vs `battle_feedback_curated_*` vs `battle_feedback_signature_*`) — via Resend webhook `email.opened`
- Click rate sur CTA "Voir le feedback complet" → `/battles/:slug/feedback`
- Opt-out rate après envoi feedback (toggle `email_feedback=false` dans les 7j)
- Bounce rate / complaint rate (RGPD : > 0.1% complaint = alerte)
- Admin throughput : nb runs `published` par admin par semaine
- SLA respecté : % runs `queued > 48h`

Stockage : table `feedback_kpi_daily` (snapshot quotidien via pg_cron), dashboard `/admin/feedback-kpi`.

---

## 6. DÉCISIONS À PRENDRE PAR TOI (avant de coder)

Voici les 10 décisions ouvertes qui bloquent ou orientent le plan. Je peux te les poser en interactif après ta lecture, ou tu peux y répondre librement dans le chat.

| # | Décision | Options | Impact |
|---|---|---|---|
| **D-1** | Event de déclenchement | (A) Créer `BATTLE_COMPLETED` (couvre égalités) ; (B) Étendre `BATTLE_WON` (modifier critère trigger) | A = plus propre, isolé. B = moins de tables, modifie un truc qui marche. **Reco : A.** |
| **D-2** | i18n templates dès Phase 2 | (A) fr seul ; (B) fr + en ; (C) 4 langues d'entrée | A = rapide mais limite international. C = chantier conséquent. **Reco : B**, ajouter de+es en Phase 4. |
| **D-3** | RGPD opt-in/out avant Phase 2 | (A) Inclus dans Phase 2 (table + page + /unsubscribe) ; (B) Phase 2 envoie sans opt-out, on fixe après | A est mon scénario de plan. B = risque CNIL/spam complaints. **Reco : A obligatoire.** |
| **D-4** | Curated remplace ou s'ajoute au Growth ? | (A) Remplace (1 email max par producteur) ; (B) S'ajoute (Growth instant + Curated quand prêt) | A = clarté user. B = plus de touchpoints mais redondance. **Reco : A.** |
| **D-5** | Critère déclenchement Curated | (A) Tier producteur ≥ elite ; (B) Flag admin manuel `battles.feature_curated_feedback` ; (C) Featured=true existant ; (D) Mix (auto si tier elite + override admin) | **Reco : D**, formule = `featured OR tier_max(participants) >= elite`. |
| **D-6** | SLA Curated | 24h / 48h / 7j / pas de SLA | Plus court = pression admin, plus pertinent. **Reco : 48h** (compatible part-time). |
| **D-7** | Notion "battle finale" en DB | (A) Colonne `battles.is_final` ; (B) Flag dans `admin_battle_campaigns` ; (C) Champ texte libre `battles.tags[]` | A = explicite. B = couplé au système campaigns. **Reco : A** (colonne simple, défaut false). |
| **D-8** | Vocal Signature | (A) Texte seul ; (B) Audio attaché ; (C) Audio + transcription Whisper auto ; (D) Texte + audio optionnel | C = effort le plus élevé mais le plus magique. **Reco : D** (texte obligatoire, audio optionnel, transcription auto si audio). |
| **D-9** | Storage audio Signature | (A) Supabase Storage bucket privé URL signée 90j ; (B) S3 externe ; (C) Hébergé dans email (attachment) | A = cohérent avec infra existante. C = limite Resend 40MB. **Reco : A.** |
| **D-10** | Anti-toxicité Phase 2 | (A) Reprendre rule trigger existant tel quel ; (B) Étendre min 15 chars dans la fonction `classify_battle_comment_rule_based` ; (C) Migrer banned_words en table en parallèle | **Reco : B maintenant + C en Phase 3** (table banned_words devient utile quand on a un volume de modération). |

---

## 7. CHECKLIST FINALE — état réel des prérequis bloquants

À jour le 2026-05-24 :

- [ ] **Cron `agent-finalize-expired-battles` réparé en prod** (URL `<STAGING_PROJECT_REF>` substituée)
- [ ] **Cron jobs `process-outbox/events/email-queue` présents en prod** (migration 175 vérifiée)
- [ ] **CI GitHub Actions** sur PR (typecheck + lint + build, idéalement cypress smoke)
- [ ] **Régénération `database.types.ts`** (waitlist et tables récentes)
- [ ] **Décisions D-1 à D-10 prises**
- [ ] **Worktree git dédié** créé pour ne pas polluer `main` pendant le dev (`git worktree add ../beatelion-feedback feedback/phase1`)
- [ ] **Inscription sur Resend Pro** confirmée (à vérifier — quota mensuel)

---

## 8. ANNEXES — fichiers de référence (à lire avant de coder)

**Architecture email (FIABLE)** :
- [docs/email-event-architecture.md](docs/email-event-architecture.md)
- [docs/event-pipeline-phase4.md](docs/event-pipeline-phase4.md)
- [docs/email-deliverability-check.md](docs/email-deliverability-check.md)
- [docs/email-prelaunch-checklist.md](docs/email-prelaunch-checklist.md)
- [supabase/functions/_shared/email.ts](supabase/functions/_shared/email.ts)
- [supabase/functions/_shared/emailTemplates.ts](supabase/functions/_shared/emailTemplates.ts)
- [supabase/functions/process-email-queue/index.ts](supabase/functions/process-email-queue/index.ts)
- [supabase/functions/process-outbox/index.ts](supabase/functions/process-outbox/index.ts)
- [supabase/functions/process-events/index.ts](supabase/functions/process-events/index.ts)

**Battles & feedback existant** :
- [supabase/migrations/20260125151124_004_create_battles_schema.sql](supabase/migrations/20260125151124_004_create_battles_schema.sql)
- [supabase/migrations/20260306100000_137_battle_vote_feedback_and_preferences.sql](supabase/migrations/20260306100000_137_battle_vote_feedback_and_preferences.sql)
- [supabase/migrations/20260306101000_138_battle_quality_snapshots_and_admin_views.sql](supabase/migrations/20260306101000_138_battle_quality_snapshots_and_admin_views.sql)
- [supabase/migrations/20260306102000_139_battle_quality_snapshot_rpcs.sql](supabase/migrations/20260306102000_139_battle_quality_snapshot_rpcs.sql)
- [supabase/migrations/20260311001500_165_event_bus_pipeline.sql](supabase/migrations/20260311001500_165_event_bus_pipeline.sql)
- [supabase/migrations/20260524160000_235_battle_pair_active_and_cooldown_limits.sql](supabase/migrations/20260524160000_235_battle_pair_active_and_cooldown_limits.sql)
- [supabase/functions/agent-finalize-expired-battles/index.ts](supabase/functions/agent-finalize-expired-battles/index.ts)

**Admin UI à étendre** :
- [src/pages/AdminBattles.tsx](src/pages/AdminBattles.tsx)
- [src/pages/admin/AdminLayout.tsx](src/pages/admin/AdminLayout.tsx)
- [src/components/admin/AdminSidebar.tsx](src/components/admin/AdminSidebar.tsx)
- [src/components/admin/AdminPriorityCards.tsx](src/components/admin/AdminPriorityCards.tsx)
- [src/components/ui/SearchSortFilterBar.tsx](src/components/ui/SearchSortFilterBar.tsx)

**Conventions & dette** :
- [AUDIT_BEATELION.md](AUDIT_BEATELION.md) (15 avril 2026, base conceptuelle)
- [AUDIT_AUTH.md](AUDIT_AUTH.md)
- [TECHNICAL_DEEP_DIVE.md](TECHNICAL_DEEP_DIVE.md)
- [docs/admin-controls-audit-and-plan.md](docs/admin-controls-audit-and-plan.md)
- [docs/security/supabase-rls-audit-2026-03-05.md](docs/security/supabase-rls-audit-2026-03-05.md)

**Mémoire fraîche (claude-mem)** :
- Obs 3899-3923 : déploiement Migration 235 (battle_pair_limits)
- Obs 3562-3585 : audit launch system 22 mai
- Obs 504 : pattern SECURITY DEFINER → INVOKER wrapper obligatoire
- Obs 3838-3848 : fix sort producers updated_at → created_at

---

## 9. PIÈGES À CONNAÎTRE (extraits Bloc F)

1. **NE PAS toucher au RPC `rpc_vote_with_feedback`** — SECURITY DEFINER central, aucun fallback. Ajouter en parallèle, jamais modifier.
2. **NE PAS INSERT direct sur `email_queue`** — trigger DB bloque sans `source_event_id`/`source_outbox_id`. Toujours passer par `publish_event()` + outbox.
3. **NE PAS oublier `SET search_path = public, pg_temp`** sur tout nouveau SECURITY DEFINER.
4. **NE PAS oublier de wrapper SECURITY INVOKER** sur tout SECURITY DEFINER public (pattern migration `20260430203000`).
5. **NE PAS UPDATE sans `.eq('id', ...)`** dans une Edge Fn — bug réel sur `toggle-maintenance`.
6. **NE PAS faire confiance aux types DB générés** sans avoir régénéré (`database.types.ts` stale au moins sur waitlist).
7. **NE PAS appeler le worker audio depuis le frontend** — il vit sur Render et polle prod direct.
8. **MCP `apply_migration` génère son propre version timestamp** — réaligner `schema_migrations.version` après chaque apply.
9. **RLS recursion piège** : ne jamais ajouter une policy sur `purchases` qui référence `products`.
10. **Le site est en `maintenance_mode=true` + `site_access_mode=public`** — MaintenanceScreen + LaunchScreen sont les surfaces actuelles, pas la marketplace classique.
11. **hCaptcha obligatoire** sur tout flux passant par `auth-signup/login/forgot-password/join-waitlist`.

---

**FIN DU DOCUMENT.** Prêt à itérer sur les décisions D-1 à D-10 et à entamer les pré-requis bloquants.
