# Contract Service (Legacy)

Legacy service kept for compatibility during migration.

Canonical contract generation is now handled by the API route:

- `POST /api/generate-contract` (see `api/contract-handler.ts`)

This package is not the canonical generator in production.

## Required environment variables

- `CONTRACT_SERVICE_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional environment variables

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (default: `Beatelion <noreply@beatelion.com>`)
- `SUPPORT_EMAIL` (default: `support@beatelion.com`)
- `SUPABASE_AUDIO_BUCKET` (default: `beats-audio`)
- `CONTRACT_BUCKET` (default: `contracts`)
- `ATTACH_CONTRACT_TO_EMAIL` (`true` to attach generated PDF)

## Endpoints

- `GET /health`

`POST /generate-contract` is intentionally not exposed here.
