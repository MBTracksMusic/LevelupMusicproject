# Contract Service

Serverless Express service used by Stripe webhook callbacks to:

1. load a completed purchase from Supabase,
2. generate a contract PDF with license rights/limits,
3. upload the PDF to Supabase Storage,
4. send a buyer confirmation email via Resend.

## Required environment variables

- `CONTRACT_SERVICE_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional environment variables

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (default: `LevelUpMusic <noreply@levelupmusic.com>`)
- `SUPPORT_EMAIL` (default: `support@levelupmusic.com`)
- `SUPABASE_AUDIO_BUCKET` (default: `beats-audio`)
- `CONTRACT_BUCKET` (default: `contracts`)
- `ATTACH_CONTRACT_TO_EMAIL` (`true` to attach generated PDF)

## Endpoints

- `GET /health`
- `POST /generate-contract`
  - Header: `Authorization: Bearer <CONTRACT_SERVICE_SECRET>`
  - Body: `{ "purchase_id": "<uuid>" }`
