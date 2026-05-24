# Phase 0 — Production backlog drain event (2026-05-24)

## Context

When migration 261 first wired the email pipeline cron jobs in production, the workers were misconfigured (wrong auth header — fixed by migration 262). For ~20 minutes (17:00–17:17 UTC) every tick returned 401. As soon as migration 262 landed at 17:17, the workers immediately drained the pre-existing `event_outbox` backlog that had accumulated since 2026-04-04 (no email cron jobs had ever run in production since launch).

## Volumes

- 40 `event_outbox` rows processed (`USER_SIGNUP × 15`, `USER_CONFIRMED × 13`, `PRODUCER_ACTIVATED × 12`)
- 25 emails enqueued into `email_queue` (singleton templates only — purchases/receipts and battle/comment events did not exist in the backlog)
- 25 emails delivered via Resend between 17:19 and 17:20 UTC
- No failures, no retries

## Audit log — recipients

### `producer_activation` (12 emails)

| Recipient | Sent at | Resend message id |
|---|---|---|
| ludovic.ousselin+lvlm_user4@gmail.com | 17:19:02 | f7ae2afb-96bc-4043-a4d0-a0c97b944f30 |
| goldhandzbeatz@gmail.com | 17:19:02 | 65e7cf01-9f95-417c-8ab4-e332c8972a61 |
| ludovic.ousselin@gmail.com | 17:19:03 | 80ff9d12-2049-46ae-8b19-35c930402808 |
| madhega.contact@gmail.com | 17:19:03 | 375126ad-24c3-4116-a5a7-ce7faccc0a69 |
| sd.xoxlike@gmail.com | 17:19:04 | 98bbe3b2-d38f-412d-a229-fca18c7daee0 |
| flexiflex777@gmail.com | 17:19:04 | 32705a4f-6001-4b56-821a-cd2d39557e0b |
| uweboomin@gmail.com | 17:19:05 | 55dc51fe-4b4c-4a4b-a14b-20da5eec5cb0 |
| magicbtracks@gmail.com | 17:19:05 | 4f735e5b-7492-4636-9dd2-ca6fbe235a5e |
| sonokinesis384@gmail.com | 17:20:02 | a2fdefa7-1ede-4b33-9f80-4688f9774b42 |
| consulting@kym-factory.fr | 17:20:03 | c770ec64-2a73-49be-88b9-2d3aea04a2c0 |
| mlbh93097@gmail.com | 17:20:03 | a721fefb-8913-417c-8ace-b1058fa994d3 |
| antwann.haskins@yahoo.com | 17:20:03 | 68ce5663-4e1a-471c-a0ed-cab1446f180b |

### `welcome_user` (13 emails)

| Recipient | Sent at | Resend message id |
|---|---|---|
| ludovic.ousselin@gmail.com | 17:19:01 | c3b754a9-e467-4382-99b5-99174fb7181b |
| ludovic.ousselin+lvlm_user4@gmail.com | 17:19:02 | 6ef3b49e-f805-4400-896a-66d024c880df |
| ludovic.ousselin+lvlm_prod1@gmail.com | 17:19:02 | d329dfa6-5209-4643-964b-c7ede4fd0eeb |
| goldhandzbeatz@gmail.com | 17:19:02 | 3d89d3de-eb9c-4726-9c06-6036ef0662e0 |
| madhega.contact@gmail.com | 17:19:03 | 83cb12a3-b485-48ba-aae3-299ad9ea23f9 |
| gachemathieu@hotmail.fr | 17:19:03 | ed1962a9-3c65-496e-96ee-acc3a40b6322 |
| sd.xoxlike@gmail.com | 17:19:04 | ddb31f50-f72a-456e-ba1c-41f555345148 |
| flexiflex777@gmail.com | 17:19:04 | 0812f153-31a8-4aef-9b5e-64771ec07843 |
| uweboomin@gmail.com | 17:19:04 | 975e8b37-7e5d-41e9-9054-fd4673d08f26 |
| magicbtracks@gmail.com | 17:19:05 | 7ddb82f9-b0ea-47ca-a49d-8d0b3dd869d5 |
| mlbh93097@gmail.com | 17:19:05 | cf432d01-5508-4b1b-a6fc-07c88ae474bc |
| sonokinesis384@gmail.com | 17:19:06 | 1f06561a-6335-4cdc-a06f-7b1800b69ed7 |
| consulting@kym-factory.fr | 17:20:03 | f2fb99d1-da37-4d2e-833a-0da61e10eabd |

Total: `producer_activation` × 12 + `welcome_user` × 13 = 25 emails.

## Why this happened

- Migration 175 created the helper `schedule_service_role_worker_cron` but the helper was buggy (wrong auth header).
- In production, the helper additionally skipped silently because vault secrets were missing, so the workers never ran at all between 2026-04-04 and 2026-05-24.
- The outbox accumulated `USER_SIGNUP`, `USER_CONFIRMED`, `PRODUCER_ACTIVATED` rows for every signup, all in `status='pending'`.
- Migration 261 scheduled the workers with the buggy helper (still wrong auth → 401s).
- Migration 262 fixed the auth header → workers started draining immediately.

## Prevention

- Migration 264 introduces an `email_pipeline_settings` row in `app_settings` with a kill-switch (`enabled`) and per-hour quota (`max_per_hour`, default 200) plus a per-batch ceiling (`max_per_batch`, default 50).
- `process-email-queue` reads this setting on every invocation, short-circuits with HTTP 200 + `{ skipped: true, reason: "kill_switch_off" }` if disabled, and limits the batch by remaining hourly budget.

## Communication

No proactive comm planned. If a recipient asks why the welcome/activation arrived weeks late, point at this drain event and explain the recovery.
