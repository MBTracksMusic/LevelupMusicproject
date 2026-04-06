#!/bin/bash

set -euo pipefail

echo "🚀 Déploiement STAGING"

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
# 2. SAFE CHECKS
# =========================
if [ "${ENVIRONMENT:-}" != "staging" ]; then
  echo "❌ ENVIRONMENT doit être égal à staging"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ SUPABASE_PROJECT_REF manquant"
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "🌿 Branche actuelle : $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "❌ Staging interdit depuis 'main'"
  echo "👉 Crée une branche : git checkout -b staging"
  exit 1
fi

# =========================
# 3. VERCEL LINK FORCE
# =========================
echo "🔗 Vérification projet Vercel STAGING..."

if [ ! -f ".vercel/project.json" ]; then
  echo "⚠️ Aucun projet Vercel lié → linking..."
  vercel link --project "$EXPECTED_VERCEL_PROJECT"
fi

CURRENT_PROJECT_NAME=$(jq -r '.projectName' .vercel/project.json)

echo "👉 Projet actuel : $CURRENT_PROJECT_NAME"

if [ "$CURRENT_PROJECT_NAME" != "$EXPECTED_VERCEL_PROJECT" ]; then
  echo "⚠️ Mauvais projet → re-link staging..."
  vercel link --project "$EXPECTED_VERCEL_PROJECT"
fi

FINAL_PROJECT_NAME=$(jq -r '.projectName' .vercel/project.json)

if [ "$FINAL_PROJECT_NAME" != "$EXPECTED_VERCEL_PROJECT" ]; then
  echo "❌ Impossible de lier au bon projet Vercel STAGING"
  exit 1
fi

echo "✅ Projet Vercel OK : $FINAL_PROJECT_NAME"

# =========================
# 4. CHECK SECRETS
# =========================
if [ -f "./check-secrets.sh" ]; then
  echo "🔐 Scan sécurité..."
  ./check-secrets.sh || exit 1
fi

# =========================
# 5. AUDIT CODE
# =========================
echo "🔍 Audit du code..."
if [ -f "./audit.sh" ]; then
  ./audit.sh || {
    echo "❌ Audit échoué"
    exit 1
  }
fi

# =========================
# 6. AUTO FIX
# =========================
echo "🛠 Auto-fix..."
if [ -f "./fix.sh" ]; then
  ./fix.sh || echo "⚠️ Fix partiel"
fi

# =========================
# 7. TYPES CHECK
# =========================
echo "🔍 Vérification database.types.ts..."
TYPES_FILE="src/lib/supabase/database.types.ts"

if [ ! -f "$TYPES_FILE" ]; then
  TYPES_SIZE=0
else
  TYPES_SIZE=$(wc -c < "$TYPES_FILE")
fi

if [ "$TYPES_SIZE" -lt 10000 ]; then
  echo "⚠️ Types invalides → régénération"
  npm run supabase:types
  git add "$TYPES_FILE"
fi

# =========================
# 8. BUILD CHECK
# =========================
echo "🧪 Build..."
npm run build
echo "✅ Build OK"

# =========================
# 9. COMMIT & PUSH SAFE
# =========================
if [[ -n "$(git status -s)" ]]; then
  echo "📦 Changements détectés"
  git add -A
  git commit -m "auto: staging deploy" || true

  if [ "$CURRENT_BRANCH" = "main" ]; then
    echo "❌ Push interdit sur main via script"
    exit 1
  fi

  git push origin "$CURRENT_BRANCH"
else
  echo "✅ Aucun changement local"
fi

# =========================
# 10. SUPABASE
# =========================
echo "🔗 Liaison Supabase STAGING..."
supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "📡 Déploiement DB STAGING..."
supabase db push

echo "⚡ Déploiement fonctions STAGING..."
supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 11. VERCEL DEPLOY
# =========================
echo "🌐 Déploiement frontend..."

DEPLOY_URL=$(vercel --prod --yes)

echo "🌐 URL : $DEPLOY_URL"

echo "🎉 DEPLOY OK"