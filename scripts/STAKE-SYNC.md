# Synchroniser le catalogue Stake dans `jeux.json`

Le script `sync-stake-catalog.mjs` interroge l’API GraphQL publique de Stake (`casinoGames` avec un `categorySlug`) et **n’ajoute** que les jeux **absents** du catalogue (déduplication `nom` + `provider` normalisés).

**Par défaut** : **nouveautés** — `STAKE_CATEGORY_SLUG` = `new-releases`, page d’appui `https://stake.com/fr/casino/group/new-releases`. Pour tout le catalogue **slots** : `STAKE_CATEGORY_SLUG=slots` (et éventuellement `STAKE_LOCALE=en`, etc.).

## Comportement du script

1. D’abord, requête **Node** (`fetch`) vers l’API GraphQL de Stake.
2. En cas d’échec (Cloudflare, 403, etc.), **fallback** Patchright / Playwright : ouverture de la page **groupe** (ex. `/fr/casino/group/new-releases`) dans le navigateur, puis requêtes GraphQL via le **même contexte** (cookies).

Variable d’environnement `FORCE_PLAYWRIGHT=1` : **sauter** le `fetch` et n’utiliser que Playwright (utile si seul le navigateur passe le WAF).

## Pourquoi pas en local (France) ?

Depuis la France, `stake.com` est souvent **coupé ou redirigé** (ANJ) : certificat TLS incohérent, ou **403 Cloudflare**. Même Playwright peut échouer (même trafic sortant) — ce n’est pas un bug du script. Le scénario fiable est le **runner GitHub (US)**.

## Méthode recommandée : GitHub Actions (runner US)

1. Push ce dépôt sur GitHub (si ce n’est pas déjà fait).
2. Onglet **Actions** → workflow **Sync Stake → jeux.json** → **Run workflow**.
3. Après succès, `jeux.json` est commité automatiquement. Puis déploie le site : `npm run deploy:vercel`.

## En local (hors France ou VPN)

Installe d’abord le navigateur Playwright (une fois) si tu comptes sur le fallback :

```bash
npx playwright install chromium
```

Puis :

```bash
npm run sync:stake
```

Forcer uniquement Playwright :

```bash
set FORCE_PLAYWRIGHT=1
npm run sync:stake
```

( PowerShell : `$env:FORCE_PLAYWRIGHT=1; npm run sync:stake` )

Aperçu sans écraser le fichier :

```bash
node scripts/sync-stake-catalog.mjs --dry-run
```

## Format des entrées ajoutées

- `id` : `stake_<slug>`
- `gamdomUrl` : `https://stake.com/casino/games/<slug>` (champ historique, utilisé aussi pour Stake)
- `devise` : identique aux autres entrées (USD)

Le site a été ajusté pour que le bouton d’ouverture utilise ce lien quand le casino du hunt est **Stake**.
