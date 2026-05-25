# Phase 1 — Staging Fixtures for Feedback Dashboard

5 deterministic, idempotent fixtures seeded on **staging only**
(`beatelion-staging`, project `haebgsnncuikvfgivxwk`) for visual + payload
testing of the public route `/battles/:slug/feedback` before the frontend
exists.

**Seed source** : [supabase/seeds/phase1-feedback-fixtures.sql](../supabase/seeds/phase1-feedback-fixtures.sql)
**Run** : `psql "$STAGING_DB_URL" -f supabase/seeds/phase1-feedback-fixtures.sql`

> ⚠️ The `generate_battle_slug_trigger` rewrites slugs from the battle title.
> The slugs below are the **actual URL-bound slugs** observed in staging DB,
> not the seed source names. Accents are stripped imperfectly by the trigger
> (e.g. "écrasante" → "crasante") — known cosmetic issue unrelated to Phase 1.

---

## Fixture #1 — Victoire écrasante

| | |
|---|---|
| **Slug** | `phase1-fixture-1-victoire-crasante` |
| **URL** | `/battles/phase1-fixture-1-victoire-crasante/feedback` |
| **Use case** | Winner mis en avant, runner-up traité avec respect |

**Battle state** : producer1 (16) vs producer2 (4), winner=producer1 (80%)

**Payload key values** :
- `meta.battle_size = "medium"`, `total_voters = 20`, `total_feedback = 20`
- `meta.coherence_data_sufficient = true`
- `ranking[0]` = producer1 (`quality_index = 77.692`)
- `ranking[1]` = producer2 (`quality_index = 39.327`)
- `snapshots[0].scores = {artistic: 79.808, coherence: 100, credibility: 50, preference: 75}`
- `snapshots[1].scores = {artistic: 76.923, coherence: 0, credibility: 50, preference: 25}` ⚠️ coherence=0 car <5 feedback pour ce produit seul
- `top_criteria` : `groove (70%)`, `melody (15%)`, `drums (10%)` — **critère dominant**

**Visual expectation** : grosse différence de quality_index → barre/badge sans ambiguïté pour producer1. Producer2 affiche quand même son radar (coherence à 0 doit avoir le tooltip "données insuffisantes" pour CE produit, pas la battle entière).

---

## Fixture #2 — Match serré

| | |
|---|---|
| **Slug** | `phase1-fixture-2-match-serr` |
| **URL** | `/battles/phase1-fixture-2-match-serr/feedback` |
| **Use case** | Ranking lisible malgré scores proches |

**Battle state** : producer1 (11) vs producer2 (9), winner=producer1 (55%)

**Payload key values** :
- `meta.battle_size = "medium"`, `total_voters = 20`, `total_feedback = 20`
- `ranking[0]` = producer1 (`quality_index = 69.13`)
- `ranking[1]` = producer2 (`quality_index = 64.526`) — **écart ~5 pts**
- Les deux ont `coherence > 95` car total_feedback per product >= 5
- `top_criteria` : `groove (35%)`, `melody (35%)`, `energy (30%)` — **dispersés**

**Visual expectation** : on doit voir que producer1 gagne mais l'écart est minime — typo / iconographie doit refléter "victoire de justesse". Top criteria affichés en trio compact (pas de critère dominant visuel).

---

## Fixture #3 — Data insuffisante

| | |
|---|---|
| **Slug** | `phase1-fixture-3-data-insuffisante` |
| **URL** | `/battles/phase1-fixture-3-data-insuffisante/feedback` |
| **Use case** | Graceful degradation UI, tooltip data insuffisante |

**Battle state** : producer3 (2) vs producer4 (1), winner=producer3

**Payload key values** :
- `meta.battle_size = "small"`, `total_voters = 3`, `total_feedback = 3`
- **`meta.coherence_data_sufficient = false`** ← critère pour overlay/tooltip global
- `snapshots[*].scores.coherence = 0` ← cutoff appliqué côté compute
- `top_criteria` : `energy (33.33%)`, `groove (33.33%)`, `melody (33.33%)` — 3 valeurs égales (1 vote chacune)

**Visual expectation** : sur l'axe `coherence` du radar, afficher un overlay/badge "Données insuffisantes" basé sur `coherence_data_sufficient=false`. Ne PAS afficher "0/100" comme un vrai score. Les autres axes (artistic, preference, credibility) s'affichent normalement.

---

## Fixture #4 — Égalité parfaite

| | |
|---|---|
| **Slug** | `phase1-fixture-4-galit-parfaite` |
| **URL** | `/battles/phase1-fixture-4-galit-parfaite/feedback` |
| **Use case** | Pas de "winner" affiché, runner-up label adapté, criteria égaux |

