# Beatelion Email Pre-Launch Checklist

## A. Warm-Up Safety

Confirm before any marketing send:

- `EMAIL_DOMAIN_UNDER_30_DAYS=true` while the domain is still young
- `EMAIL_DOMAIN_WARMUP_MODE=true`
- `EMAIL_WARMUP_DAY` matches the planned ramp day
- `EMAIL_MAX_BATCH_SIZE` is at or below the current warm-up limit
- `EMAIL_FORCE_SAFE_MODE=false` unless all marketing sends must be blocked
- `EMAIL_ALLOW_LARGE_MARKETING_OVERRIDE=false` for normal launch conditions

Expected warm-up ramp:

- Day 1: 20
- Day 2: 40
- Day 3: 80
- Day 4: 150
- Day 5+: 250 or `EMAIL_WARMUP_DAY_FIVE_LIMIT`

Stop if:

- marketing sends are not capped when warm-up mode is on
- a caller can send above the warm-up threshold without an explicit warning
- logs do not show requested vs allowed count

## B. Deliverability Validation

Enable:

- `EMAIL_DEBUG_MODE=true`

Send one transactional test to each:

- Gmail
- Outlook
- Yahoo

Then send one marketing test to each only if warm-up policy allows it.

For each provider, record:

- inbox vs spam placement
- sender shown to user
- subject line
- timestamp
- `provider_message_id`

For Gmail:

1. Open message
2. Click "Show original"
3. Confirm:
   - SPF `PASS`
   - DKIM `PASS`
   - DMARC `PASS`

Stop if:

- SPF fails
- DKIM fails
- DMARC fails
- repeated spam placement occurs across Gmail, Outlook, and Yahoo
- provider message id is missing from logs

## C. Auth UX Validation

Test these flows end to end:

- confirm signup
- reset password
- magic link
- invite
- email change

For each flow, verify:

- email arrives
- no duplicate email is sent
- link opens correctly
- token is accepted by the app
- delay is acceptable
- no unsubscribe link is shown
- support/reply guidance is present

Logs to verify:

- recipient
- template key
- send state
- `provider_message_id`
- timestamp

Stop if:

- any auth link is broken or malformed
- any tokenized URL is missing `token_hash`
- duplicate sends are observed for the same auth event
- auth email lands systematically in spam

## D. Final Go / No-Go

Go only if all are true:

- marketing warm-up settings are correct
- Gmail / Outlook / Yahoo validation is complete
- Gmail original shows SPF/DKIM/DMARC `PASS`
- auth signup and reset flows succeed end to end
- no duplicate sends are observed

No-Go if any stop condition above is triggered.
