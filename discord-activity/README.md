# Discord Activity HugoTaSlot

Mini-app embarquée dans Discord avec **Rich Presence visuelle** (images 19ENPLEIN + Gamdom) pour les **membres** qui lancent l’Activity.

> Le **bot** seul ne peut pas afficher les images sur son profil — l’Activity corrige ça pour les utilisateurs connectés.

## Configuration Developer Portal

1. **Activities → Settings** → activer **Enable Activities**
2. **Activities → URL Mappings** :

| PREFIX | TARGET |
|--------|--------|
| `/` | `hugotaslot.fr` |

3. **OAuth2 → Redirects** : ajouter `https://hugotaslot.fr/discord-activity/` (si demandé)
4. **Rich Presence → Art Assets** (optionnel) : les images utilisent des **URLs externes** hébergées sur le site

## Variables Vercel (obligatoires)

| Variable | Usage |
|----------|--------|
| `DISCORD_CLIENT_ID` | ID application (public) — injecté dans `config.json` au build |
| `DISCORD_CLIENT_SECRET` | Échange OAuth `/api/discord-activity/token` |

Redéployer le site après ajout des variables (`npm run deploy:vercel`).

## Build

Inclus dans `npm run build` → `web/dist/discord-activity/`

```bash
node scripts/build-discord-activity.mjs
```

## Lancement

- Discord → **+** Apps → Activity **HugoTaSlot**
- Ou commande bot **`/activity`** (instructions)

## Fichiers

- `index.html` / `style.css` — UI
- `main.js` — SDK + `setActivity()` avec images
- `api/discord-activity/token.js` — OAuth serverless Vercel
