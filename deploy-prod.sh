#!/bin/bash

set -euo pipefail

echo "🚀 Déploiement PRODUCTION"

# =========================
# 0. LOAD ENV
# =========================
if [ ! -f ".env.production" ]; then
  echo "❌ Fichier .env.production introuvable"
  exit 1
fi

set -o allexport
source .env.production
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
if [ "${ENVIRONMENT:-}" != "production" ]; then
  echo "❌ ENVIRONMENT doit être égal à production dans .env.production"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ SUPABASE_PROJECT_REF manquant dans .env.production"
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ Déploiement production autorisé uniquement depuis la branche main (actuelle : $CURRENT_BRANCH)"
  exit 1
fi

read -p "⚠️ CONFIRMER LE DEPLOY EN PRODUCTION (yes): " confirm
if [ "$confirm" != "yes" ]; then
  echo "❌ Déploiement annulé"
  exit 1
fi

# =========================
# 3. CHECK SECRETS
# =========================
if [ -f "./check-secrets.sh" ]; then
  echo "🔐 Scan sécurité..."
  ./check-secrets.sh
else
  echo "⚠️ Aucun check-secrets.sh trouvé (skip)"
fi

# =========================
# 4. AUDIT CODE
# =========================
echo "🔍 Audit du code..."
if [ -f "./audit.sh" ]; then
  ./audit.sh || {
    echo "❌ Audit échoué. Corrige avant déploiement."
    exit 1
  }
else
  echo "⚠️ Aucun audit.sh trouvé (skip)"
fi

# =========================
# 5. AUTO FIX
# =========================
echo "🛠 Tentative auto-fix..."
if [ -f "./fix.sh" ]; then
  ./fix.sh || echo "⚠️ Fix partiel ou ignoré"
else
  echo "⚠️ Aucun fix.sh trouvé (skip)"
fi

# =========================
# 6. PRODUCER REVENUE VIEW CHECK
# =========================
echo "🔍 Vérification producer_revenue_view..."
if [ -f "scripts/checkProducerRevenueViewExists.mjs" ]; then
  node scripts/checkProducerRevenueViewExists.mjs || echo "⚠️ View missing (fallback will be used)"
else
  echo "⚠️ Script checkProducerRevenueViewExists.mjs introuvable (skip)"
fi

# =========================
# 7. CHECK DATABASE TYPES
# =========================
echo "🔍 Vérification database.types.ts..."
TYPES_FILE="src/lib/supabase/database.types.ts"

if [ ! -f "$TYPES_FILE" ]; then
  TYPES_SIZE=0
else
  TYPES_SIZE=$(wc -c < "$TYPES_FILE")
fi

if [ "$TYPES_SIZE" -lt 10000 ]; then
  echo "⚠️ database.types.ts vide ou trop petit (${TYPES_SIZE} bytes) — régénération..."
  npm run supabase:types || {
    echo "❌ Échec de la génération des types Supabase. Déploiement annulé."
    exit 1
  }
  echo "✅ Types régénérés"
  git add "$TYPES_FILE"
else
  echo "✅ database.types.ts OK (${TYPES_SIZE} bytes)"
fi

# =========================
# 8. BUILD CHECK
# =========================
echo "🧪 Vérification build..."
npm run build
echo "✅ Build OK"

# =========================
# 9. COMMIT & PUSH SI NÉCESSAIRE
# =========================
if [[ -n "$(git status -s)" ]]; then
  echo "📦 Changements locaux détectés"
  read -p "📝 Message de commit: " commit_message

  if [ -z "$commit_message" ]; then
    commit_message="auto: prod deploy"
  fi

  git add -A
  git commit -m "$commit_message" || echo "⚠️ Rien à commit"
  git push origin main
else
  echo "✅ Aucun changement local à commit"
fi

# =========================
# 10. LINK SUPABASE PROD
# =========================
echo "🔗 Liaison au projet Supabase PROD..."
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 11. SUPABASE DB
# =========================
echo "📡 Déploiement DB PROD..."
supabase db push

# =========================
# 12. EDGE FUNCTIONS
# =========================
echo "⚡ Déploiement des Edge Functions PROD..."
supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 13. VERCEL PROD
# =========================
echo "🌐 Déploiement frontend PROD..."
vercel --prod

echo "🎉 Déploiement PRODUCTION terminé !"