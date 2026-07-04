# 🤖 Bot Discord HugoTaSlot

Bot Discord en relation avec le site (Supabase) pour :

- 🎬 **Annoncer chaque nouvelle vidéo YouTube** de la chaîne HugoTaSlot
- 🎰 **Annoncer les nouvelles sorties de slot** (auto via [SlotCatalog](https://slotcatalog.com) : même jeux neufs qu’on retrouve sur Stake, Gamdom, Shuffle, Celsius, etc. + [BigWinBoard](https://bigwinboard.com) si le flux est accessible + ajouts manuels admin)
- 🔗 **Lier les comptes Discord ↔ HugoTaSlot** (commande `/link CODE`)
- 📊 **Slash commands** : `/lastvideo`, `/lastslot`, `/slot`, `/call`, `/hunts`, `/leaderboard`, `/live`, `/link`, `/unlink`
  - **`/call`** : option **`machine`** (autocomplete sur le catalogue `jeux.json`) ; sans option = slot au hasard comme `/slot`.
  - **`/live slug`** : ouvre un hunt public partagé (lien `/h/…` du site).

Tourne **H24** sur Railway (free tier suffit). Stockage Supabase, donc accessible aussi par le site.

---

## 1. Créer l'application Discord

1. Va sur https://discord.com/developers/applications → **New Application** → nomme-la `HugoTaSlot Bot`
2. Onglet **General Information** → copie l'**Application ID** (= `DISCORD_CLIENT_ID`)
3. Onglet **Bot** :
   - **Reset Token** → copie-le (= `DISCORD_TOKEN`, ne le partage jamais)
   - Désactive **PUBLIC BOT** si tu veux qu'il reste privé (recommandé)
   - Tu n'as **pas besoin** des Privileged Intents (Message Content, etc.) pour ce bot.
4. Onglet **OAuth2 → URL Generator** :
   - **Scopes** : coche `bot`, `applications.commands`
   - **Bot Permissions** : `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`
   - Copie l'URL générée, ouvre-la dans ton navigateur, choisis ton serveur, **Authorize**.

## 2. Récupérer les IDs nécessaires

Active **Mode développeur** dans Discord (Paramètres → Avancés → Mode développeur).

- **Guild ID** : clic droit sur ton serveur → *Copier l'ID* → `DISCORD_GUILD_ID`
  (Optionnel mais **recommandé** : permet d'avoir les commandes instantanément. Sans ça, propagation jusqu'à 1h.)
- **Channel YouTube** : clic droit sur le salon où poster les vidéos → *Copier l'ID* → `DISCORD_CHANNEL_YOUTUBE`
- **Channel Slots** : idem pour le salon des sorties de slots → `DISCORD_CHANNEL_SLOTS`

## 3. Récupérer l'ID de la chaîne YouTube

1. Va sur la page de la chaîne HugoTaSlot
2. Clique sur **Partager la chaîne** → **Copier l'ID de la chaîne**
3. Ça commence par `UC…` → `YOUTUBE_CHANNEL_ID`

> Pas besoin de clé API YouTube : on utilise le flux RSS public (illimité, gratuit).

## 4. Créer les tables Supabase

Dans le SQL Editor de Supabase, exécute **dans l'ordre** :

```text
discord-bot/sql/01_youtube_videos.sql
discord-bot/sql/02_slot_releases.sql
discord-bot/sql/03_discord_links.sql
discord-bot/sql/04_bot_state.sql
discord-bot/sql/05_slot_releases_extended_sources.sql   # sources slotcatalog, stake, etc.
```

Le bot utilise la **service_role key** (visible dans Project Settings → API) pour bypass RLS.
**Ne jamais** exposer cette clé côté front.

## 5. Variables d'environnement

Copie `.env.example` en `.env` et remplis. Toutes les valeurs sont commentées dans le fichier.

```bash
cd discord-bot
cp .env.example .env   # ou copie manuelle sous Windows
```

## 6. Lancer en local (test)

```bash
cd discord-bot
npm install
npm run register   # enregistre les slash commands (1 seule fois après ajout/modif)
npm run dev        # démarre le bot avec watch
```

Vérifie qu'il connecte (logs `Bot Discord prêt`), puis test sur Discord avec `/lastvideo`.

## 7. Nouvelles slots : pourquoi SlotCatalog (et pas 4 sites en parallèle) ?

Les pages **Nouveautés** de Stake, Gamdom, Shuffle, Celsius sont souvent en **SPA + Cloudflare** : un simple `fetch` Node ne voit rien, ou se fait **403**.  
**SlotCatalog** publie chaque jour la liste des **vraies nouvelles sorties** d’industrie (par studio) : quand un jeu apparaît sur l’un de ces casinos, il est en général **déjà référencé** sur SlotCatalog en « New Slots ». Le bot compare avec ton `jeux.json` (catalogue local) et n’annonce **que** ce qui n’y est pas encore → pas de spam.

Variables utiles :

```env
CASINO_SOURCES=slotcatalog    # recommandé ; laisser une seule source
CRON_CASINO=*/30 * * * *
SITE_URL=https://hugotaslot.fr   # prod ; pour télécharger jeux.json en dédup
```

Les fetchers directs `stake` / `gamdom` / `shuffle` / `celsius` existent encore dans le code mais sont **souvent inutilisables** sans proxy payant ; garde `slotcatalog`.

---

## 8. Déployer sur Railway (H24)

1. Crée un compte sur https://railway.app et installe la CLI : `npm i -g @railway/cli`
2. À la racine du projet *(pas le dossier discord-bot, la racine globale)* :
   ```bash
   railway init
   ```
3. **Important** : configure le **Root Directory** sur `discord-bot/` (Railway → Service → Settings → Root Directory).
   Ainsi Railway ne builde QUE le bot et ignore le site Vercel.
4. Dans Railway → onglet **Variables**, ajoute toutes les variables du `.env`.
5. Déploie :
   ```bash
   railway up
   ```
6. Une fois déployé, exécute la registration des commandes une fois :
   ```bash
   railway run npm run register
   ```

**Healthcheck Railway** : désactivé dans `railway.json` (`"healthcheckPath": null`). Un bot Discord n’a pas besoin d’HTTP pour recevoir du trafic — le healthcheck sur `PORT` échoue souvent (faux 503) alors que le processus est sain. Le serveur **HTTP** sur `0.0.0.0:$PORT` reste dispo pour debug manuel (`GET /` ou `/healthz`). Vérifie surtout que la variable **`PORT` n’est pas vide** sur le service (sinon on retombe sur 3000 côté code).

## 9. Workflow de liaison `/link`

1. Sur le site, l'utilisateur clique **Lier mon Discord** → on insère une row dans `discord_links` :
   - `user_id` = uid Supabase
   - `code` = 6 caractères aléatoires (par ex. `B7K2X9`)
   - `expires_at` = `now() + 15 min`
   - `discord_id` = NULL
2. Sur Discord, l'utilisateur tape `/link B7K2X9`
3. Le bot trouve la row par `code`, vérifie l'expiration, complète `discord_id` + `discord_username`, vide `code`/`expires_at` et marque `linked_at`.
4. Désormais, `/hunts` ou `/hunts @lui` retrouve ses Bonus Hunts.

L'intégration côté site (bouton + génération de code) sera ajoutée dans une étape suivante.

## 10. Surveillance des sorties de slots manuelles

Depuis l'admin du site, on peut insérer dans `slot_releases` :
```sql
insert into public.slot_releases (source, slug, title, provider, image, summary, url, published_at)
values ('manual', 'manual_dropem_hacksaw_2026', 'Drop\'em', 'Hacksaw Gaming',
        'https://…/dropem.jpg', 'Sortie 100% Hacksaw, mécanique drop avec multiplicateurs.',
        'https://gamdom.com/fr-fr/casino/dropem-hacksaw-gaming', now());
```
Le scheduler vérifie toutes les **2 minutes** les `source='manual'` non encore postées et les annonce automatiquement.

## 11. Crontabs ajustables

Dans `.env` :
```env
CRON_YOUTUBE=*/10 * * * *    # toutes les 10 min
CRON_SLOTS=*/30 * * * *      # toutes les 30 min (BigWinBoard)
CRON_CASINO=*/30 * * * *     # toutes les 30 min (SlotCatalog)
```
Format cron classique (minutes, heures, jour-mois, mois, jour-semaine).

## 12. Architecture technique

```
discord-bot/
├── src/
│   ├── index.js              ← entry point + healthcheck HTTP
│   ├── config.js             ← lecture .env validée
│   ├── supabase.js           ← client service_role + helpers bot_state
│   ├── lib/
│   │   ├── logger.js         ← pino structured logs
│   │   ├── rss.js            ← parser RSS / Atom universel
│   │   ├── catalog.js        ← jeux.json du site (dédup)
│   │   └── casino-fetchers.js← SlotCatalog (Jina) + fetchers expérimentaux
│   ├── discord/
│   │   ├── client.js         ← discord.js v14
│   │   ├── commands.js       ← définitions + dispatcher
│   │   └── register-commands.js
│   └── jobs/
│       ├── scheduler.js      ← node-cron + anti-double-run
│       ├── youtube-watcher.js
│       ├── slot-watcher.js
│       └── casino-watcher.js ← SlotCatalog → slot_releases
├── sql/                      ← schémas Supabase
├── package.json
├── railway.json
├── Procfile                  ← fallback pour autres PaaS
└── .env.example
```

## 13. Sécurité

- ✅ La **service_role key** n'est utilisée que côté bot (jamais côté front).
- ✅ RLS Supabase active : lecture publique de `youtube_videos` / `slot_releases`, écriture limitée admin / service_role.
- ✅ Le code de liaison `/link` expire en 15 min et n'est valable qu'une fois.
- ✅ Aucun secret commit (`.env` ignoré par git).

## 14. Idées d’évolution

- Proxy payant (ScraperAPI, etc.) si un jour tu veux remettre un fetcher direct Stake/Gamdom
- Enrichir `jeux.json` plus souvent sur le site pour affiner la dédup

## Licence

Privé / interne au projet HugoTaSlot.

---

## 15. Migration vers un nouveau serveur Discord

Tu changes de serveur (communauté migrée) **sans recréer le bot** : garde la même application Discord + le même déploiement Railway. Seuls les IDs Discord et l’invitation changent.

### Ce qui ne change pas

| Élément | Pourquoi |
|--------|----------|
| `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` | Même application bot |
| Supabase (`SUPABASE_*`) | Même base, annonces et liaisons |
| Liaisons `/link` existantes | Stockées par **ID utilisateur Discord** (pas par serveur) |
| Vidéos / slots déjà annoncées | `posted_to_discord_at` empêche de reposter l’historique |

### Ce qu’il faut mettre à jour

1. **Créer les salons** sur le nouveau serveur (ex. `#annonces-youtube`, `#nouvelles-slots`).
2. **Mode développeur** activé → copier les IDs :
   - Clic droit sur le **serveur** → Copier l’ID → `DISCORD_GUILD_ID`
   - Clic droit sur chaque **salon** → Copier l’ID → `DISCORD_CHANNEL_YOUTUBE` / `DISCORD_CHANNEL_SLOTS`
3. **Inviter le bot** sur le **nouveau** serveur (OAuth2 → URL Generator : scopes `bot` + `applications.commands`, permissions Send Messages, Embed Links, Attach Files, Read Message History) :
   ```
   https://discord.com/api/oauth2/authorize?client_id=TON_CLIENT_ID&permissions=116736&scope=bot%20applications.commands
   ```
   Remplace `TON_CLIENT_ID` par `DISCORD_CLIENT_ID`.
4. **Railway** → service bot → **Variables** → modifier :
   - `DISCORD_GUILD_ID`
   - `DISCORD_CHANNEL_YOUTUBE`
   - `DISCORD_CHANNEL_SLOTS`
5. **Redéployer** (ou Restart) le service Railway pour prendre les nouvelles variables.
6. **Ré-enregistrer les slash commands** sur le nouveau guild (obligatoire) :
   ```powershell
   cd discord-bot
   railway link          # si pas déjà lié au projet
   railway run npm run register
   ```
   Ou en local avec un `.env` à jour : `npm run register`.
7. **Tester** sur le nouveau serveur :
   - `/lastvideo`, `/slot`, `/link` (code généré sur le site)
   - Admin site → publier une slot test → message dans `#nouvelles-slots` sous ~60 s
8. **Ancien serveur** (optionnel) : Paramètres serveur → Intégrations → retirer le bot. Les anciennes commandes slash sur l’ancien guild disparaissent avec le bot.

### Si tu recrées une **nouvelle** application Discord (nouveau bot)

En plus des étapes ci-dessus : nouveau `DISCORD_TOKEN`, nouveau `DISCORD_CLIENT_ID`, mise à jour Railway, `npm run register`, invitation sur le nouveau serveur. Les joueurs **n’ont pas besoin de relier** leur compte si leur Discord est le même — les rows `discord_links` restent valides (même `discord_id`).

### Dépannage

| Problème | Piste |
|----------|--------|
| Pas de commandes `/` visibles | `DISCORD_GUILD_ID` incorrect ou `npm run register` pas relancé |
| Bot en ligne mais pas d’annonces | Mauvais ID de salon ou bot sans accès au salon |
| « Channel slots non configuré » dans les logs | `DISCORD_CHANNEL_SLOTS` vide ou invalide |
| Annonces dans l’ancien salon | Railway pas redémarré après changement de variables |
