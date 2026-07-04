# Assets Rich Presence Discord

Uploader ces fichiers dans **Discord Developer Portal → ton application → Rich Presence → Art Assets**.

| Fichier | Clé à saisir dans Discord | Rôle | Texte affiché (`.env`) |
|---------|---------------------------|------|-------------------------|
| `image_19.png` | `image_19` | Grande image | `PRESENCE_LARGE_IMAGE_TEXT=19ENPLEIN CASINO` |
| `gamdom.png` | `gamdom` | Petite image | `PRESENCE_SMALL_IMAGE_TEXT=Gamdom` |

> Les clés Discord sont limitées à **32 caractères** (d’où `gamdom` au lieu d’un nom de fichier long).

Après upload, redémarre le bot Railway (pas besoin de `npm run register`).
