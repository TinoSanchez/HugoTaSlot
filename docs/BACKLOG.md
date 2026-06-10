# Backlog HugoTaSlot — état au 05/06/2026

Référence rapide après la passe P0 → P3 + Passe 1 du refactoring multi-pages. Détail technique : [ARCHITECTURE.md](./ARCHITECTURE.md).

## Terminé

| Lot | Sujets |
|-----|--------|
| **P0** | Catalogue sans `jeux-embed.js` par défaut ; enrichissement vignettes ; SEO / OG / favicon |
| **P1** | Découpage `index.html` → `styles.css` + `app.js` ; doc prod vs `web/` ; CI sync + enrich ; `npm test` |
| **P2** | Mobile drawer ; a11y sidebar/modales ; libellés mode catalogue étendu |
| **P3** | Logs `bhWarn` + debug ; PWA (`manifest`, `sw.js`) ; `jeux.json` allégé au build |
| **Multi-pages Passe 1** | URLs distinctes par onglet (History API) ; lazy `jeux.json` ; infra `LAZY_PAGE_SCRIPTS` |

## En cours / récurrent

| Sujet | Action |
|--------|--------|
| **0 placeholder** dans `jeux.json` | Pipeline en place : sync `sr_*` → enrich Hub88/Gamdom/Stake → **purge des orphelins** (`npm run catalog:prune-orphans`). Le catalogue ne contient que des jeux avec vignette réelle. |
| **Nouveaux `sr_*` sans image** | Sync crée `image: ""`. Workflow : `enrich:images:full` → `enrich:stake-placeholders` → `catalog:prune-orphans` retire ce qui reste vide. |

## Fraîcheur catalogue (live)

Pipeline pour que les utilisateurs voient les nouvelles sorties très vite :

1. **CI GitHub Actions** — `sync-jeux-daily.yml` tourne **toutes les 3 h** (8×/jour). Sync slot.report → enrich Hub88/Gamdom → enrich Stake → purge orphelins → commit `jeux.json`.
2. **Vercel auto-deploy** — chaque commit sur `main` redéploie le site (intégration Git).
3. **Cache HTTP `jeux.json`** — `max-age=300, stale-while-revalidate=3600` (5 min frais / 1 h stale). Le navigateur revalide avec `If-Modified-Since` (réponse 304 si pas changé, coût ~50 octets).
4. **Polling client** — `app.js` refetch silencieusement `jeux.json` toutes les **30 min** + au retour de focus (onglet réactivé). Si le catalogue a changé, le state et la grille sont mis à jour sans recharger la page.

**Délai max** entre publication d'un jeu et apparition côté utilisateur : **~3 h + 5 min** (cron + cache).

