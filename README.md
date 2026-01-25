# BeatBattle - Installation locale

## Prerequis

- Node.js 18+
- npm ou yarn
- Un projet Supabase (gratuit sur supabase.com)

## Installation

1. **Cloner le projet**
```bash
git clone <votre-repo>
cd beatbattle
```

2. **Installer les dependances**
```bash
npm install
```

3. **Configurer les variables d'environnement**

Creer un fichier `.env` a la racine du projet:

```env
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre_cle_anon_publique
```

Pour obtenir ces valeurs:
- Allez sur [supabase.com](https://supabase.com) > votre projet
- Settings > API
- Copiez "Project URL" et "anon public" key

**IMPORTANT**: Utilisez la cle `anon` (publique), jamais la cle `service_role`.

4. **Configurer la base de donnees**

Executez les migrations SQL dans l'ordre dans l'editeur SQL de Supabase:
- `supabase/migrations/20260125150850_001_create_user_roles_and_profiles.sql`
- `supabase/migrations/20260125151003_002_create_products_schema.sql`
- `supabase/migrations/20260125151043_003_create_purchases_and_entitlements.sql`
- `supabase/migrations/20260125151124_004_create_battles_schema.sql`
- `supabase/migrations/20260125151158_005_create_stripe_and_audit_schema.sql`

5. **Lancer le serveur de developpement**
```bash
npm run dev
```

L'application sera accessible sur `http://localhost:5173`

## Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Lance le serveur de developpement |
| `npm run build` | Compile pour la production |
| `npm run preview` | Previsualise le build de production |
| `npm run lint` | Verifie le code avec ESLint |
| `npm run typecheck` | Verifie les types TypeScript |

## Structure du projet

```
src/
├── components/       # Composants reutilisables
│   ├── audio/       # Lecteur audio
│   ├── layout/      # Header, Footer, Layout
│   ├── products/    # Cartes produits
│   └── ui/          # Boutons, Cards, Modals, etc.
├── lib/
│   ├── auth/        # Authentification (hooks, service, store)
│   ├── i18n/        # Traductions (en, fr, de)
│   ├── stores/      # Zustand stores (cart, player)
│   ├── supabase/    # Client et types Supabase
│   └── utils/       # Fonctions utilitaires
├── pages/
│   ├── auth/        # Login, Register
│   ├── Battles.tsx  # Page des battles
│   ├── Beats.tsx    # Catalogue des beats
│   ├── Home.tsx     # Page d'accueil
│   └── Pricing.tsx  # Page tarifs
└── App.tsx          # Routes et configuration

supabase/
├── functions/       # Edge Functions (Stripe webhooks, checkout)
└── migrations/      # Migrations SQL
```

## Edge Functions (optionnel)

Pour le paiement Stripe, vous devez deployer les edge functions:
- `create-checkout` - Creation de sessions Stripe
- `stripe-webhook` - Reception des webhooks Stripe

Ces fonctions necessitent une cle API Stripe configuree dans les secrets Supabase.

## Technologies

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Supabase (Auth + Database + Edge Functions)
- Zustand (state management)
- React Query
- React Router v7
# LevelupMusicproject
