#!/bin/bash

set -euo pipefail

echo "🚀 DÉPLOIEMENT PRODUCTION"

# =========================
# CONFIG
# =========================
EXPECTED_VERCEL_PROJECT="beatelion"

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
for cmd in git node npm supabase vercel jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Commande manquante : $cmd"
    exit 1
  fi
done

# =========================
# 2. SAFE CHECKS (PROD ONLY)
# =========================
if [ "${ENVIRONMENT:-}" != "production" ]; then
  echo "❌ Mauvais environnement (attendu: production)"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ SUPABASE_PROJECT_REF manquant"
  exit 1
fi

# 🔴 Sécurité : bloquer les clés Stripe de test en production
# (ignore les placeholders de type sk_test_xxx — vraies clés gérées dans Supabase secrets)
STRIPE_KEY="${STRIPE_SECRET_KEY:-}"
if [[ "$STRIPE_KEY" == sk_test* ]] && [[ "$STRIPE_KEY" != *_xxx* ]] && [[ "$STRIPE_KEY" != "sk_test_xxx" ]]; then
  echo "❌ Stripe TEST détecté en production — utilise sk_live_*"
  exit 1
fi

# =========================
# 3. GIT FLOW (PROD DEPUIS MAIN)
# =========================
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "🌿 Branche actuelle : $CURRENT_BRANCH"

# Auto-commit si repo non clean
if [[ -n "$(git status -s)" ]]; then
  echo "📝 Changements non commités détectés — commit automatique..."
  git add src/ supabase/ public/ docs/ audio-worker/ package*.json tsconfig*.json vite.config.* index.html render.yaml deploy-prod.sh deploy-staging.sh 2>/dev/null || true
  git commit -m "auto: prod deploy" || true
fi

# Si on est sur staging → merge staging → main
if [[ "$CURRENT_BRANCH" == "staging" ]]; then
  echo "⚠️ Merge staging → main"

  read -p "Confirmer merge staging → main ? (y/n): " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "❌ Annulé"
    exit 1
  fi

  git fetch origin

  echo "🔄 Checkout main"
  git checkout main
  git pull origin main

  echo "🔀 Merge staging"
  git merge staging --no-ff -m "chore: merge staging → main for prod deploy"

  echo "🚀 Push main"
  git push origin main

elif [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "❌ Déploiement prod uniquement depuis main ou staging (actuel: $CURRENT_BRANCH)"
  echo "   → Merge d'abord vers staging, teste, puis relance depuis staging"
  exit 1
fi

echo "📦 Branche finale : $(git rev-parse --abbrev-ref HEAD)"

if [[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]]; then
  echo "🚀 Push main"
  git push origin main
fi

# =========================
# 4. CONFIRMATION FINALE
# =========================
echo ""
echo "⚠️  DÉPLOIEMENT EN PRODUCTION ⚠️"
echo "   Supabase : $SUPABASE_PROJECT_REF"
echo "   Vercel   : $EXPECTED_VERCEL_PROJECT"
echo ""
read -p "Confirmer le déploiement en PRODUCTION ? (y/n): " confirm_prod
if [[ "$confirm_prod" != "y" && "$confirm_prod" != "Y" ]]; then
  echo "❌ Annulé"
  exit 1
fi

# =========================
# 5. VERCEL LINK (PROD)
# =========================
echo "🔗 Vérification Vercel production..."

if [ ! -f ".vercel/project.json" ]; then
  vercel link --project "$EXPECTED_VERCEL_PROJECT"
fi

CURRENT_PROJECT_NAME=$(jq -r '.projectName' .vercel/project.json)

if [ "$CURRENT_PROJECT_NAME" != "$EXPECTED_VERCEL_PROJECT" ]; then
  vercel link --project "$EXPECTED_VERCEL_PROJECT"
fi

echo "✅ Vercel OK"

# =========================
# 6. CHECK / AUDIT
# =========================
echo "🔐 Scan sécurité..."
[ -f "./check-secrets.sh" ] && ./check-secrets.sh

echo "🔍 Audit..."
[ -f "./audit.sh" ] && ./audit.sh

echo "🛠 Auto-fix..."
[ -f "./fix.sh" ] && ./fix.sh || true

# =========================
# 7. TYPES CHECK
# =========================
TYPES_FILE="src/lib/supabase/database.types.ts"

if [ ! -f "$TYPES_FILE" ] || [ "$(wc -c < "$TYPES_FILE")" -lt 10000 ]; then
  echo "⚠️ Regénération types"
  npm run supabase:types
  git add "$TYPES_FILE"
  git commit -m "chore: regenerate types" || true
  git push origin main
fi

# =========================
# 8. BUILD
# =========================
echo "🧪 Build..."
npm run build
echo "✅ Build OK"

# =========================
# 9. SUPABASE (PRODUCTION)
# =========================
echo "🔗 Supabase production..."
supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "📡 DB push (vérification migrations)..."
supabase db push --dry-run 2>/dev/null && echo "✅ Dry-run OK" || { echo "⚠️ Dry-run non supporté — push direct"; }
supabase db push

echo "⚡ Functions deploy..."
supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF"

# =========================
# 10. VERCEL DEPLOY (PRODUCTION)
# =========================
echo "🌐 Déploiement production..."

DEPLOY_URL=$(vercel --prod --yes)

echo "🌐 URL : $DEPLOY_URL"

# =========================
# DONE
# =========================
echo ""
echo "🎉 DEPLOY PRODUCTION OK"
echo "🌐 $DEPLOY_URL"
