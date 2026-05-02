-- Extensions du modèle pour la migration full-cloud
-- À exécuter dans le dashboard Supabase (SQL Editor) sur l'instance utilisée par index.html

-- ─────────────────────────────────────────────────────────────
-- 1) Colonnes additionnelles sur public.hunts
-- ─────────────────────────────────────────────────────────────
alter table public.hunts
  add column if not exists start_balance_eur numeric(14,2);

-- Initialiser start_balance_eur pour les enregistrements existants (taux 1:1 par défaut)
update public.hunts
set start_balance_eur = starting_balance
where start_balance_eur is null;

-- ─────────────────────────────────────────────────────────────
-- 2) Colonnes additionnelles sur public.hunt_bonuses
-- ─────────────────────────────────────────────────────────────
alter table public.hunt_bonuses
  add column if not exists slot_id text,
  add column if not exists slot_image text,
  add column if not exists gamdom_url text,
  add column if not exists win_value numeric(14,2);

-- win_value sépare "win = NULL (en attente)" du "win = 0 (joué et zéro)"
-- (la colonne win existante était NOT NULL DEFAULT 0)
update public.hunt_bonuses
set win_value = win
where win_value is null and win is not null;

-- ─────────────────────────────────────────────────────────────
-- 3) Permettre des bet à 0 (slot custom sans mise renseignée)
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.check_constraints cc
    join information_schema.constraint_column_usage ccu
      on cc.constraint_name = ccu.constraint_name
    where ccu.table_schema = 'public'
      and ccu.table_name = 'hunt_bonuses'
      and cc.check_clause ilike '%bet > 0%'
  ) then
    execute (
      select 'alter table public.hunt_bonuses drop constraint ' || quote_ident(cc.constraint_name)
      from information_schema.check_constraints cc
      join information_schema.constraint_column_usage ccu
        on cc.constraint_name = ccu.constraint_name
      where ccu.table_schema = 'public'
        and ccu.table_name = 'hunt_bonuses'
        and cc.check_clause ilike '%bet > 0%'
      limit 1
    );
  end if;
end$$;

alter table public.hunt_bonuses
  add constraint hunt_bonuses_bet_nonneg check (bet >= 0);

-- ─────────────────────────────────────────────────────────────
-- 4) Table des entrées de tournoi (leaderboard global)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  hunt_name text not null,
  player_name text not null,
  gain numeric(14,2) not null check (gain >= 0),
  mise numeric(14,2) not null check (mise > 0),
  multiplier numeric(14,4) generated always as (gain / nullif(mise, 0)) stored,
  replay_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tournament_entries_multiplier_idx
  on public.tournament_entries (multiplier desc);

create index if not exists tournament_entries_user_idx
  on public.tournament_entries (user_id);

alter table public.tournament_entries enable row level security;

-- Lecture publique (leaderboard)
drop policy if exists tournament_entries_read_all on public.tournament_entries;
create policy tournament_entries_read_all on public.tournament_entries
for select using (true);

-- Insertion : seuls les utilisateurs connectés peuvent ajouter (pour leur compte)
drop policy if exists tournament_entries_insert_self on public.tournament_entries;
create policy tournament_entries_insert_self on public.tournament_entries
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  )
);

-- Update/delete : propriétaire uniquement (sauf admin)
drop policy if exists tournament_entries_update_self on public.tournament_entries;
create policy tournament_entries_update_self on public.tournament_entries
for update using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists tournament_entries_delete_self on public.tournament_entries;
create policy tournament_entries_delete_self on public.tournament_entries
for delete using (user_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 5) RPC admin : valider/annuler une entrée
-- ─────────────────────────────────────────────────────────────
create or replace function public.admin_verify_tournament_entry(p_entry_id uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.tournament_entries
     set verified = p_verified
   where id = p_entry_id;
  perform public.admin_log('verify_tournament', null, 'tournament_entries', p_entry_id::text,
                           jsonb_build_object('verified', p_verified));
end;
$$;

grant execute on function public.admin_verify_tournament_entry(uuid, boolean) to authenticated;
