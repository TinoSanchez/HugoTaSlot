# Synchroniser le catalogue Stake dans `jeux.json`

Le script `sync-stake-catalog.mjs` interroge l’API GraphQL de Stake (`casinoGames`, par défaut `categorySlug=slots`) et **n’ajoute** que les jeux **absents** (déduplication `nom` + `provider` normalisés).

- **Par défaut** : `https://stake.com/casino/group/slots` et `x-language` adapté. Autre groupe : `STAKE_CATEGORY_SLUG=…` (ex. `new-releases`).

## GitHub Actions (une passe HTTP, sans navigateur)

Le workflow définit `STAKE_FETCH_ONLY=1` : uniquement **fetch** Node vers `/_api/graphql` — **pas** de Playwright. Secret optionnel **`STAKE_PROXY`** si le runner est bloqué par Cloudflare.

## En local : fetch + repli Playwright

Sans `STAKE_FETCH_ONLY`, si le `fetch` échoue, le script tente **Playwright** (installe Chromium : `npx playwright install chromium`).

- `FORCE_PLAYWRIGHT=1` : forcer uniquement le navigateur.
- `STAKE_FETCH_ONLY=1` : forcer uniquement le fetch (comme en CI).

## Blocage ANJ / France

En local, l’ANJ ou TLS peut empêcher d’atteindre Stake. **VPN** ou autre réseau : puis `npm run sync:stake` et commit de `jeux.json`.

## Commandes

```bash
npm run sync:stake
node scripts/sync-stake-catalog.mjs --dry-run
```

## Entrées ajoutées

- `id` : `stake_<slug>`
- `gamdomUrl` : `https://stake.com/casino/games/<slug>`
