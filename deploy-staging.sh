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
# 1. SAFE CHECKS
# =========================
if [ "${ENVIRONMENT:-}" != "staging" ]; then
  echo "❌ ENVIRONMENT doit être égal à staging dans .env.staging"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ SUPABASE_PROJECT_REF manquant dans .env.staging"
  exit 1
fi

read -p "⚠️ CONFIRMER LE DEPLOY EN STAGING (yes): " confirm
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
# 7. BUILD CHECK
# =========================
echo "🧪 Vérification build..."
npm run build
echo "✅ Build OK"

# =========================
# 8. COMMIT PROPRE
# =========================
echo "📦 Commit & Push Git..."
read -p "📝 Message de commit: " commit_message

if [ -z "$commit_message" ]; then
  commit_message="auto: staging deploy"
fi

git add -A
git commit -m "$commit_message" || echo "⚠️ Rien à commit"
git push origin main

# =========================
# 9. SUPABASE DB
# =========================
echo "🧠 Vérification migrations..."
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "^supabase/migrations/"; then
  echo "📡 Déploiement DB STAGING..."
  supabase db push --project-ref "$SUPABASE_PROJECT_REF"
else
  echo "✅ Aucune migration détectée."
fi

# =========================
# 10. EDGE FUNCTIONS
# =========================
echo "⚡ Vérification functions..."
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "^supabase/functions/"; then
  echo "🚀 Déploiement des fonctions STAGING..."
  supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"
else
  echo "✅ Aucune fonction modifiée."
fi

# =========================
# 11. VERCEL PREVIEW / STAGING
# =========================
echo "🌐 Déploiement frontend STAGING..."
vercel

echo "🎉 Déploiement STAGING terminé !"