# Design — Ajout des catégories au formulaire d'upload de beat

**Date:** 2026-04-20  
**Status:** Approuvé  

---

## Contexte

Le formulaire d'upload de beat (`UploadBeat.tsx`) ne permet pas aux producteurs de renseigner le genre, l'ambiance (mood) et des tags lors de la publication d'un beat.

Pourtant, l'infrastructure est déjà entièrement en place :
- Tables `genres` (10 entrées) et `moods` (8 entrées) avec noms multilingues (fr/en/de)
- Colonnes `genre_id`, `mood_id`, `tags text[]` sur la table `products`
- Filtres genre/mood déjà fonctionnels sur la page catalogue (`Beats.tsx`)
- Types TypeScript `Genre` et `Mood` définis dans `src/lib/supabase/types.ts`

Il manque uniquement l'UI producteur pour renseigner ces champs.

---

## Objectif

Permettre aux producteurs de catégoriser leurs beats à l'upload, afin qu'ils remontent dans les filtres du catalogue et améliorent la découvrabilité.

---

## Design

### 1. Formulaire d'upload (`src/pages/UploadBeat.tsx`)

#### Nouveaux états React
```ts
const [genreId, setGenreId] = useState<string>('');
const [moodId, setMoodId] = useState<string>('');
const [tags, setTags] = useState<string[]>([]);
const [genres, setGenres] = useState<Genre[]>([]);
const [moods, setMoods] = useState<Mood[]>([]);
```

#### Fetch au montage du composant
Même pattern que `Beats.tsx` — requêtes parallèles :
```ts
const [genresRes, moodsRes] = await Promise.all([
  supabase.from('genres').select('*').eq('is_active', true).order('sort_order'),
  supabase.from('moods').select('*').eq('is_active', true).order('sort_order'),
]);
```

#### Placement des champs dans le formulaire
Entre le bloc **Description** et le bloc **BPM / Tonalité** (position B choisie).

Layout :
```
[ Genre (dropdown) ]  [ Ambiance (dropdown) ]
[ Tags (chip input) — pleine largeur         ]
```

#### Comportement Genre & Ambiance
- Dropdowns avec les options issues de la base, nom localisé via `getLocalizedName(item, language)`
- Option vide "— Sélectionner —" en tête de liste
- En mode **nouveau beat** : genre obligatoire, erreur de validation si absent
- En mode **édition** : genre optionnel, label "Recommandé" affiché si vide

#### Comportement Tags (chip input)
- Validation à la frappe : Entrée ou virgule pour valider un tag
- Chaque tag apparaît comme un chip avec bouton ×
- Contraintes : max 8 tags, max 25 caractères par tag
- Tags stockés en minuscules, espaces trimés

#### Chargement en mode édition / version
Quand un beat existant est chargé (`editingProduct` ou `versionSource`), initialiser :
```ts
setGenreId(product.genre_id ?? '');
setMoodId(product.mood_id ?? '');
setTags(product.tags ?? []);
```

#### Payload d'upload
Ajouter dans `basePayload` pour les modes create et edit :
```ts
genre_id: genreId || null,
mood_id: moodId || null,
tags: tags.length > 0 ? tags : [],
```
En mode **version** (`rpc_publish_product_version`), les champs sont déjà préservés depuis `versionSource` — aucune modification nécessaire.

#### Validation
```ts
if (!genreId && !editingProduct) {
  errors.form = t('uploadBeat.genreRequired');
  return;
}
```

---

### 2. Nudge ProducerDashboard (`src/pages/ProducerDashboard.tsx`)

Afficher un bandeau discret si le producteur a des beats publiés sans genre.

#### Requête
```ts
const { count } = await supabase
  .from('products')
  .select('*', { count: 'exact', head: true })
  .eq('producer_id', producerId)
  .eq('is_published', true)
  .is('genre_id', null);
```

#### UI
Si `count > 0` :
> *"{count} de tes beats n'ont pas de genre — catégorise-les pour booster leur visibilité dans les filtres."*

Avec un lien par beat vers `/upload-beat?edit={id}`. Bandeau non bloquant, dismissible via état React local (non persisté entre sessions).

---

## Règles métier

| Scénario | Comportement |
|---|---|
| Nouveau beat, genre absent | Bloquant — erreur de validation |
| Beat existant édité, genre absent | Non bloquant — label "Recommandé" |
| Mode version | Genre/mood/tags préservés depuis la version précédente |
| Beat existant non édité | Aucun impact — reste publié tel quel |

---

## Fichiers impactés

| Fichier | Modification |
|---|---|
| `src/pages/UploadBeat.tsx` | Ajout états, fetch, UI champs, validation, payload |
| `src/pages/ProducerDashboard.tsx` | Ajout requête count + bandeau nudge |
| `src/lib/i18n/translations/fr.ts` | Nouvelles clés : `uploadBeat.genreRequired`, `uploadBeat.genreRecommended`, `dashboard.uncategorizedNudge` |
| `src/lib/i18n/translations/en.ts` | Idem |
| `src/lib/i18n/translations/de.ts` | Idem |

## Hors scope

- Création / modification de genres et moods (admin only, déjà en place)
- Sélection multi-genre par beat
- Autocomplete sur les tags
- Migration rétroactive forcée des beats existants
