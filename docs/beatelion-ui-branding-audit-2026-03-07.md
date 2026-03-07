# Audit UI + Branding Beatelion (2026-03-07)

## Scope audite
- `src/components/`
- `src/pages/`
- `src/layout/` (absent dans ce repo)
- `src/styles/` (absent dans ce repo)
- `src/index.css` (styles globaux)
- `tailwind.config.js` (pas `tailwind.config.ts`)
- `public/`
- `index.html`

## Design system actuel (constat)
- Fond dominant: `zinc-950` / palette sombre.
- Couleurs dominantes (scan classes Tailwind):
  - `text-zinc-400` (245)
  - `text-zinc-500` (160)
  - `border-zinc-800` (149)
  - `bg-zinc-800` (100), `bg-zinc-900` (99), `bg-zinc-950` (84)
- Accents principaux detectes:
  - `from-rose-500` (13)
  - `to-orange-500` (13)
  - `text-rose-400` (38)
- Composants UI majeurs:
  - Header/Navbar: `src/components/layout/Header.tsx`
  - Footer: `src/components/layout/Footer.tsx`
  - Layout racine: `src/components/layout/Layout.tsx`
  - Boutons CTA: `src/components/ui/Button.tsx`
- Hero/backgrounds:
  - sections en `bg-zinc-950` + cards `bg-zinc-900`.
- Iconographie:
  - `lucide-react` largement utilise.

## Palette branding cible integree
- `#FF6A2B` (primary accent)
- `#FF8A3D` (glow highlight)
- `#FF4D4D` (secondary accent)
- `#0B0B0F` (background)

Integration dans design system:
- `tailwind.config.js`: ajout de `colors.brand.{primary,glow,secondary,bg}`
- `src/index.css`:
  - variables CSS de marque
  - `body` sur fond `#0B0B0F`
  - utilities `gradient-text`/`gradient-border` alignees sur le nouveau gradient

## Navbar
- Fichier cible: `src/components/layout/Header.tsx`
- Etat final:
  - structure: `[logo icon] BEATELION`
  - clickable vers `/`
  - alignement vertical via `flex items-center`
  - hover UX: `hover:scale-105 transition duration-200`
  - accessibilite: `aria-label` + `alt="Beatelion - Beat marketplace"`
- Responsive:
  - desktop/tablet: icone + texte
  - mobile `<768` (`md`): icone seule (`hidden md:block` sur le texte)

## Assets crees/mis a jour
### `src/assets/`
- `beatelion-logo.svg`
- `beatelion-icon.svg`

### `public/`
- `favicon.ico`
- `favicon-32.png`
- `favicon-16.png`
- `apple-touch-icon.png`
- `beatelion-logo.svg`
- `beatelion-icon.svg`
- `beatelion-logo.png` (fallback/SEO)
- `beatelion-icon-512.png`
- `favicon.svg`

Tailles (perf):
- `beatelion-logo.png`: 197538 bytes (<200KB)
- `beatelion-icon-512.png`: 121806 bytes (<200KB)
- favicons: <<200KB

## Loader branding
- Nouveau composant: `src/components/ui/LogoLoader.tsx`
- Animation:
  - logo pulse + glow orange
  - ondes audio pulse (barres animees)
- Integre dans:
  - `src/App.tsx` (loader d'initialisation global)
  - `src/components/auth/ProtectedRoute.tsx`
  - `src/pages/Cart.tsx`
  - `src/pages/Wishlist.tsx`
  - `src/pages/AdminBattles.tsx`

## SEO + app icon
- `index.html`:
  - favicons multi-format
  - `apple-touch-icon`
  - `theme-color`
  - `og:image=/beatelion-logo.png`
  - `twitter:image=/beatelion-logo.png`

## Points de vigilance restants
- Pas de `manifest.webmanifest` dedie PWA dans ce repo.
- Quelques loaders secondaires restent en `animate-spin` dans d'autres pages; le loader branding est applique aux points critiques globaux.
