# Prototype Vite — hors production

Ce dossier **n’est pas déployé** sur [hugotaslot.fr](https://hugotaslot.fr).

| | Production | Ce dossier (`web/`) |
|---|------------|---------------------|
| Source | Racine : `index.html`, `app.js` | `web/src/` |
| Build | `npm run build` → `web/dist/` | `npm run dev` (Vite) |
| Déploiement | Vercel (`hugotaslot-cloud`) | Aucun |

**Ne pas** corriger un bug prod ici sans le porter vers `app.js` à la racine.

Voir aussi : [README.md](./README.md) · [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
