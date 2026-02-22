# AI Admin Agent (Battles) - Setup and Verification

## Scope
This rollout is additive and keeps existing battles/votes/comments flows intact.

## Existing RPCs confirmed
- `admin_validate_battle`
- `admin_cancel_battle`
- `finalize_battle`
- `finalize_expired_battles`
- `record_battle_vote`

## Existing comment moderation fields confirmed
- `public.battle_comments.is_hidden`
- `public.battle_comments.hidden_reason`

## Notifications (MVP)
Current app had no dedicated admin notification pipeline for AI proposals.
This rollout adds `public.admin_notifications` + auto-enqueue trigger on `ai_admin_actions` proposals.

## New database objects (migrations)
- `20260222120000_045_create_ai_admin_tables_and_policies.sql`
- `20260222121000_046_add_agent_finalize_expired_battles_rpc.sql`
- `20260222122000_047_add_rule_based_comment_moderation_trigger.sql`

## New Edge Functions
- `agent-finalize-expired-battles`
- `ai-evaluate-battle`
- `ai-moderate-comment`

Deploy:

```bash
supabase functions deploy agent-finalize-expired-battles
supabase functions deploy ai-evaluate-battle
supabase functions deploy ai-moderate-comment
```

Required function secrets:

```bash
supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
# Optional but recommended for external scheduler calls:
supabase secrets set AGENT_CRON_SECRET=...
```

## Scheduling auto-finalization

### Option A - Supabase Scheduler / Cron (if available in your project)
Call `agent-finalize-expired-battles` every 5 or 15 minutes.
Use your project scheduler UI or an SQL cron setup already used in your environment.

Recommended cadence:
- `*/15 * * * *` for low load
- `*/5 * * * *` for tighter SLA

### Option B - External fallback (safe default)
Use an external cron (GitHub Actions, server cron, Render cron) and POST to:

`https://<PROJECT_REF>.functions.supabase.co/agent-finalize-expired-battles`

Headers:
- `Content-Type: application/json`
- `x-agent-secret: <AGENT_CRON_SECRET>`

Body example:

```json
{ "limit": 100 }
```

## UI behavior introduced
- Admin Battles page now displays:
  - AI notifications (read/unread)
  - AI inbox (proposed actions)
  - Battle recommendation actions: `Appliquer`, `Refuser`, `Laisser l'IA decider`
- Admin comment moderation now records training feedback and override status.

## Verification checklist

1. Auto-finalization
- Create an `active` battle with `voting_ends_at` in the past.
- Invoke `agent-finalize-expired-battles`.
- Verify battle is `completed` and an `ai_admin_actions` row exists with:
  - `action_type='battle_finalize'`
  - `status='executed'`
  - `ai_decision.model='rule-based'`

2. Toxic auto-moderation
- Insert a toxic/spam comment.
- Verify comment is auto-hidden (`is_hidden=true`, `hidden_reason='auto_moderated'`).
- Verify `ai_admin_actions` contains a `comment_moderation` entry.

3. Borderline manual review
- Insert a borderline comment.
- Verify `ai_admin_actions.status='proposed'`.
- Verify `admin_notifications` entry created for admin users.

4. Human override learning
- From admin UI, override a comment recommendation.
- Verify:
  - `ai_training_feedback` row created
  - `ai_admin_actions.human_override=true`
  - `ai_admin_actions.status='overridden'`

5. Battle recommendation feedback
- Run `Analyser IA` on an awaiting-admin battle.
- Click `Appliquer` or `Refuser`.
- Verify `ai_training_feedback` is written for that action.

6. No regression checks
- Existing battle listing and detail routes still load.
- Existing vote path (`record_battle_vote`) still works.
- Existing comment create/edit/delete/moderation still works.

7. Security checks
- Non-admin authenticated users cannot read/insert/update AI tables (RLS).
- No permissive `SELECT USING true` added on sensitive battle vote data.
- No DELETE policy exists on AI history tables.
