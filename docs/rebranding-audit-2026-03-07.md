# Audit technique rebranding LevelUpMusic -> Beatelion

Date: 2026-03-07

## Scope scanne
- Dossiers demandes: `src/`, `supabase/`, `api/`, `audio-worker/`, `contract-service/`, `migrate-masters/`, `public/`
- Dossiers demandes mais absents dans ce repo: `scripts/`, `config/` (racine)
- Patterns scannes: `levelupmusic`, `LevelUpMusic`, `LEVELUPMUSIC`, `level-up-music`, `level_up_music`, plus `levelup` pour les references marque adjacentes.

## Etape 1 - Scan complet des references marque
Occurrences initiales detectees dans:
- `audio-worker/README.md`
- `audio-worker/package.json`
- `audio-worker/package-lock.json`
- `contract-service/README.md`
- `migrate-masters/package.json`
- `migrate-masters/package-lock.json`
- `migrate-masters/src/supabaseClient.ts`
- `public/favicon.svg`
- `src/lib/i18n/translations/fr.ts`
- `src/lib/i18n/translations/en.ts`
- `src/lib/i18n/translations/de.ts`
- `src/lib/supabase/client.ts`
- `supabase/functions/_shared/forumAgents.ts`
- `supabase/functions/broadcast-news/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/migrations/20260125150850_001_create_user_roles_and_profiles.sql`
- `supabase/migrations/20260125151003_002_create_products_schema.sql`
- `supabase/migrations/20260125151043_003_create_purchases_and_entitlements.sql`
- `supabase/migrations/20260125151124_004_create_battles_schema.sql`
- `supabase/migrations/20260125151158_005_create_stripe_and_audit_schema.sql`
- `supabase/migrations/20260302110000_100_forum_agents_base.sql`
- `index.html`

## Etape 2 - Valeurs hardcodees
Domaines / URLs / emails identifies:
- Runtime avant correction: `https://levelupmusic.com` dans `supabase/functions/broadcast-news/index.ts`
- Runtime apres correction: `https://beatelion.com` dans `supabase/functions/broadcast-news/index.ts`
- Migration legacy (reste volontaire): `forum-assistant@levelupmusic.local` dans migration SQL
- Cle auth front: `sb-levelupmusic-auth` dans `src/lib/supabase/client.ts`
- I18n local storage key: `levelup-language` dans `src/lib/i18n/index.ts`

