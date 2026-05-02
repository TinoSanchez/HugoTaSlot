# 🎰 Bonus Hunt Manager v1.01

Une application web complète de gestion de Bonus Hunt avec interface moderne et tous les outils nécessaires.

## 📋 Fonctionnalités Implémentées

### BASE - Système Principal
✅ **Interface Split**
- Liste de bonus à gauche avec recherche et filtrage
- Grille de slots à droite avec infinite scroll
- Sidebar avec gestion des sessions/hunts

✅ **Gestion des Sessions**
- Création de hunts avec nom et solde de départ
- Sélection rapide des sessions
- Suppression et modification des hunts

✅ **Base de Slots**
- 7000+ slots générés automatiquement
- Recherche en temps réel
- Filtrage par provider
- 13 providers: Pragmatic Play, Microgaming, NetEnt, Betsoft, Yggdrasil, Play'n GO, Evolution, Reel Kingdom, Thunderkick, Quickspin, Nolimit City, Red Tiger, Relax Gaming

✅ **Bonus Management**
- Affichage style Gamdom: barre colorée, miniature 90×72px
- Colonnes: nom/provider/mise, BE REQUIS (bleu), GAIN (or/vert)
- Editeur fullscreen avec progress bar
- Navigation ⏪⏩ avec touche Entrée pour confirmer

✅ **Statistiques en Header**
- MISE TOT. : Montant total misé
- BONUS : Montant des bonus
- GAINS TOT. : Total des gains
- PROFIT : Bénéfice (vert/rouge)
- BE MOYEN : Moyenne des multiplicateurs

✅ **Persistance & Performance**
- Stockage localStorage
- Lazy loading des slots
- Infinite scroll (50 slots par page)

### v1.01 - Nouvelles Fonctionnalités

✅ **Bouton Gamdom**
- "Ouvrir sur Gamdom" dans l'opener
- Ouvre directement la slot sur Gamdom

✅ **Stratégie BlackJack**
- Table complète (Hard/Soft/Paires)
- Conseils personnalisés live basés sur main et carte du dealer
- 3 catégories: Hard Totals, Soft Totals, Pairs

✅ **Calcul de Mise Optimale**
- Basé sur: solde, nombre de bonus, BE visé, RTP
- Critère de Kelly avec fraction conservative (5%)
- Mise conservative recommandée
- Gain attendu calculé

✅ **Système de Comptes**
- Inscription/Connexion avec pseudo + mot de passe
- Pas de vérification email
- Solde virtuel de départ: 1000€
- Stockage sécurisé en localStorage

✅ **12 Mini Jeux**
1. BlackJack - Stratégie complète avec conseil
2. Roulette - Tirage aléatoire 0-36
3. HiLo - Prédiction haute/basse
4. Dice - Lancer de dés
5. Plinko - Générateur de multiplicateurs
6. Mines - Grille 25 cases avec mines
7. Limbo - Cible aléatoire
8. Keno - Tirage 20 sur 80
9. Chicken - Jeu de poulet
10. Crash - Point de crash généré
11. Pump - Jeu de pompe
12. Flip - Lancer de pièce

✅ **Pop-up Gamdom**
- Bouton flottant vert en bas à droite
- Saisie directe du gain sans changer de page
- Intégration avec les bonus

## 🚀 Comment Utiliser

### Démarrage
1. Ouvrir `index.html` dans un navigateur
2. Créer un compte (pseudo + mot de passe)
3. Authentification automatique

### Créer une Session
1. Cliquer sur "+ Nouveau" dans la sidebar
2. Entrer nom et solde de départ
3. Valider

### Ajouter des Bonus
1. Cliquer sur "+ Ajouter Bonus"
2. Rechercher un slot (par nom ou provider)
3. Sélectionner le slot
4. Remplir: Mise, Gain
5. Le BE se calcule automatiquement
6. Confirmer avec Entrée ou bouton ✓

### Consulter Statistiques
- En haut à gauche: MISE, BONUS, GAINS, PROFIT, BE MOYEN
- Mise à jour en temps réel

### Jouer aux Mini-Jeux
- Cliquer sur les 12 emoji en bas du sidebar
- Interface fullscreen
- Fermer pour revenir

### Utiliser Gamdom
1. Cliquer "Ouvrir sur Gamdom" dans l'opener
2. Ou utiliser le bouton vert flottant pour saisir les gains

## 🗄️ Structure de Données

### Stockage Supabase (utilisateurs connectés — full cloud)

Toutes les données utilisateur sont désormais stockées dans Supabase (PostgreSQL) :

| Table | Contenu |
|---|---|
| `auth.users` | Authentification (email + mot de passe hashé, géré par Supabase Auth) |
| `public.profiles` | Profil (`id`, `email`, `username`, `display_name`, `avatar_url`, `role`, `status`) |
| `public.balances` | Solde virtuel de chaque utilisateur |
| `public.hunts` | Bonus hunts (`name`, `currency`, `starting_balance`, `start_balance_eur`, `archived`) |
| `public.hunt_bonuses` | Bonus dans chaque hunt (`slot_id`, `slot_name`, `provider`, `slot_image`, `bet`, `win`, `win_value`, `bonus_type`, `gamdom_url`, `sort_order`) |
| `public.game_sessions` | Historique des parties (mises / gains) |
| `public.tournament_entries` | Leaderboard du tournoi (`hunt_name`, `player_name`, `gain`, `mise`, `multiplier`, `replay_url`, `verified`) |
| `public.admin_audit_logs` | Journal des actions admin |

