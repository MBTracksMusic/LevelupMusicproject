# Beatelion Audio Worker

Worker audio externe pour Render/Docker. Il consomme la queue SQL `audio_processing_jobs`, lit les masters depuis le bucket canonique `beats-masters` avec fallback dev possible vers `beats-audio`, applique le watermark global défini dans `site_audio_settings`, génère des previews MP3 versionnées avec FFmpeg natif, puis les publie dans `beats-watermarked`.

## Architecture

- Source master: bucket privé `beats-masters`
- Source watermark: bucket privé `watermark-assets`
- Source settings: table `site_audio_settings`
- Queue: table `audio_processing_jobs` + RPC `claim_audio_processing_jobs`
- Sortie preview: bucket public `beats-watermarked`
- État produit mis à jour: `watermarked_path`, `preview_url`, `preview_version`, `preview_signature`, `last_watermark_hash`, `processed_at`, `processing_status`, `processing_error`

## Variables d'environnement

Obligatoires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Compatibles avec le contrat demandé:

- `SUPABASE_AUDIO_BUCKET=beats-masters`
- `LEGACY_BUCKET=beats-audio`
- `SUPABASE_WATERMARKED_BUCKET=beats-watermarked`
- `SUPABASE_WATERMARK_ASSETS_BUCKET=watermark-assets`
- `WORKER_ID`
- `BATCH_LIMIT`
- `DOWNLOAD_MASTER_MAX_BYTES`

Optionnelles mais utiles:

- `POLL_INTERVAL_MS`
- `ERROR_BACKOFF_MS`
- `FFMPEG_BIN`
- `FFPROBE_BIN`
- `WATERMARK_MAX_BYTES`
- `PREVIEW_AUDIO_BITRATE`
- `PREVIEW_AUDIO_SAMPLE_RATE`
- `TMP_ROOT`
- `SHUTDOWN_GRACE_MS`

Valeurs par défaut:

- `SUPABASE_AUDIO_BUCKET=beats-masters`
- `LEGACY_BUCKET=beats-audio`
- `SUPABASE_WATERMARKED_BUCKET=beats-watermarked`
- `SUPABASE_WATERMARK_ASSETS_BUCKET=watermark-assets`
- `BATCH_LIMIT=3`
- `DOWNLOAD_MASTER_MAX_BYTES=52428800`
- `POLL_INTERVAL_MS=5000`
- `ERROR_BACKOFF_MS=5000`
- `WATERMARK_MAX_BYTES=10485760`
- `PREVIEW_AUDIO_BITRATE=192k`
- `PREVIEW_AUDIO_SAMPLE_RATE=44100`

## Contrat SQL attendu

Le worker suppose:

- une RPC `claim_audio_processing_jobs` qui accepte en priorité `p_limit` et `p_worker`
- un fallback est prévu si votre signature attend `limit` et `worker_id`
- la table `products` expose au minimum:
  - `master_path`
  - `master_url`
  - `watermarked_path`
  - `preview_url`
  - `exclusive_preview_url`
  - `preview_version`
  - `preview_signature`
  - `last_watermark_hash`
  - `watermarked_bucket`
  - `processing_status`
  - `processing_error`
  - `processed_at`

## Développement local

```bash
cd audio-worker
npm install
npm run build
npm start
```

## Docker local

```bash
cd audio-worker
docker build -t beatelion-audio-worker .
docker run --rm \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e WORKER_ID=local-dev-1 \
  beatelion-audio-worker
```

## Déploiement Render

### Option Docker native

Créer un nouveau `Background Worker` ou `Web Service` Render avec Docker:

- Root Directory: `audio-worker`
- Dockerfile Path: `audio-worker/Dockerfile`
- Start command: laisser Render utiliser `CMD`

Variables d'environnement Render:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_AUDIO_BUCKET=beats-masters
LEGACY_BUCKET=beats-audio
SUPABASE_WATERMARKED_BUCKET=beats-watermarked
SUPABASE_WATERMARK_ASSETS_BUCKET=watermark-assets
WORKER_ID=render-audio-worker-1
BATCH_LIMIT=3
DOWNLOAD_MASTER_MAX_BYTES=52428800
POLL_INTERVAL_MS=5000
ERROR_BACKOFF_MS=5000
```

### Scaling

Le worker traite les jobs séquentiellement dans un conteneur. Pour scaler:

- augmenter le nombre d'instances Render
- laisser la RPC `claim_audio_processing_jobs` répartir le travail

## Test de bout en bout

1. Vérifier qu'un `site_audio_settings` actif existe avec `watermark_audio_path`.
2. Publier un produit beat avec `master_path` ou `master_url` pointant vers `beats-masters`.
3. En DEV, si le fichier n'existe pas encore dans `beats-masters` mais existe dans `beats-audio`, le worker loggue `legacy_master_fallback` et continue le traitement.
4. Vérifier qu'un job `audio_processing_jobs` est en `queued`.
5. Démarrer le worker.
6. Vérifier dans les logs:
   - `claimed_jobs`
   - `job_started`
   - `legacy_master_fallback` si applicable
   - `job_succeeded` ou `job_failed`
7. Vérifier en base que le produit a:
   - `watermarked_path=beats-watermarked/<product_id>/preview_vN.mp3`
   - `preview_url`
   - `preview_signature`
   - `last_watermark_hash`
   - `processed_at`
   - `processing_status='done'`

## Logs

Le worker loggue:

- démarrage et configuration non sensible
- jobs claimés
- produits skipés
- succès upload
- échecs FFmpeg / storage / Supabase
- arrêt propre sur `SIGINT` / `SIGTERM`

## Notes d'exploitation

- Le worker ne fait pas de traitement lourd côté Edge.
- Il refuse les masters au-delà de `DOWNLOAD_MASTER_MAX_BYTES`.
- Il ne skippe un job sur signature identique que si la preview existe réellement en storage.
- En cas d'échec, le job passe en `error` ou `dead` selon `attempts` / `max_attempts`.
