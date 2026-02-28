# migrate-masters

Utility script to copy missing master files from the legacy bucket `beats-audio` into the canonical private bucket `beats-masters`, without changing the database.

What it does:

- reads active beat products from `public.products`
- uses `master_path` as the canonical object path reference
- checks whether the object exists in the canonical bucket
- if missing, checks the same path in the legacy bucket
- if found in legacy, streams the object into the canonical bucket at the same path
- logs every result as structured JSON
- never deletes anything
- never touches previews
- never updates `master_path`

What it does not do:

- it does not repair rows where `master_path` is null or invalid
- it does not migrate previews
- it does not delete files from `beats-audio`
- it does not write to `products`

## Requirements

- Node.js `>= 18.18.0`
- `SUPABASE_SERVICE_ROLE_KEY`
- network access to Supabase

## Environment variables

Required:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LEGACY_BUCKET=beats-audio
CANONICAL_BUCKET=beats-masters
```

Optional:

```bash
PAGE_SIZE=200
SIGNED_URL_TTL_SECONDS=600
REQUEST_TIMEOUT_MS=60000
```

## Install

```bash
cd migrate-masters
npm install
```

## Run

```bash
npx ts-node src/index.ts
```

Or:

```bash
npm start
```

## Logging

The script emits JSON lines suitable for piping into a file or log processor.

Examples:

```json
{"ts":"2026-02-28T12:00:00.000Z","level":"info","event":"already_ok","product_id":"...","normalized_path":"producer-a/beat-1.wav","bucket":"beats-masters"}
{"ts":"2026-02-28T12:00:01.000Z","level":"info","event":"migrated","product_id":"...","normalized_path":"producer-a/beat-2.wav","from_bucket":"beats-audio","to_bucket":"beats-masters"}
{"ts":"2026-02-28T12:00:02.000Z","level":"info","event":"missing_everywhere","product_id":"...","normalized_path":"producer-a/beat-3.wav"}
{"ts":"2026-02-28T12:05:00.000Z","level":"info","event":"summary","total_products":120,"migrated":37,"already_ok":70,"missing_everywhere":13,"failed":0}
```

## Notes

- The script is idempotent. If an object already exists in `beats-masters`, it is logged as `already_ok` and skipped.
- Files are copied using a signed legacy download URL and a streamed upload to avoid buffering the whole audio file in memory.
- Active products are filtered as:
  - `product_type = 'beat'`
  - `is_published = true`
  - `deleted_at IS NULL`

## Recommended workflow

1. Run once in staging with production-like buckets.
2. Inspect `missing_everywhere` cases before any broader migration.
3. Run in production with logs redirected to a file:

```bash
npx ts-node src/index.ts | tee migrate-masters.log
```

4. Re-run safely as needed until `migrated` reaches zero and only `already_ok` or known `missing_everywhere` remain.
