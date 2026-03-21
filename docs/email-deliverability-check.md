# Beatelion Email Deliverability Check (Gmail)

This guide verifies that emails sent as `Beatelion <contact@beatelion.com>` pass:

- SPF
- DKIM
- DMARC

Applies to:

- Supabase Auth emails (signup confirmation, reset password)
- Transactional emails sent by Supabase Edge Functions via Resend

## 1) Send a test email

Trigger a real email from the system, for example:

- Signup confirmation email
- Password reset email

Use a Gmail inbox as the recipient.

## 2) Open the email in Gmail

Open the delivered message in Gmail.

## 3) Open "Show original"

In the message view:

1. Click the three-dot menu next to the reply button.
2. Click **Show original**.

## 4) Check authentication results

At the top of the "Show original" page, verify:

- SPF: `PASS`
- DKIM: `PASS`
- DMARC: `PASS`

Also inspect the `Authentication-Results` header.

Expected pattern:

```txt
Authentication-Results: mx.google.com;
  dkim=pass header.i=@beatelion.com;
  spf=pass smtp.mailfrom=contact@beatelion.com;
  dmarc=pass header.from=beatelion.com;
```

## 5) Troubleshooting

### SPF fail

Likely cause:

- Sending infrastructure not authorized in DNS SPF record for the sender domain.

Action:

- Verify SPF TXT record for `beatelion.com`.
- Ensure the Resend-required include/mechanism is present.

### DKIM fail

Likely cause:

- DKIM DNS record is missing/incorrect, or signature/domain mismatch.

Action:

- Verify DKIM selector/host and TXT value exactly match Resend dashboard values.

### DMARC fail

Likely cause:

- SPF and DKIM alignment with `From: beatelion.com` is broken.

Action:

- Ensure `From` domain alignment with DKIM signing domain.
- Ensure SPF passes and aligns with the visible From domain policy.

## 6) Optional external validation tools (no repo dependency)

- MXToolbox SPF lookup
- DMARC analyzer tools

Use these to double-check DNS state before production launch.

## 7) Check inbox placement

After SPF, DKIM, and DMARC checks pass, verify where the email lands in Gmail.

Steps:

1. Open Gmail and locate the delivered test message.
2. Check which folder/tab received it.
3. Expected location:
   - Inbox (Primary tab preferred)
   - Updates tab acceptable
4. Note: Gmail can classify some transactional emails in the Updates tab.
5. If the email lands in Spam, investigate likely causes:
   - low sender reputation
   - spam-trigger wording in subject/body
   - excessive image-heavy content vs text
   - missing user engagement signals (opens, replies, safe marking)
   - recently created or low-trust sending domain

Important:

SPF, DKIM, and DMARC prove sender authenticity and alignment, but they do not guarantee inbox placement.

Example:

"If SPF, DKIM and DMARC pass but the email still lands in spam, the issue is usually sender reputation or content quality."

### If the email lands in Spam

Ask the tester to:

1. Click **"Not spam"** in Gmail.
2. Add the sender (`contact@beatelion.com`) to contacts.
3. Reply once to the email.

During early domain warm-up, positive user actions such as opening, replying, or marking a message as "Not spam" help mailbox providers build sender reputation.

## 8) Gmail clipping prevention

Gmail can clip emails when the HTML body is larger than about 102 KB.
When clipping happens, Gmail hides the bottom of the message behind a
"View entire message" link.

Impact:

- important footer content may be hidden
- CTA buttons placed near the bottom can become less visible
- tracking or diagnostics pixels near the end can be skipped

Beatelion guardrail:

- `process-email-queue` now logs a warning when generated email HTML approaches the limit (above ~90 KB), to keep a safety margin before Gmail clipping.
