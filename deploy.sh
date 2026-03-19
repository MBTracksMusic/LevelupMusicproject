#!/bin/bash

echo "🚀 Déploiement en cours..."

# 1. Push Git
echo "📦 Push Git..."
git add .
git commit -m "deploy update"
git push

# 2. Supabase DB
echo "🧠 Push DB..."
supabase db push

# 3. Edge Functions
echo "⚡ Deploy functions..."
supabase functions deploy

# 4. Vercel
echo "🌐 Deploy frontend..."
vercel --prod

echo "✅ Déploiement terminé !"