**Battle state** : producer3 (6) vs producer4 (6), **winner_id = NULL** (tie)

**Payload key values** :
- `meta.battle_size = "medium"`, `total_voters = 12`, `total_feedback = 12`
- `ranking[0]` et `ranking[1]` ont **exactement le même `quality_index = 66.401`**
- `ranking` est trié par `(quality_index DESC, product_id)` — donc l'égalité est stable mais arbitraire
- Les 2 snapshots ont des scores **strictement identiques** (artistic 82.051, coherence 95.238, credibility 50, preference 50)
- `top_criteria` : `energy (33.33%)`, `groove (33.33%)`, `melody (33.33%)` — 4 votes chacun

**Visual expectation** : afficher "Égalité" (pas de "Vainqueur"). Les deux cards doivent être visuellement équivalentes (pas de hiérarchie ranking #1 / #2 marquée). Top criteria affichés en trio égal. **Note backend** : si front a besoin de détecter l'égalité, utiliser `battle.winner_id === null` (non exposé dans le payload actuel — à ajouter si nécessaire OU détecter via `ranking[0].quality_index === ranking[1].quality_index`).

---

## Fixture #5 — Battle populaire (large)

| | |
|---|---|
| **Slug** | `phase1-fixture-5-battle-populaire` |
| **URL** | `/battles/phase1-fixture-5-battle-populaire/feedback` |
| **Use case** | Layout tient avec gros chiffres, battle_size='large' |

**Battle state** : producer5 (32) vs producer1 (28), winner=producer5

**Payload key values** :
- **`meta.battle_size = "large"`**, `total_voters = 60`, `total_feedback = 60`
- `ranking[0]` = producer5 (`quality_index = 68.281`)
- `ranking[1]` = producer1 (`quality_index = 65.654`)
- Les deux producers ont `votes_total = 60`, `votes_for_product` = 32 et 28 respectivement
- `top_criteria` : `groove (50%)`, `melody (30%)`, `energy (20%)`

**Visual expectation** : grands nombres (60 voters, 32-28 votes) doivent rester lisibles. Pas de troncature des avatars/noms. `meta.battle_size='large'` peut déclencher un layout différent (badge "Battle populaire", typo plus grosse, etc.) si tu veux différencier en Phase 1.

---

## Champs communs à tous les payloads (rappel)

```jsonc
{
  "battle": {
    "id": "uuid",
    "slug": "string (auto-généré par trigger depuis le title)",
    "title": "string",
    "status": "completed",
    "battle_tier": "standard",
    "winner_product_id": "uuid | null",    // null si tie OU pas finalisé
    "is_tie": false,                       // true UNIQUEMENT si winner_id NULL ET status='completed'
    "finalized_at": "2026-05-22T21:41:58Z",
    "voting_started_at": "2026-05-17T21:41:58Z",
    "voting_ended_at": "2026-05-22T21:41:58Z",
    "voting_duration_seconds": 432000      // 5 jours, retourné en STRING JSON → parseInt côté front
  },
  "viewer": { "is_authenticated": false, "voted": false, "vote": null },
  "meta": {
    "total_feedback": <int>,
    "total_voters": <int>,
    "battle_size": "small|medium|large",
    "coherence_data_sufficient": <bool>,
    "credibility_dynamic": false           // sera true en Phase 2/3 quand on scorera la crédibilité
  }
}
```

## Avatars

Tous les producers ont un `avatar_url` Lorem Picsum :
```
https://picsum.photos/seed/phase1-producer-{1..5}/200/200
```

## Re-run / cleanup

Le seed est **100% idempotent** via `ON CONFLICT DO NOTHING` (rows) et `ON CONFLICT DO UPDATE` (snapshots). Re-lancer le seed refresh les snapshots sans dupliquer les votes/feedback.

Pour **supprimer** les fixtures (si besoin de remettre staging à zéro Phase 1) :
```sql
DELETE FROM public.battle_vote_feedback WHERE battle_id IN (
  SELECT id FROM public.battles WHERE slug LIKE 'phase1-fixture-%'
);
DELETE FROM public.battle_quality_snapshots WHERE battle_id IN (
  SELECT id FROM public.battles WHERE slug LIKE 'phase1-fixture-%'
);
DELETE FROM public.battle_votes WHERE battle_id IN (
  SELECT id FROM public.battles WHERE slug LIKE 'phase1-fixture-%'
);
DELETE FROM public.battles WHERE slug LIKE 'phase1-fixture-%';
DELETE FROM public.products WHERE slug LIKE 'phase1-beat-%';
DELETE FROM public.user_profiles WHERE username LIKE 'phase1_%';
DELETE FROM auth.users WHERE email LIKE 'phase1-%@fixtures.local';
```

(Ordre important pour respecter les FK.)
