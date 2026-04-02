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
# 1. SAFE CHECKS
# =========================
if [ "${ENVIRONMENT:-}" != "production" ]; then
  echo "❌ ENVIRONMENT doit être égal à production dans .env.production"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ SUPABASE_PROJECT_REF manquant dans .env.production"
  exit 1
fi

read -p "⚠️ CONFIRMER LE DEPLOY EN PRODUCTION (yes): " confirm
if [ "$confirm" != "yes" ]; then
  echo "❌ Déploiement annulé"
  exit 1
fi

# =========================
# 2. CHECK CHANGEMENTS
# =========================
if [[ -z "$(git status -s)" ]]; then
  echo "✅ Aucun changement détecté. Déploiement inutile."
  exit 0
fi

# =========================
# 3. CHECK SECRETS
# =========================
if [ -f "./check-secrets.sh" ]; then
  echo "🔐 Scan sécurité..."
  ./check-secrets.sh || exit 1
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
# 6. PRODUCER EARNINGS VIEW CHECK
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
TYPES_SIZE=$(wc -c < "$TYPES_FILE" 2>/dev/null || echo 0)
if [ "$TYPES_SIZE" -lt 10000 ]; then
  echo "⚠️  database.types.ts vide ou trop petit (${TYPES_SIZE} bytes) — régénération..."
  npm run supabase:types || {
    echo "❌ Échec de la génération des types Supabase. Déploiement annulé."
    exit 1
  }
  echo "✅ Types régénérés — vérification commit..."
  git add src/lib/supabase/database.types.ts
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
# 9. COMMIT PROPRE
# =========================
echo "📦 Commit & Push Git..."
read -p "📝 Message de commit: " commit_message

if [ -z "$commit_message" ]; then
  commit_message="auto: prod deploy"
fi

git add -A
git commit -m "$commit_message" || echo "⚠️ Rien à commit"
git push origin main

# =========================
# 10. SUPABASE DB
# =========================
echo "🧠 Vérification migrations..."
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "^supabase/migrations/"; then
  echo "📡 Déploiement DB PROD..."
  supabase link --project-ref "$SUPABASE_PROJECT_REF"
  supabase db push
else
  echo "✅ Aucune migration détectée."
fi

# =========================
# 11. EDGE FUNCTIONS
# =========================
echo "⚡ Vérification functions..."
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "^supabase/functions/"; then
  echo "🚀 Déploiement des fonctions PROD..."
  supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"
else
  echo "✅ Aucune fonction modifiée."
fi

# =========================
# 12. VERCEL PROD
# =========================
echo "🌐 Déploiement frontend PROD..."
vercel --prod

echo "🎉 Déploiement PRODUCTION terminé !"