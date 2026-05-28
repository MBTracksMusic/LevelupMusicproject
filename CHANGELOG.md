# Changelog

## 2026-05-26 - Storyteller share

- Added backend support for autonomous post-battle sharing by the non-winning producer: `battle_share_events`, `get_loser_share_data`, `record_loser_battle_share`, and the `storyteller_share` reputation rule.
- Storyteller XP is blocked by default with `app_settings.storyteller_share_config.enabled_from = null`; activate it manually at deployment time to avoid retroactive XP.
- Added a feedback-page share modal with three editable templates and one-time Storyteller XP award tracking.
- Added a neutral OG image variant behind `is_loser_card=true`, using top traits from `battle_vote_feedback`.
- Added FR/EN/ES/DE labels for the share templates, modal controls, and voted criteria.
- Added unit tests for share visibility/template generation and a SQL smoke test for RPC access, trait ordering, XP idempotency, and the no-retroactive-XP rule.

### Local database verification before merge

The current CI runs typecheck/lint/build on push and PR, but it does not run `supabase db lint`. To do the final database safety check locally:

```bash
open -a Docker
supabase start
supabase db reset
supabase db lint --local
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/storyteller_share.sql
```

`supabase db lint --local` needs the local Supabase Postgres container on `127.0.0.1:54322`. If Docker is not running, the command fails before linting.
