# Discord Activity HugoTaSlot

Mini-app embarquée dans Discord avec **Rich Presence visuelle** (images 19ENPLEIN + Gamdom).

## Configuration Developer Portal

1. **Activities → Settings** → activer **Enable Activities**
2. **Activities → URL Mappings** :

| PREFIX | TARGET |
|--------|--------|
| `/` | `activity.hugotaslot.fr` |
| `/ht-api` | `hugotaslot.fr` |

3. **Vercel → Domains** : ajouter `activity.hugotaslot.fr` (CNAME → `cname.vercel-dns.com`)
4. **OAuth2 → Redirects** : `https://hugotaslot.fr/discord-activity/` si demandé

> Discord charge l’Activity à la **racine** du domaine mappé (`/`). On utilise le sous-domaine `activity.hugotaslot.fr` qui sert `/discord-activity/` sur Vercel.

## Variables Vercel

| Variable | Usage |
|----------|--------|
| `DISCORD_CLIENT_ID` | Build → `config.json` |
| `DISCORD_CLIENT_SECRET` | `/api/discord-activity/token` |

## Test hors Discord

https://hugotaslot.fr/discord-activity/ — fond sombre + logos (pas écran blanc).

## Lancement

Discord → **+** Apps → **Bot enplein** · commande **`/activity`**
