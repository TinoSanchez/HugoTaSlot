# HugoTaSlot — Bonus Hunt Manager

Application web pour gérer des **bonus hunts** : sessions, catalogue de slots (Gamdom + slot.report), stats, tournois, mini-jeux, outils streamer (opener, HUD) et comptes cloud **Supabase**.

**Site en production :** [https://hugotaslot.fr](https://hugotaslot.fr)

## Où modifier le code ?

| Environnement | Emplacement | Commandes |
|---------------|-------------|-----------|
| **Production** | Racine : `index.html`, `styles.css`, `app.js`, `jeux.json`, `assets/` | `npm start` · `npm run deploy:vercel` |
| **Artefact build** | `web/dist/` (généré, ne pas éditer) | `npm run build` |
| **Prototype Vite** (hors prod) | `web/src/` | `npm run dev` |

Documentation : **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · état du backlog : **[docs/BACKLOG.md](docs/BACKLOG.md)**

## Démarrage rapide

```bash
npm install
npm start
# → http://localhost:8765  (serve.js — jeux.json nécessite HTTP)
```

Tests et catalogue :

```bash
npm test
npm run catalog:stats
npm run enrich:images              # vignettes sr_* (Hub88 + Gamdom OG)
npm run enrich:images:full         # + API Gamdom
npm run enrich:stake-placeholders  # fallback Stake (VPN/Playwright requis en FR)
```

Déploiement Vercel (après changement visible sur le site) :

```bash
npm run deploy:vercel
```

## Fonctionnalités principales

- **Hunts** : création, archivage, bonus avec mise / gain / BE, stats en en-tête
- **Catalogue** : ~8 000 slots, recherche, filtre provider, mode **Gamdom pur** / **étendu** (slot.report)
- **Cloud** : auth Supabase, hunts et soldes synchronisés, mode invité en cache local
- **Streamer** : mini-opener, Picture-in-Picture, fenêtre HUD dédiée
- **Admin** : rôles, soldes, drops, audit
- **Mini-jeux** intégrés (Blackjack, Roulette, Plinko, etc.)

## Catalogue (`jeux.json`)

- Chargé via `fetch('jeux.json')` ; secours `jeux-embed.js` uniquement si le JSON échoue.
- En production, le build **compacte** le JSON (sans champ `devise` dupliqué).
- Les entrées sans vignette réelle affichent l’icône locale (pas d’URL placehold.co).
- Placeholders restants : voir `npm run catalog:stats` — enrichissement automatique via GitHub Actions (quotidien).

## Supabase

Migrations dans `supabase/migrations/`. Le site prod utilise les constantes `ONLINE_SUPABASE_*` dans `app.js`. Le prototype `web/` utilise `VITE_SUPABASE_*` (cf. `web/.env.example`).

## PWA et debug

- Installable : `manifest.webmanifest` + service worker (`sw.js`) pour le shell statique.
- Logs verbeux : `?debug=1`, `localStorage.setItem('bh_debug','1')` ou `window.__BH_DEBUG__ = true`.

## Structure utile

```
index.html, styles.css, app.js   # site prod
jeux.json, assets/               # catalogue + médias
scripts/                         # build, sync, enrichissement, tests
docs/ARCHITECTURE.md             # architecture dépôt
discord-bot/                     # bot Discord (Railway)
web/                             # prototype Vite (non déployé)
```

---

**Version documentée :** 1.02 · **Dépôt :** site BH / hugotaslot-cloud
