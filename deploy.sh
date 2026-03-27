#!/bin/bash

set -e

echo "🚀 Déploiement intelligent + audit..."

# =========================
# 0. CHECK CHANGEMENTS
# =========================
if [[ -z $(git status -s) ]]; then
  echo "✅ Aucun changement détecté. Déploiement inutile."
  exit 0
fi

# =========================
# 1. CHECK SECRETS
# =========================
if [ -f "./check-secrets.sh" ]; then
  echo "🔐 Scan sécurité..."
  ./check-secrets.sh || exit 1
fi

# =========================
# 2. AUDIT CODE (NEW)
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
# 3. AUTO FIX (NEW)
# =========================
echo "🛠 Tentative auto-fix..."

if [ -f "./fix.sh" ]; then
  ./fix.sh || echo "⚠️ Fix partiel ou ignoré"
else
  echo "⚠️ Aucun fix.sh trouvé (skip)"
fi

# =========================
# 4. BUILD CHECK
# =========================
echo "🧪 Vérification build..."

npm run build

echo "✅ Build OK"

# =========================
# 5. COMMIT PROPRE
# =========================
echo "📦 Commit & Push Git..."

read -p "📝 Message de commit: " commit_message

if [ -z "$commit_message" ]; then
  commit_message="auto: deploy update"
fi

git add -A
git commit -m "$commit_message" || echo "⚠️ Rien à commit"
git push origin main

# =========================
# 6. SUPABASE DB
# =========================
echo "🧠 Vérification migrations..."

if git diff --name-only HEAD~1 | grep -q "supabase/migrations"; then
  echo "📡 Déploiement DB..."
  supabase db push
else
  echo "✅ Aucune migration détectée."
fi

# =========================
# 7. EDGE FUNCTIONS
# =========================
echo "⚡ Vérification functions..."

if git diff --name-only HEAD~1 | grep -q "supabase/functions"; then
  echo "🚀 Déploiement des fonctions..."
  supabase functions deploy
else
  echo "✅ Aucune fonction modifiée."
fi

# =========================
# 8. VERCEL
# =========================
echo "🌐 Déploiement frontend..."
vercel --prod

echo "🎉 Déploiement intelligent terminé !"