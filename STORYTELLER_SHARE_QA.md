# Storyteller Share QA

Date: 2026-05-26

Local preview PNG: `og-loser-preview.png` (generated artifact, not intended for commit)

Generated from the local Vercel function route:

```text
http://127.0.0.1:3005/api/og/battle-image?slug=preview-storyteller&target=feedback&is_loser_card=true
```

Local Supabase env vars were not present during this preview, so the route rendered the fallback names/traits while still exercising the real `is_loser_card` OG layout.

## Anti-Retroactive Verification

The migration creates `storyteller_share_config.enabled_from` as JSON `null` by default. This blocks Storyteller XP until manual activation while still allowing share events to be logged.

Run this query after applying the migration:

```sql
SELECT
  key,
  value ? 'enabled_from' AS has_enabled_from,
  value->>'enabled_from' AS enabled_from,
  CASE
    WHEN value->>'enabled_from' IS NULL THEN 'BLOCKED_UNTIL_MANUAL_ACTIVATION'
    ELSE 'ACTIVE_FROM_' || value->>'enabled_from'
  END AS storyteller_share_xp_state
FROM public.app_settings
WHERE key = 'storyteller_share_config';
```

Expected before manual activation:

```text
key = storyteller_share_config
has_enabled_from = true
enabled_from = null
storyteller_share_xp_state = BLOCKED_UNTIL_MANUAL_ACTIVATION
```

Manual activation at deployment time:

```sql
UPDATE public.app_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{enabled_from}',
  to_jsonb(now()),
  true
)
WHERE key = 'storyteller_share_config';
```

Manual activation at an explicit deployment timestamp:

```sql
UPDATE public.app_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{enabled_from}',
  to_jsonb('2026-05-26T18:00:00+00:00'::timestamptz),
  true
)
WHERE key = 'storyteller_share_config';
```

Optional check for completed battles that remain ineligible after activation:

```sql
SELECT
  b.id,
  b.slug,
  b.created_at,
  s.value->>'enabled_from' AS enabled_from
FROM public.battles b
CROSS JOIN public.app_settings s
WHERE s.key = 'storyteller_share_config'
  AND s.value->>'enabled_from' IS NOT NULL
  AND b.status = 'completed'
  AND b.created_at <= (s.value->>'enabled_from')::timestamptz
ORDER BY b.created_at DESC
LIMIT 20;
```

## Manual QA Checklist

1. Losing producer opens the completed battle feedback page.
   Expected: the primary CTA is `Partager ma battle`; no user-visible wording says loss/loser.

2. Losing producer clicks `Partager ma battle`.
   Expected: a modal opens with three radio choices and an editable textarea.

3. Losing producer selects the neutral template.
   Expected: textarea contains the neutral copy plus the battle URL.

4. Losing producer selects the traits template.
   Expected: textarea uses the top 3 criteria voted for that producer from `battle_vote_feedback`, ordered by vote count.

5. Losing producer selects the comeback template and edits it.
   Expected: edited text is preserved when using any share channel.

6. Losing producer clicks X, Facebook, LinkedIn, or WhatsApp.
   Expected: the matching share target opens and `battle_share_events` logs the channel and selected template.

7. Losing producer clicks copy link.
   Expected: clipboard contains the editable text plus URL, and `battle_share_events.share_channel = 'copy'` is logged.

8. First effective share after manual activation.
   Expected: one `reputation_events` row is created with idempotency key `storyteller_share:{battle_id}:{producer_id}`, and the toast shows `Battle partagée ! +15 XP Storyteller 🎵`.

9. Second effective share on the same battle by the same producer.
   Expected: a new share event may be logged, but no second XP event is created.

10. Winning producer opens the same feedback page.
    Expected: existing victory share flow is unchanged; the Storyteller template modal is not shown.

11. Draw battle feedback page is opened by either producer.
    Expected: existing neutral draw sharing stays available; the Storyteller template modal is not shown.

12. Battle is not completed or the authenticated user is not one of the two producers.
    Expected: no Storyteller share CTA is shown; direct RPC calls to `get_loser_share_data` / `record_loser_battle_share` fail or return no eligible role, and no XP is credited.

## OG Image QA

Open `og-loser-preview.png`.

Expected:

- Card is 1200x630.
- Header says `Battle Beatelion`.
- Center shows producer vs opponent with identical typography.
- Three trait badges are visible.
- Footer says `Qui a gagné ? → beatelion.com`.
- No score, winner badge, or loss/loser wording appears.
