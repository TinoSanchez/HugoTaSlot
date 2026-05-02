# Synchroniser le catalogue Stake dans `jeux.json`

Le script `sync-stake-catalog.mjs` interroge l’API GraphQL de Stake (`casinoGames`, par défaut `categorySlug=slots`) et **n’ajoute** que les jeux **absents** (déduplication `nom` + `provider` normalisés).

- **Par défaut** : `https://stake.com/casino/group/slots`. Autre groupe : `STAKE_CATEGORY_SLUG=…` (ex. `new-releases`).

## En local

1. `npm run sync:stake` — d’abord `fetch`, puis **Playwright** si besoin (`npx playwright install chromium` une fois). Sous **Windows**, Playwright ouvre souvent une **fenêtre Chrome visible** (mieux pour Cloudflare) ; pour forcer sans fenêtre : `PLAYWRIGHT_HEADLESS=1`.
2. `STAKE_FETCH_ONLY=1` — uniquement le fetch HTTP, sans navigateur.
3. `FORCE_PLAYWRIGHT=1` — uniquement Playwright.
4. `STAKE_PROXY` / `HTTPS_PROXY` — proxy pour le fetch et le navigateur.

## Si le réseau bloque (ANJ, Cloudflare)

- **VPN** ou **4G** puis `npm run sync:stake`.
- **Sans accès API** : ouvre Stake dans **Chrome** (où ça marche) → F12 → **Réseau** → filtre `graphql` → requête `POST` vers `/_api/graphql` → onglet **Réponse** → tout le JSON → enregistre dans un fichier, ex. `stake-export.json` :
  ```bash
  node scripts/sync-stake-catalog.mjs --from-file=stake-export.json
  ```
  Le script accepte la réponse GraphQL complète (`data.casinoGames.edges`) ou un tableau de jeux.

## Commandes

```bash
npm run sync:stake
node scripts/sync-stake-catalog.mjs --dry-run
```

## Entrées ajoutées

- `id` : `stake_<slug>`
- `gamdomUrl` : `https://stake.com/casino/games/<slug>`
