#!/bin/bash

set -euo pipefail

echo "🚀 DÉPLOIEMENT STAGING (ENV ISOLÉ)"

# =========================
# CONFIG
# =========================
EXPECTED_VERCEL_PROJECT="beatelion-staging"

# =========================
# 0. LOAD ENV
# =========================
if [ ! -f ".env.staging" ]; then
  echo "❌ Fichier .env.staging introuvable"
  exit 1
fi

set -o allexport
source .env.staging
set +o allexport

echo "🌍 ENVIRONMENT: ${ENVIRONMENT:-undefined}"
echo "📡 SUPABASE_PROJECT_REF: ${SUPABASE_PROJECT_REF:-undefined}"

# =========================
# 1. CHECK TOOLS
# =========================
for cmd in git node npm supabase vercel jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Commande manquante : $cmd"
    exit 1
  fi
done

# =========================
# 2. SAFE CHECKS (STAGING ONLY)
# =========================
if [ "${ENVIRONMENT:-}" != "staging" ]; then
  echo "❌ Mauvais environnement (attendu: staging)"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ SUPABASE_PROJECT_REF manquant"
  exit 1
fi

# 🔴 Sécurité : éviter erreur prod
if [[ "${STRIPE_SECRET_KEY:-}" == sk_live* ]]; then
  echo "❌ Stripe LIVE détecté en staging"
  exit 1
fi

# =========================
# 3. GIT FLOW (AUTO MERGE → STAGING)
# =========================
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "🌿 Branche actuelle : $CURRENT_BRANCH"

# Auto-commit si repo non clean
if [[ -n "$(git status -s)" ]]; then
  echo "📝 Changements non commités détectés — commit automatique..."
  git add src/ supabase/ public/ docs/ package*.json tsconfig*.json vite.config.* index.html render.yaml deploy-prod.sh deploy-staging.sh 2>/dev/null || true
  git commit -m "auto: staging deploy" || true
fi

git fetch origin

# Si on n'est pas sur staging → merge auto
if [[ "$CURRENT_BRANCH" != "staging" ]]; then
  echo "🔄 Checkout staging"
  git checkout staging
  git pull origin staging

  # Sync hotfixes de main (au cas où un fix a été déployé direct en prod)
  if git log staging..origin/main --oneline | grep -q .; then
    echo "🔁 Sync hotfixes main → staging"
    git merge origin/main --no-ff -m "chore: sync hotfixes main → staging"
  fi

  echo "🔀 Merge $CURRENT_BRANCH → staging"
  git merge "$CURRENT_BRANCH" --no-ff -m "chore: merge $CURRENT_BRANCH → staging"

  echo "🚀 Push staging"
  git push origin staging
fi

echo "📦 Branche finale : $(git rev-parse --abbrev-ref HEAD)"

# =========================
# 4. VERCEL LINK (STAGING)
# =========================
echo "🔗 Vérification Vercel staging..."

if [ ! -f ".vercel/project.json" ]; then
  vercel link --project "$EXPECTED_VERCEL_PROJECT"
fi

CURRENT_PROJECT_NAME=$(jq -r '.projectName' .vercel/project.json)

if [ "$CURRENT_PROJECT_NAME" != "$EXPECTED_VERCEL_PROJECT" ]; then
  vercel link --project "$EXPECTED_VERCEL_PROJECT"
fi

echo "✅ Vercel OK"

# =========================
# 5. CHECK / AUDIT
# =========================
echo "🔐 Scan sécurité..."
[ -f "./check-secrets.sh" ] && ./check-secrets.sh

echo "🔍 Audit..."
[ -f "./audit.sh" ] && ./audit.sh

echo "🛠 Auto-fix..."
[ -f "./fix.sh" ] && ./fix.sh || true

# =========================
# 6. TYPES CHECK
# =========================
TYPES_FILE="src/lib/supabase/database.types.ts"

if [ ! -f "$TYPES_FILE" ] || [ "$(wc -c < "$TYPES_FILE")" -lt 10000 ]; then
  echo "⚠️ Regénération types"
  npm run supabase:types
  git add "$TYPES_FILE"
  git commit -m "chore: regenerate types" || true
  git push origin staging
fi

# =========================
# 7. BUILD
# =========================
echo "🧪 Build..."
npm run build
echo "✅ Build OK"

# =========================
# 8. SUPABASE (STAGING)
# =========================
echo "🔗 Supabase staging..."
supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "📡 DB push..."
supabase db push

echo "⚡ Functions deploy..."
supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 9. VERCEL DEPLOY (STAGING PROD-LIKE)
# =========================
echo "🌐 Déploiement staging (prod-like)..."

DEPLOY_URL=$(vercel --prod --yes)

echo "🌐 URL : $DEPLOY_URL"

# =========================
# DONE
# =========================
echo "🎉 DEPLOY STAGING OK"
echo "⚠️ ENV ISOLÉ — PAS DE PRODUCTION"
