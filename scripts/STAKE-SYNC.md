# Synchroniser le catalogue Stake dans `jeux.json`

Le script `sync-stake-catalog.mjs` interroge l’API GraphQL de Stake (`casinoGames`, par défaut `categorySlug=slots`) et **n’ajoute** que les jeux **absents** (déduplication `nom` + `provider` normalisés).

- **Par défaut** : `https://stake.com/casino/group/slots`. Autre groupe : `STAKE_CATEGORY_SLUG=…` (ex. `new-releases`).

## En local

1. `npm run sync:stake` — d’abord `fetch`, puis **Playwright** si besoin (`npx playwright install chromium` une fois).
2. `STAKE_FETCH_ONLY=1` — uniquement le fetch HTTP, sans navigateur.
3. `FORCE_PLAYWRIGHT=1` — uniquement Playwright.
4. `STAKE_PROXY` / `HTTPS_PROXY` — proxy pour le fetch et le navigateur.

## France / ANJ / Cloudflare

Souvent **TLS ANJ** ou **403 Cloudflare** en direct : essaie un **VPN** ou une **box 4G**, puis relance la sync.

## Commandes

```bash
npm run sync:stake
node scripts/sync-stake-catalog.mjs --dry-run
```

## Entrées ajoutées

- `id` : `stake_<slug>`
- `gamdomUrl` : `https://stake.com/casino/games/<slug>`
