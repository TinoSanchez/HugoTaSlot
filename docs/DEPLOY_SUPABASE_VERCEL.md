# HugoTaSlot Cloud - Mise en ligne publique

## 1) Pré-requis
- Compte Supabase
- Compte Vercel
- Node.js 20+

## 2) Base de données Supabase
1. Créer un nouveau projet Supabase.
2. Ouvrir SQL Editor.
3. Exécuter le script:
   - `supabase/migrations/20260427_init_hugotaslot.sql`
4. Dans `Authentication > Providers > Email`:
   - activer Email/Password,
   - désactiver la confirmation email (pas de vérification mail).

## 3) Variables d'environnement frontend
Copier `web/.env.example` vers `web/.env` puis remplir:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 4) Lancer en local
```bash
npm install
npm run dev
```

## 5) Déployer sur Vercel
1. Importer le repo/projet sur Vercel.
2. Vérifier que Vercel lit `vercel.json`.
3. Ajouter les variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Déployer.

## 6) Post-lancement (promotion admin)
1. Créer ton compte normalement sur le site public.
2. Récupérer l'`id` utilisateur dans Supabase (`profiles`).
3. Exécuter:
```sql
update public.profiles
set role = 'admin'
where id = 'TON_USER_ID_ICI';
```
4. Se reconnecter: l'onglet Admin apparaît.

## 7) Sécurité côté solde
- Les joueurs ne peuvent pas modifier `balances.amount`.
- Seules les RPC admin peuvent modifier les soldes:
  - `admin_set_balance`
  - `admin_adjust_balance`
- Chaque action admin est tracée dans `admin_audit_logs`.