Stripe hardcode critique detecte (a ne pas modifier):
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRODUCER_PRICE_ID` dans `.env/.env.example`
- references `price_...`, webhook handling, metadata dans `supabase/functions/*stripe*` et `create-checkout`/`producer-checkout`

## Etape 3 - Audit frontend (pages/components/layouts)
Resultat:
- Pas de texte `LevelUpMusic` trouve directement dans `src/pages`, `src/components`, `src/layouts`.
- Les textes visibles provenaient surtout de `src/lib/i18n/translations/*` + SEO (`index.html`) + `public/favicon.svg`.

Actions appliquees:
- Rebranding UI et legal dans `fr/en/de`.
- Titre HTML et metas SEO mis a jour.
- Label ARIA favicon mis a jour.

## Etape 4 - Audit SQL (migrations)
Constat:
- `LevelUpMusic` apparait dans 5 migrations historiques sous forme de commentaires d'entete.
- Une migration seed (`20260302110000_100_forum_agents_base.sql`) contient des valeurs de settings (`LevelUp Assistant`, `levelup_assistant`, `forum-assistant@levelupmusic.local`).
- Aucune table/view/policy/trigger/function nommee avec `LevelUpMusic`.

Decision:
- Migrations existantes non modifiees (conformite a la contrainte `NEVER MODIFY`).

## Etape 5 - Audit Supabase Storage
Buckets identifies:
- `beats-masters`
- `beats-watermarked`
- `beats-audio`
- `watermark-assets`
- `contracts`
- `avatars`
- `beats-covers`

Resultat:
- Aucun path storage metier contenant `levelupmusic`.
- References restantes `levelup*` cote worker concernent nom de process/temp path/x-client-info, pas des buckets.

## Etape 6 - Audit Edge Functions
Fonctions a risque marque/domaine:
- `supabase/functions/broadcast-news/index.ts`: fallback domaine + texte email marque (corrige)
- `supabase/functions/stripe-webhook/index.ts`: sujet email client (corrige)
- `supabase/functions/_shared/forumAgents.ts`: fallback assistant brand (corrige)

Risques domaine:
- `create-checkout` valide strictement les origins via env allowlist (`APP_URL`, `SITE_URL`, `PUBLIC_SITE_URL`, `VITE_APP_URL`, `CHECKOUT_REDIRECT_ALLOWLIST`).
- `producer-checkout` et `create-portal-session` dependaient de `origin` fallback; necessite config explicite sur nouveau domaine.

## Etape 7 - Audit Stripe
Constat:
- Flux checkout/webhook/metadata en place et coherent.
- Aucun `LevelUpMusic` restant dans metadata Stripe metier apres correction.
- Identifiants critiques presents (`price_id`, `webhook secret`) et laisses intacts.

Regle appliquee:
- `DO_NOT_TOUCH`: `price_id`, `product_id`, `whsec_*`, secret keys.

## Etape 8 - Audit workers audio
`audio-worker`:
- Aucune reference domaine `levelupmusic.com` dans pipeline audio.
- References `levelup*` restantes techniques:
  - package name
  - `TMP_ROOT` fallback (`levelup-audio-worker`)
  - `X-Client-Info`
- Buckets audio corrects et alignes (`beats-masters`, `beats-watermarked`, `watermark-assets`, fallback `beats-audio`).

## Etape 9 - Audit config infra
Fichiers presents:
- `.env`, `.env.example`, `audio-worker/.env`, `contract-service/.env`

Fichiers absents:
- `.env.production`
- `render.yaml`
- `docker-compose.yml` / `docker-compose.yaml`
- dossier `config/` (racine)

Variables de branding explicites manquantes:
- pas de `APP_NAME`, `SITE_NAME`, `DOMAIN`, `PUBLIC_URL` dans `.env` actuel.

## Etape 10 - Audit SEO
- Le repo utilise `index.html` a la racine (pas `public/index.html`).
- Mises a jour faites:
  - `title`
  - `meta description`
  - `og:title`
  - `og:site_name`
  - `twitter:title`

## Etape 11 - Classification des occurrences
SAFE_TO_REPLACE (effectue)
- textes UI i18n
- titre SEO / metadata SEO
- label ARIA favicon
- sujet email client stripe webhook
- texte lien email broadcast
- fallback domaine broadcast

REVIEW_REQUIRED (reste)
- `src/lib/supabase/client.ts`: `storageKey: 'sb-levelupmusic-auth'`
- `src/lib/i18n/index.ts`: `I18N_STORAGE_KEY = 'levelup-language'`
- `audio-worker/src/config.ts`: temp root `levelup-audio-worker`
- `audio-worker/src/supabaseClient.ts`: `X-Client-Info: levelup-audio-worker/1.0.0`
- `migrate-masters/src/supabaseClient.ts`: `x-client-info: levelupmusic-migrate-masters/1.0.0`
- package names outils (`audio-worker`, `migrate-masters`)

DO_NOT_TOUCH
- migrations SQL historiques existantes
- ids Stripe (`price_*`, `prod_*`), webhook secrets (`whsec_*`), secret keys
- project id Supabase et URLs projet
- endpoint webhook en production

## Etape 12 - Centralisation branding
Ajout effectue:
- `src/config/branding.ts`

Utilisation appliquee:
- `src/lib/i18n/translations/fr.ts`
- `src/lib/i18n/translations/en.ts`
- `src/lib/i18n/translations/de.ts`

## Etape 13 - Simulation migration domaine
Etat actuel:
- Aucune URL runtime `levelupmusic.com` restante hors migration historique.
- URL migration historique restante: `forum-assistant@levelupmusic.local` (seed legacy, non runtime direct).

Checklist de migration domaine recommandee:
- definir `APP_URL=https://beatelion.com`
- definir `SITE_URL=https://beatelion.com`
- definir `PUBLIC_SITE_URL=https://beatelion.com`
- definir `CHECKOUT_REDIRECT_ALLOWLIST=https://beatelion.com`
- verifier success/cancel URLs checkout + portal return_url

## Etape 14 - Tests post-audit
Tests executes:
- `npm run typecheck` -> OK
- `npm run build` -> OK

Tests metier non executes ici (besoin env integre Supabase/Stripe):
- login
- upload beat
- battle system
- audio preview
- stripe checkout reel
- admin dashboard

## Fichiers modifies
- `src/config/branding.ts`
- `src/lib/i18n/translations/fr.ts`
- `src/lib/i18n/translations/en.ts`
- `src/lib/i18n/translations/de.ts`
- `index.html`
- `public/favicon.svg`
- `supabase/functions/broadcast-news/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/_shared/forumAgents.ts`
- `audio-worker/README.md`
- `contract-service/README.md`
- `README.md`

## Occurrences restantes
`levelupmusic` exact:
- `audio-worker/package.json`
- `audio-worker/package-lock.json`
- `migrate-masters/package.json`
- `migrate-masters/package-lock.json`
- `migrate-masters/src/supabaseClient.ts`
- `src/lib/supabase/client.ts`
- `supabase/migrations/20260125150850_001_create_user_roles_and_profiles.sql`
- `supabase/migrations/20260125151003_002_create_products_schema.sql`
- `supabase/migrations/20260125151043_003_create_purchases_and_entitlements.sql`
- `supabase/migrations/20260125151124_004_create_battles_schema.sql`
- `supabase/migrations/20260125151158_005_create_stripe_and_audit_schema.sql`
- `supabase/migrations/20260302110000_100_forum_agents_base.sql`

Justification:
- tools internes / telemetry / session key (`REVIEW_REQUIRED`)
- migrations historiques immuables (`DO_NOT_TOUCH`)

## Risques critiques
- Webhooks Stripe: ne pas changer secrets ni signature workflow.
- Storage Supabase: ne pas renommer buckets existants en place sans plan de migration objets + policies.
- Workers audio: toute modif bucket/env doit rester coherente entre edge functions, worker et policies SQL.
- Auth: changer `storageKey` front peut deconnecter les sessions actives.
- SEO: verifier publication index final + cache CDN apres deploy.

## Plan de migration recommande
1. Rebranding UI (fait): traductions + SEO + emails visibles.
2. Mise a jour domaine: variables `APP_URL/SITE_URL/PUBLIC_SITE_URL/CHECKOUT_REDIRECT_ALLOWLIST`.
3. Mise a jour Stripe: verifier `success_url/cancel_url/return_url` et endpoints sans toucher aux IDs.
4. Mise a jour emails: `EMAIL_FROM`, `RESEND_FROM_EMAIL`, support email sur domaine Beatelion.
5. Deploiement Render: deploy progressif + smoke tests login/upload/battle/preview/checkout/admin.
