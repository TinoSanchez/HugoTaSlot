# Architecture du dépôt — HugoTaSlot

Ce document fixe **quelle partie du repo est en production** et comment éviter de modifier le mauvais dossier.

## Site en production (source de vérité)

**URL :** [https://hugotaslot.fr](https://hugotaslot.fr) (Vercel, projet `hugotaslot-cloud`)

| Rôle | Fichiers à la **racine** du repo |
|------|----------------------------------|
| Structure HTML | `index.html` |
| Styles | `styles.css` |
| Logique applicative | `app.js` |
| Catalogue slots | `jeux.json` (+ secours `jeux-embed.js`, chargé à la demande) |
| Assets statiques | `assets/` |
| Pages annexes | `mini-opener.html`, `streamer-hud.html` |

**Build déploiement :**

```bash
npm run build          # copie tout vers web/dist/
npm run deploy:vercel  # build + vercel --prod
```

Le dossier **`web/dist/`** est un **artefact de build** : ne pas l’éditer à la main. Toute modification UI/fonctionnelle du site public se fait à la racine (`index.html`, `styles.css`, `app.js`).

**Dev local (site complet) :**

```bash
npm start
# → http://localhost:8765  (serve.js sert la racine du repo)
```

**Découpage CSS/JS :** si du code a été réintégré dans `index.html`, régénérer les fichiers externes avec :

```bash
npm run split:index
```

---

## Dossier `web/` — prototype Vite (hors production)

| Élément | Détail |
|---------|--------|
| Stack | Vite + `web/src/main.js` |
| Portée | Auth Supabase + hunts simplifiés (~700 lignes), **pas** la feature set du site principal |
| Déploiement | **Non** utilisé par Vercel pour hugotaslot.fr |
| Commandes | `npm run dev` (Vite), `npm run preview` |

**Statut :** brouillon / réserve pour une éventuelle réécriture modulaire.  
**Ne pas confondre** avec le site live : les changements dans `web/src/` **n’apparaissent pas** sur hugotaslot.fr tant qu’ils ne sont pas portés vers `app.js` + `index.html`.

Variables d’environnement : `web/.env.example` (`VITE_SUPABASE_*`) — utiles uniquement pour ce prototype.

---

## Autres dossiers utiles

| Dossier | Rôle |
|---------|------|
| `scripts/` | Build (`build-original-site.mjs`), sync catalogue (`sync-recent-slots-to-jeux.mjs`), enrichissement images, split index |
| `supabase/migrations/` | Schéma SQL + RLS (partagé par le site principal et le prototype `web/`) |
| `discord-bot/` | Bot Discord (Railway), indépendant du front |
| `tools_*.js` | Scripts ponctuels (rebuild `jeux.json` depuis Gamdom, etc.) |

---

## Supabase

- Le site **production** (`app.js`) utilise les constantes `ONLINE_SUPABASE_URL` / `ONLINE_SUPABASE_ANON` dans `app.js`.
- Le prototype **web/** lit `import.meta.env.VITE_SUPABASE_*`.
- Même projet Supabase possible ; les deux frontends doivent rester alignés sur les migrations dans `supabase/migrations/`.

---

## CI catalogue (GitHub Actions)

Workflow : **`.github/workflows/sync-jeux-daily.yml`**

| Déclencheur | Comportement |
|-------------|--------------|
| **Cron** (quotidien ~06h30 Paris) | `sync:recent-slots` → `enrich:images` (`GAMDOM_OG_MAX=400`, `HUB88_PROBE_MAX=2500`) |
| **workflow_dispatch** + case *Enrichissement complet* | + `GAMDOM_OG_MAX=0`, `HUB88_PROBE_MAX=0` puis `enrich:gamdom-api` |

Résumé des compteurs dans l’onglet **Summary** du job (`ci-catalog-stats.mjs`).

En local, équivalent rapide :

```bash
npm test                   # smoke : jeux.json + build web/dist
npm run catalog:stats
npm run enrich:ci          # enrich:images (défaut 600/600) + stats
npm run enrich:images:full # passe complète + API Gamdom
```

Workflow **`.github/workflows/ci.yml`** : `npm test` sur chaque push/PR vers `main` / `master`.

Variables utiles : `HUB88_PROBE_MAX`, `GAMDOM_OG_MAX`, `SKIP_HUB88`, `SKIP_GAMDOM_OG` (voir `scripts/enrich-jeux-images.mjs`).

---

## UX / accessibilité (P2)

- **Mobile ≤ 720px** : menu hamburger fixe, sidebar en drawer, backdrop, stats scrollables.
- **Navigation** : onglets sidebar en `<button>` avec `aria-current="page"`.
- **Modales** : `role="dialog"`, focus initial, Tab piégé, Échap pour fermer.
- **Catalogue** : bandeau d’aide selon le mode ; pastille « Hors Gamdom » en mode étendu pour les `sr_*` / placeholders.

---

## Prod avancée (P10 — satellites boot)

Modules chargés autour du noyau `app.js` (~480 lignes) :

| Fichier | Rôle |
|---------|------|
| `catalog-url.js` | Helpers URLs casino / matching catalogue (`getBonusGoToUrl`, Gamdom SEO…) |
| `hunt-templates.js` | Templates hunt, meta, presets filtres bonus |
| `inapp-notifs.js` | Cloche notifications header + polling cloud |
| `hunt-hooks.js` | Hub hunt tabs UI, hooks opener, FAB Gamdom, effets cinématiques |
| `app-boot.js` | PWA, `trackPlayerGameStats`, SW, listeners `DOMContentLoaded` |

`renderHomeHubMetrics` déplacé dans `hub-features.js` (lazy home).

---

## Prod avancée (P9 — routing boot)

`scripts/pages/page-router.js` (~950 lignes), chargé **après** `core-ui.js` et **avant** `app.js` :

| Module | Rôle |
|--------|------|
| `PAGE_TO_SLUG` / `pathToPage` / `pageToPath` | Mapping URL ↔ page (History API) |
| `switchPage` / `switchHuntTab` | Navigation SPA + onglets hub hunt |
| `__PAGE_HTML` + `mountCachedPage` | Templates HTML injectés à la demande |
| `LAZY_PAGE_SCRIPTS` / `loadLazyPageScript` | Chargement différé des modules par page |
| `initV101` | Init routing (URL initiale, popstate, prefetch home/hunt) |

---

## Prod avancée (P8 — core UI boot)

`scripts/pages/core-ui.js` (~650 lignes), chargé **après** `cloud-hunts.js` et **avant** `page-router.js` :

| Module | Rôle |
|--------|------|
| SFX / `playUiTone` / `gameWinFx` | Retours sonores UI et gains |
| `showToast` / `confirm` / `confirmRich` | Feedback utilisateur et modales de confirmation |
| Maintenance | `refreshMaintenanceConfig`, `requireWriteAccess`, bannière mode lecture seule |
| Runtime logs | `pushRuntimeLog`, alertes ops locales |
| A11y mobile | `initSidebarNavA11y`, `initModalA11yObserver` |
| `runGlobalSearch` | Recherche globale sidebar (Ctrl+K) |

La bannière réseau (`showNetBanner` / `hideNetBanner`) reste dans `cloud-hunts.js` (partagée avec `cloudCall` et les handlers offline de `app.js`).

---

## Prod avancée (P7 — cloud hunts boot)

`scripts/pages/cloud-hunts.js` (~600 lignes), chargé **après** `auth-cloud.js` et **avant** `core-ui.js` :

| Module | Rôle |
|--------|------|
| `huntFromCloudRow` / `cloudLoadHunts` | Lecture hunts Supabase |
| `mergeCloudHuntsPreservingLocalWins` | Fusion gains locaux vs cloud |
| `cloudReplaceAllHunts` + fallback | RPC `replace_user_hunts` |
| `scheduleCloudSync` / `runCloudSync` | Sync différée avec retry |
| `load` / `loadLocal` / `save` / `writeLocalCache` | Persistance locale + déclenchement sync |
| `cloudCall` + circuit breaker | Résilience réseau (buckets auth/profile/admin/sync) |
| Undo/redo + auto-snapshots hunts | Historique local |

---

## Prod avancée (P6 — auth cloud boot)

`scripts/pages/auth-cloud.js` (~2400 lignes) chargé **avant** `app.js` dans `index.html` :

- Session Supabase, `initAuth`, profil / badge menu, drop quotidien + streak
- Liaison Discord (modal profil + bandeau accueil)
- `isCloudUser()`, soldes, objectifs hebdo profil, bannière mode jeux

Contrairement aux modules hunt (lazy), l’auth doit être disponible avant le parse complet de `app.js` pour les globals `currentUser` / `getAuthClient()`.

---

## Prod avancée (P5 — lazy catalogue slots)

| Fichier | Rôle |
|---------|------|
| `catalog-slots.js` | Chargement `jeux.json`, indexes, grille, recherche, refresh silencieux |

Inséré dans `LAZY_PAGE_DEPS.hunt` **avant** `hunt-workspace.js` (la grille appelle `openAddModal` au clic).  
`initCatalogSlotsUi()` enregistre les listeners recherche / scroll / mode catalogue au chargement du script.

---

## Prod avancée (P4 — lazy hunt workspace)

Extraction progressive du **workspace hunt** depuis `app.js` :

| Fichier | Rôle |
|---------|------|
| `hunt-export.js` | Export PNG/PDF/JSON |
| `hunt-public-live.js` | Lien public `/h/:slug`, publish live |
| `hunt-workspace.js` | Liste hunts, modales, bonus, filtres, slot custom |
| `hunt-opener.js` | Opener, mini-opener, HUD stream |
| `hunt-share.js` | Import/export share code |

Chaîne lazy (`LAZY_PAGE_DEPS.hunt`) : export → public-live → workspace → opener → share.  
`loadLazyPageScript('hunt')` au boot (`init`) + à la navigation ; `applyHuntAppHooks()` patche `renderOpener` après chargement.  
Studio charge `hunt-opener.js` via `LAZY_PAGE_DEPS.studio` pour le bouton opener stream.

---

## Prod avancée (P3)

- **Logs** : `console.warn` via `bhWarn` — activer avec `?debug=1`, `localStorage.setItem('bh_debug','1')` ou `window.__BH_DEBUG__ = true`. Les `console.error` restent visibles pour les incidents réels.
- **PWA** : `manifest.webmanifest`, `sw.js` (cache shell CSS/JS/assets ; **pas** `jeux.json` ni Supabase). Enregistrement dans `app.js` au `DOMContentLoaded`.
- **Catalogue allégé** : au build, `jeux.json` dans `web/dist/` est compacté (`devise` et `rtp` vides retirés, ~330 KiB de moins). Le fichier source à la racine garde tous les champs pour les scripts sync/enrich.

---

## Routing client multi-pages (Passe 1)

Le site reste **techniquement une SPA** (un seul `index.html`, état Supabase + solde + parties en cours conservés) mais se comporte **côté UX comme un vrai site multi-pages** :

| URL                  | Page sidebar       |
|----------------------|--------------------|
| `/`                  | Accueil            |
| `/hunt`              | Bonus Hunt         |
| `/blackjack`         | Tableau Blackjack  |
| `/mise-optimale`     | Mise Optimale      |
| `/roue-depot`        | Roue du Dépôt      |
| `/studio`            | Studio Stream      |
| `/tournoi`           | Tournoi            |
| `/stats`             | Statistiques       |
| `/mini-jeux`         | Mini Jeux          |
| `/updates`           | Updates            |
| `/actualites`        | Actualités         |
| `/review`            | Review             |
| `/admin`             | Admin (admins)     |

**Mécanique** (`app.js`) :
- `PAGE_TO_SLUG` / `SLUG_TO_PAGE` : mapping bidirectionnel page ↔ slug URL.
- `switchPage(page, opts)` : applique le panneau visible **et** `history.pushState({ page }, '', path)` + `document.title` de la page. Options : `{ replace: true }` (replaceState, ex. redirection admin → home) ou `{ skipHistory: true }` (ne pas re-pousser, ex. depuis `popstate`).
- `popstate` : back/forward du navigateur → relit `location.pathname`, re-mount.
- Routing initial : `initV101()` lit `location.pathname` et monte la bonne page (au lieu d'un `switchPage('home')` codé en dur).
- `vercel.json` rewrite `/(.*)` → `index.html`, donc un **refresh ou un partage de lien** vers n'importe quelle URL fonctionne.

**Lazy `jeux.json`** : le catalogue (~1.9 Mo en prod) **n'est plus chargé au boot**. `ensureSlotsLoaded()` (promesse mémoïsée) le déclenche au premier `switchPage('hunt')`. `refreshCatalogSilently()` ne pre-fetch pas tant que l'utilisateur n'a jamais consulté le catalogue. Sur une session qui reste sur `/blackjack` ou `/studio`, `jeux.json` n'est **jamais téléchargé**.

**Lazy modules par page** : registre `LAZY_PAGE_SCRIPTS` + dépendances `LAZY_PAGE_DEPS` dans `app.js` — modules dans `scripts/pages/` (blackjack, mini-jeux, hub-features, stats, admin, news, updates, review, **hunt-*** , etc.). `loadLazyPageScript(page)` charge les deps puis le script de page, en dédupliquant par URL. Hunt = chaîne de 5 scripts (voir section P4).

**Hunt live public (`/h/:slug`)** : page légère `hunt-live.html` (build → `web/dist`), rewrite Vercel `{ "source": "/h/:slug", "destination": "/hunt-live.html?slug=:slug" }`. Lit `get_public_hunt_share` via Supabase ; complément du bot Discord `/live`.

**Passe 3 (partiel)** : modules hunt lazy (`hunt-export`, `hunt-public-live`, `hunt-share`) — voir [BACKLOG.md](./BACKLOG.md).

---

## Checklist avant une PR / un déploiement

1. J’ai modifié **`index.html` / `styles.css` / `app.js`** (ou `jeux.json` / `assets/`) — pas seulement `web/src/`.
2. `npm run build` passe.
3. Si le catalogue a changé : `npm run enrich:images` ou `npm run enrich:images:full` si besoin.
4. `npm run deploy:vercel` après changement visible sur le site.

---

## Backlog produit

État détaillé et checklist : **[BACKLOG.md](./BACKLOG.md)**.

## Évolution prévue (en cours / partiel)

- ✅ Passe 1 multi-pages : URLs distinctes, lazy `jeux.json`, infra `LAZY_PAGE_SCRIPTS`.
- 🔄 Passe 2 multi-pages : modules lazy (`hub-features`, `stats`, mini-jeux, tournoi…) — reste `admin` / contenu dans `app.js`.
- **Maintenance globale** : flag serveur Supabase (`get_site_maintenance` / `admin_set_maintenance`) — migration `20260704_site_maintenance.sql`.
- Prototype `web/` : brouillon Vite documenté, **hors prod** — voir `web/README.md`.
