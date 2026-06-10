# Dossier `web/` — prototype Vite (non production)

Ce dossier **n’est pas** le site déployé sur [hugotaslot.fr](https://hugotaslot.fr).

Le site public est construit depuis la **racine** du repo :

- `index.html`, `styles.css`, `app.js` → `npm run build` → `web/dist/`

Pour le détail complet : **[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)**

## Commandes (prototype uniquement)

```bash
# Depuis la racine du repo
npm run dev      # Vite sur web/
npm run preview
```

Copier `web/.env.example` vers `web/.env` avec vos clés `VITE_SUPABASE_*` si vous testez ce prototype.