Sécurité : RLS activé sur toutes les tables. Chaque joueur ne voit que ses propres données ; les admins voient tout.

### LocalStorage (cache + mode invité)

Le navigateur ne conserve que :

- `huntmaster_v2` — **cache local des hunts** (offline-first, miroir du cloud, repoussé en background)
- `huntmaster_v2_synced` — flag de synchro
- `hm_session_v1` — session SDK Supabase
- `hm_guest_profile_v1` — profil invité (utilisateurs non connectés uniquement)
- `hm_ui_prefs_v1` — préférences UI (taille, son, volume) propres à l'appareil

Les anciennes clés legacy (`hm_users_v1`, `hm_admin_bootstrap_v1`, `bhm_accounts`, `hm_tournoi_v1`) sont automatiquement purgées au démarrage.

### Configuration Supabase

1. Variables d'environnement (cf. `web/.env.example`) :
   ```
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   ```
2. Pour l'app monolithique `index.html`, l'URL et la clé anon sont en dur dans le script (`ONLINE_SUPABASE_URL` / `ONLINE_SUPABASE_ANON`). Adaptez-les si vous changez de projet.
3. Migrations SQL à exécuter dans le SQL Editor de Supabase, dans l'ordre :
   - `supabase/migrations/20260427_init_hugotaslot.sql`
   - `supabase/migrations/20260427_add_tournaments_and_hunt_extras.sql`

### Objet Bonus
```javascript
{
  id: timestamp,
  slotId: number,
  slotName: string,
  provider: string,
  image: string,
  url: string,
  bet: number,
  gain: number,
  be: number,
  multiplier: string,
  status: 'pending'
}
```

## 🎨 Design

- **Thème**: Dark mode gaming
- **Couleurs principales**: 
  - Cyan (#00d4ff) - Primaire
  - Or (#ffd700) - Gains
  - Vert (#00d97e) - Profit positif
  - Rouge (#ff4757) - Perte
- **Responsive**: Mobile-friendly avec CSS Grid

## 📊 Classe Manager

### AccountManager
- `register(username, password)` - Créer compte
- `login(username, password)` - Connexion
- `logout()` - Déconnexion
- `updateBalance(username, amount)` - Modifier solde
- `getUserBalance(username)` - Récupérer solde

### HuntManager
- `createHunt(name, balance)` - Créer session
- `addBonusToHunt(huntId, bonusData)` - Ajouter bonus
- `getHuntStats(huntId)` - Stats de la session
- `calculateBE(gain, bet)` - Calculer BE

### SlotsManager
- `searchSlots(query, provider)` - Rechercher
- `getPaginatedSlots(query, provider, page)` - Pagination
- `getProviders()` - Lister providers
- `calculateOptimalBet(balance, bonuses, targetBE, rtp)` - Calcul mise

### GamesManager
- `getBlackJackStrategy()` - Table stratégie
- `getBlackJackAdvice(playerCards, dealerCard)` - Conseil
- `spinRoulette()` - Roulette
- `rollDice()` - Dés
- `drawKenoNumbers()` - Keno
- `generateCrashPoint()` - Crash

## ⚙️ Configuration

### Paramètres modifiables
- Solde initial: 100€ (trigger SQL `handle_new_user`, table `public.balances`)
- Taille pagination slots: 50 (dans `slots.js`)
- RTP par défaut: 0.96 (dans `games.js`)

## 🔒 Sécurité

- Authentification gérée par **Supabase Auth** (mots de passe hashés côté serveur).
- **Row Level Security** activée sur toutes les tables : chaque utilisateur ne lit/écrit que ses propres données.
- Les actions admin passent par des **RPC `security definer`** (`admin_set_balance`, `admin_set_role`, etc.) qui vérifient `is_admin(auth.uid())`.
- Toutes les actions admin sont loguées dans `admin_audit_logs`.

## 🎮 Exemple d'utilisation

1. **Créer compte**: pseudo "hunter" / password "pass123"
2. **Créer session**: "Sweet Bonanza Hunt" / 500€
3. **Ajouter bonus**: Chercher "Sweet Bonanza"
4. **Remplir stats**: Mise 1.00€, Gain 25€
5. **Voir résultat**: BE 25×, Profit +24€

## 📱 Navigateurs supportés

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## 🚀 Prochaines étapes (future v1.02)

- Tournoi Bonus Hunt avec classement
- Export PDF des sessions
- Graphiques de progression
- Statistiques détaillées
- Mode sombre/clair
- PWA offline mode

---

**Version**: 1.01  
**Date**: 22/04/2026  
**Auteur**: Bonus Hunt Manager
