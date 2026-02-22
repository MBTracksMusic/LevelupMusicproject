# Admin Battles Control Pack

Ce document accompagne le script `docs/sql/admin-battles-extension-smoke-pack.sql`.

## Pourquoi `admin_required` peut apparaître dans SQL Editor

Dans Supabase SQL Editor, chaque clic sur **RUN** peut ouvrir un contexte différent. Les valeurs JWT simulées via `set_config(...)` ne sont pas garanties d'être conservées d'un RUN à l'autre.

La RPC `public.admin_extend_battle_duration(...)` vérifie `public.is_admin(auth.uid())`.

Si `set_config('request.jwt.claim.sub', ...)` n'est pas exécuté dans le **même script RUN** que l'appel RPC:
- `auth.uid()` peut rester `NULL`
- `public.is_admin(auth.uid())` retourne `false`
- la RPC lève `admin_required`

Le pack place volontairement `set_config(...)` et tous les appels RPC dans un seul script transactionnel.

## Comment lancer le pack

1. Ouvrir Supabase SQL Editor.
2. Copier/coller **tout** le contenu de `docs/sql/admin-battles-extension-smoke-pack.sql`.
3. Exécuter en un seul RUN (ne pas découper le script).
4. Lire les résultats des `SELECT` finaux:
   - `_smoke_ctx` (contexte détecté)
   - `_smoke_results` (PASS/FAIL/SKIPPED)
   - battle candidate
   - derniers logs `ai_admin_actions`

Le script utilise `BEGIN; ... ROLLBACK;` pour éviter tout changement durable (dry-run).

## Sorties attendues

Sanity:
- `select auth.uid()` avant `set_config` peut être `NULL`
- après setup, `current_setting('request.jwt.claim.sub', true)` et `auth.uid()` doivent correspondre à un admin
- `public.is_admin(auth.uid())` doit être `true`

Tests coeur:
- `core.extend_plus_1_day_updates_end_and_log` => `PASS`
- `core.invalid_extension_days_error` => `PASS`
- `core.battle_not_open_for_extension_error` => `PASS`
- `core.battle_has_no_voting_end_error` => `PASS`

Tests limites (si `battles.extension_count` existe):
- `limits.extension_count_increment` => `PASS`
- `limits.maximum_extensions_reached_error` => `PASS`
- `limits.battle_extension_limit_exceeded_error` => `PASS`
- `limits.battle_already_expired_error` => `PASS`

Si `battles.extension_count` n'existe pas, les tests `limits.*` sont `SKIPPED` par design.

## Diagnostic explicite inclus

Le pack signale aussi les incohérences de schéma sans modifier la DB:
- RPC `public.admin_extend_battle_duration` absente => tests RPC marqués `SKIPPED/FAIL`
- contrainte `ai_admin_actions_action_type_check` ne contenant pas `battle_duration_extended` => résultat `WARN`

Ce comportement est volontairement non destructif et purement diagnostique.