Pourquoi pas d'appel direct Stake depuis le navigateur :
- CORS bloqué (Stake n'autorise pas hugotaslot.fr).
- DNS ANJ : les FAI français redirigent `stake.com` vers `145.239.225.117` → les navigateurs Chrome/Firefox des utilisateurs FR ne peuvent pas atteindre Stake (le DoH bypass Node ne s'applique pas au navigateur).
- Cloudflare bloque les requêtes non-cookied.

→ Le serveur CI fait tout le travail, le navigateur ne fait que lire `jeux.json` mis à jour.

## Enrichissement Stake (fallback)

`scripts/enrich-stake-placeholders.mjs` interroge l'API GraphQL Stake (`slugKuratorGroup`) pour compléter les `sr_*` sans image — utile car Stake propose souvent les sorties slot.report avant Gamdom.

**Bypass blocage France (DNS ANJ)** : le client utilise par défaut une résolution DNS-over-HTTPS (Cloudflare puis Google) qui contourne la redirection DNS du FAI vers `145.239.225.117`. Marche **sans VPN ni Playwright**. Désactivable avec `STAKE_USE_DOH=0`.

Implémentation :
- `scripts/lib/stake-graphql.mjs` — schéma moderne, fetch natif (DoH) + repli Playwright + gestion `numberLessEqual` (limite offset Stake ~4000).
- `scripts/lib/stake-match.mjs` — matching nom+provider / srSlug / nom seul, alias providers, ligatures (testé hors réseau).
- `scripts/enrich-stake-placeholders.mjs` — multi-sort (`popular7d` + `newest`), `--from-file`, ciblage par provider.
- `scripts/stake-browser-export.js` — snippet console Chrome pour exporter le catalogue complet quand DoH ne suffit pas.

Usage :

```bash
# Bypass DNS automatique (France), passe par défaut sur slots + new-releases
npm run enrich:stake-placeholders

# Ciblage par provider (contourne la limite d'offset Stake ~4000)
node scripts/enrich-stake-placeholders.mjs --slug=pragmatic-play --slug=bgaming --slug=relax-gaming

# Sans réseau (export Chrome préalable, voir scripts/stake-browser-export.js)
node scripts/enrich-stake-placeholders.mjs --from-file=stake-slots-XXXX.json

# Dry-run
node scripts/enrich-stake-placeholders.mjs --dry-run

# CI ou environnement sans browser
STAKE_SKIP_BROWSER=1 npm run enrich:stake-placeholders
```

**Limites mesurées (2026-06)** : Stake renvoie max ~4000 jeux par groupe (`numberLessEqual`). Le multi-sort + ciblage par provider augmente la couverture. Sur 248 placeholders catalogue, ~37 ont été récupérés via Stake (jeux populaires absents de Gamdom mais présents sur Stake). Les restants ne sont ni sur Gamdom ni sur Stake.

## Refactoring multi-pages — état & suite

### Passe 1 (terminée, 05/06/2026)

Le site se comporte déjà comme un **vrai site multi-pages** côté UX, tout en restant techniquement une SPA (état Supabase / solde / partie en cours conservés entre pages).

**Livré** :
- **URLs distinctes** par onglet sidebar via History API. Slugs propres :
  - `/` accueil, `/hunt`, `/blackjack`, `/mise-optimale`, `/roue-depot`, `/pharaon`,
  - `/tournoi`, `/stats`, `/mini-jeux`, `/updates`, `/actualites`, `/review`, `/admin`
- **Back / forward** navigateur, **refresh** sur n'importe quelle URL, **partage de lien** direct (`/blackjack`, `/pharaon`…) — tout marche grâce à `vercel.json` qui rewrite déjà `/(.*)` → `index.html`.
- **`<title>` mis à jour** par page (SEO + onglet navigateur).
- **Lazy `jeux.json`** : le catalogue (~1.9 Mo) n'est **plus chargé au boot**. Il l'est uniquement quand l'utilisateur entre sur `/hunt`. `refreshCatalogSilently()` respecte ce lazy (ne pre-fetch pas si jamais consulté).
- **Infrastructure `LAZY_PAGE_SCRIPTS`** prête : ajouter une entrée dans le registre suffira à charger un script de page à la demande, sans toucher au code de `switchPage()`.

**Code clé** (`app.js`) :
- `PAGE_TO_SLUG` / `SLUG_TO_PAGE` / `pathToPage()` / `pageToPath()` : mapping URL ↔ page
- `switchPage(page, { replace?, skipHistory? })` : push/replace l'URL + lazy load module
- `ensureSlotsLoaded()` : promesse mémoïsée du chargement `jeux.json`
- `loadLazyPageScript(page)` + `LAZY_PAGE_SCRIPTS` : registre des modules lazy
- `window.popstate` : back/forward → re-mount sans pousser l'historique
- Routing initial dans `initV101()` au lieu du `switchPage('home')` codé en dur

### Passe 2 (à venir — extraction des chunks lazy)

But : que `app.js` ne charge plus tout le code de toutes les pages d'un coup. Méthode = extraire les fonctions par page dans des fichiers séparés et les charger via `LAZY_PAGE_SCRIPTS`.

Ordre suggéré (du plus indépendant au plus intriqué) :

1. **`pharaon`** (~1000 lignes) — `initPharaohSlot` + toutes les fonctions `pharaoh*`
2. **`roue_depot`** (~380 lignes) — `initDepositWheel` + helpers
3. **`mini-jeux`** (~2100 lignes) — lobby + 12 mini-jeux (`launchGame`, `closeGame`, `playGame`, etc.)
4. **`blackjack`** (~22 lignes) — `renderBJTable` (trivial)
5. **`mise`** (~250 lignes) — `calcMise`
6. **`tournoi`** (~300 lignes) — `renderTournoiLeaderboard`
7. **`admin`** (~600 lignes) — `renderAdminPanel`
8. **`stats`** / **`news`** / **`updates`** / **`review`** / **`home`** — petites pages restantes

**Pattern à appliquer** pour chaque extraction (3 étapes) :
1. Couper le bloc de fonctions de `app.js` → `./scripts/pages/<slug>.js` (les fonctions restent globales, pas de module ES — migration progressive sans réécrire les références).
2. Décommenter la ligne correspondante dans `LAZY_PAGE_SCRIPTS`.
3. Smoke test : `npm test` puis test manuel de la page.

**Gain estimé** une fois toutes les pages extraites : `app.js` passe de **~11 000 lignes** à **~3-4 000 lignes** chargées au boot. Les ~7 000 lignes restantes ne sont chargées que pour les pages effectivement consultées.

## Optionnel (non engagé)

| Sujet | Notes |
|--------|--------|
| Fusion / archivage `web/` | Décision produit |
| Tournoi / export PDF / etc. | Idées produit, hors maintenance technique |

## Commandes utiles

```bash
npm start                  # site prod en local (racine)
npm test                   # smoke catalogue + build
npm run catalog:stats      # compteurs placeholders
npm run catalog:strip-placeholders
npm run enrich:images:full
npm run deploy:vercel      # après changement site / jeux.json
```

Debug console : `?debug=1` ou `localStorage.setItem('bh_debug','1')`.
