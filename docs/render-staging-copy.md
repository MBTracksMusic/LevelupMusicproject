# Copie Render pour staging

Objectif: avoir un worker Render staging isole, identique au worker production, pour tester les parametres audio avant de les appliquer en production.

## Service cree dans `render.yaml`

Le Blueprint declare maintenant deux workers:

| Service Render | Branche Git | Usage |
| --- | --- | --- |
| `beatelion-audio-worker` | `main` | Production |
| `beatelion-audio-worker-staging` | `staging` | Tests pre-production |

Les deux services utilisent le meme Dockerfile:

- Root Directory: `audio-worker`
- Dockerfile Path: `./Dockerfile`
- Docker Context: `.`
- Auto deploy: commit

## Secrets a renseigner dans Render

Dans le service `beatelion-audio-worker-staging`, renseigner manuellement les secrets avec les valeurs staging uniquement:

```env
SUPABASE_URL=<url du projet Supabase staging>
SUPABASE_SERVICE_ROLE_KEY=<service_role du projet Supabase staging>
```

Ne jamais mettre les valeurs du projet Supabase production dans le service staging.

Les autres variables non sensibles sont declarees dans `render.yaml`:

```env
SUPABASE_AUDIO_BUCKET=beats-masters
SUPABASE_WATERMARKED_BUCKET=beats-watermarked
SUPABASE_WATERMARK_ASSETS_BUCKET=watermark-assets
WORKER_ID=render-audio-worker-staging-1
BATCH_LIMIT=3
DOWNLOAD_MASTER_MAX_BYTES=52428800
POLL_INTERVAL_MS=5000
ERROR_BACKOFF_MS=5000
```

## Creation depuis Render

Option recommandee si le Blueprint Render est deja connecte:

1. Pousser la branche `staging` avec le `render.yaml` mis a jour.
2. Ouvrir Render Dashboard.
3. Aller dans le Blueprint du repository.
4. Lancer une synchronisation du Blueprint.
5. Verifier que Render propose ou cree `beatelion-audio-worker-staging`.
6. Renseigner `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` avec les valeurs staging.
7. Lancer un deploy manuel du service staging si necessaire.

Option manuelle:

1. Render Dashboard -> New -> Background Worker.
2. Repository: `MBTracksMusic/beatelionprojet`.
3. Branch: `staging`.
4. Runtime: Docker.
5. Root Directory: `audio-worker`.
6. Dockerfile Path: `./Dockerfile`.
7. Docker Context: `.`.
8. Ajouter les variables listees ci-dessus.

## Test de validation staging

1. Verifier dans Supabase staging qu'un `site_audio_settings` actif existe avec `watermark_audio_path`.
2. Ajouter ou republier un beat de test dans staging.
3. Verifier qu'un job `audio_processing_jobs` passe en `queued`.
4. Dans les logs Render staging, chercher:
   - `claimed_jobs`
   - `job_started`
   - `job_succeeded`
5. Verifier dans Supabase staging que le produit a:
   - `processing_status = done`
   - `watermarked_path`
   - `preview_url`
   - `preview_signature`

## Passage en production

Une fois les tests staging valides:

1. Copier uniquement les changements de code/config valides vers `main`.
2. Ne pas copier les secrets staging vers production.
3. Deployer `beatelion-audio-worker` sur Render production.
4. Surveiller les premiers logs production apres deploy.

Note Render: les variables avec `sync: false` sont demandees lors de la creation initiale du service. Pour un service deja cree, ajouter ou modifier ces secrets directement dans le Dashboard Render.
