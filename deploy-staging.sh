#!/bin/bash

set -euo pipefail

echo "🚀 Déploiement STAGING"

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
for cmd in git node npm supabase vercel; do
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

# =========================
# 3. CHECK SECRETS
# =========================
if [ -f "./check-secrets.sh" ]; then
  echo "🔐 Scan sécurité..."
  ./check-secrets.sh || exit 1
fi

# =========================
# 4. AUDIT CODE
# =========================
echo "🔍 Audit du code..."
if [ -f "./audit.sh" ]; then
  ./audit.sh || {
    echo "❌ Audit échoué"
    exit 1
  }
fi

# =========================
# 5. AUTO FIX
# =========================
echo "🛠 Auto-fix..."
if [ -f "./fix.sh" ]; then
  ./fix.sh || echo "⚠️ Fix partiel"
fi

# =========================
# 6. TYPES CHECK
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
# 7. BUILD CHECK
# =========================
echo "🧪 Build..."
npm run build
echo "✅ Build OK"

# =========================
# 8. COMMIT & PUSH (si besoin)
# =========================
if [[ -n "$(git status -s)" ]]; then
  echo "📦 Changements détectés"
  git add -A
  git commit -m "auto: staging deploy" || true
  git push origin "$CURRENT_BRANCH"
else
  echo "✅ Aucun changement local"
fi

# =========================
# 9. SUPABASE LINK
# =========================
echo "🔗 Liaison Supabase STAGING..."
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 10. DB
# =========================
echo "📡 Déploiement DB STAGING..."
supabase db push

# =========================
# 11. FUNCTIONS
# =========================
echo "⚡ Déploiement fonctions STAGING..."
supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 12. VERCEL STAGING
# =========================
echo "🌐 Déploiement frontend STAGING..."
vercel

echo "🎉 Déploiement STAGING terminé !"