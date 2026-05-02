-- ═══════════════════════════════════════════════════════════════
--  Migration P0 : balance/RPC, drop quotidien cloud, game_sessions,
--  hunts transactionnels, RGPD (export/delete), bucket avatars.
--
--  À exécuter dans le dashboard Supabase (SQL Editor) après les
--  deux précédentes migrations (`20260427_init_hugotaslot.sql`
--  et `20260427_add_tournaments_and_hunt_extras.sql`).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1) Daily streak / claim côté `profiles`
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_claim_day integer,
  add column if not exists last_claim_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 2) Index utiles
-- ─────────────────────────────────────────────────────────────
create index if not exists hunts_user_idx on public.hunts (user_id);
create index if not exists hunt_bonuses_hunt_idx on public.hunt_bonuses (hunt_id);
create index if not exists game_sessions_user_idx on public.game_sessions (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 3) RPC : applique un delta atomique sur la balance du user courant
--    (utilisé par les mini-jeux pour débiter la mise / créditer un payout)
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_balance_delta(p_delta numeric, p_reason text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new numeric(14,2);
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  insert into public.balances (user_id, amount)
  values (v_user, 100)
  on conflict (user_id) do nothing;

  update public.balances
     set amount = round(greatest(0, amount + p_delta)::numeric, 2),
         updated_at = now(),
         updated_by = v_user
   where user_id = v_user
   returning amount into v_new;

  return v_new;
end;
$$;

grant execute on function public.apply_balance_delta(numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4) RPC : enregistre une session de jeu + applique payout-stake
-- ─────────────────────────────────────────────────────────────
create or replace function public.record_game_session(
  p_game text,
  p_stake numeric,
  p_payout numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new numeric(14,2);
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  insert into public.game_sessions (user_id, game_name, stake, payout)
  values (v_user, p_game, round(coalesce(p_stake,0)::numeric, 2), round(coalesce(p_payout,0)::numeric, 2));

  insert into public.balances (user_id, amount)
  values (v_user, 100)
  on conflict (user_id) do nothing;

  update public.balances
     set amount = round(greatest(0, amount + (coalesce(p_payout,0) - coalesce(p_stake,0)))::numeric, 2),
         updated_at = now(),
         updated_by = v_user
   where user_id = v_user
   returning amount into v_new;

  return v_new;
end;
$$;

grant execute on function public.record_game_session(text, numeric, numeric) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5) RPC : drop quotidien (réclame récompense + streak)
-- ─────────────────────────────────────────────────────────────
create or replace function public.claim_daily_drop()
returns table (
  awarded numeric,
  new_balance numeric,
  streak integer,
  next_claim_day integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today integer := floor(extract(epoch from now()) / 86400)::integer;
  v_last  integer;
  v_streak integer := 0;
  v_base numeric := 25;
  v_bonus_pct numeric := 0;
  v_award numeric;
  v_new_bal numeric(14,2);
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  select last_claim_day, daily_streak into v_last, v_streak
    from public.profiles
   where id = v_user
   for update;

  if v_last is not null and v_last = v_today then
    raise exception 'already_claimed';
  end if;

  if v_last is not null and v_last = v_today - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  -- 5% bonus par jour de streak, plafonné à 200%
  v_bonus_pct := least(2.0, (v_streak - 1) * 0.05);
  v_award := round(v_base * (1.0 + v_bonus_pct), 2);

  update public.profiles
     set daily_streak = v_streak,
         last_claim_day = v_today,
         last_claim_at = now()
   where id = v_user;

  insert into public.balances (user_id, amount)
  values (v_user, 100)
  on conflict (user_id) do nothing;

  update public.balances
     set amount = round((amount + v_award)::numeric, 2),
         updated_at = now(),
         updated_by = v_user
   where user_id = v_user
   returning amount into v_new_bal;

  return query select v_award, v_new_bal, v_streak, v_today;
end;
$$;

grant execute on function public.claim_daily_drop() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6) RPC : remplace toutes les hunts du user de manière transactionnelle
--    p_hunts: jsonb array dont chaque élément est :
--    {
--      "id": uuid,
--      "name": text,
--      "currency": text,
--      "starting_balance": numeric,
--      "start_balance_eur": numeric,
--      "archived": boolean,
--      "created_at": timestamptz (optional),
--      "bonuses": [
--        { "id": uuid?, "slot_id": text, "slot_name": text, "provider": text,
--          "slot_image": text, "bet": numeric, "win": numeric|null, "win_value": numeric|null,
--          "bonus_type": text, "gamdom_url": text, "sort_order": int }
--      ]
--    }
-- ─────────────────────────────────────────────────────────────
create or replace function public.replace_user_hunts(p_hunts jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_keep_ids uuid[] := '{}'::uuid[];
  v_hunt jsonb;
  v_hunt_id uuid;
  v_bonus jsonb;
  v_bonus_keep bigint[];
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  if p_hunts is null or jsonb_typeof(p_hunts) <> 'array' then
    p_hunts := '[]'::jsonb;
  end if;

  -- Liste des hunts à conserver
  for v_hunt in select * from jsonb_array_elements(p_hunts)
  loop
    v_keep_ids := v_keep_ids || (v_hunt->>'id')::uuid;
  end loop;

  -- Suppression des hunts disparus
  delete from public.hunts
   where user_id = v_user
     and id <> all (v_keep_ids);

  -- Upsert hunts + bonuses
  for v_hunt in select * from jsonb_array_elements(p_hunts)
  loop
    v_hunt_id := (v_hunt->>'id')::uuid;

    insert into public.hunts (
      id, user_id, name, currency, starting_balance, start_balance_eur, archived, created_at, updated_at
    ) values (
      v_hunt_id,
      v_user,
      coalesce(v_hunt->>'name', 'Hunt'),
      coalesce(v_hunt->>'currency', 'EUR'),
      greatest(0.01, round(coalesce((v_hunt->>'starting_balance')::numeric, 0), 2)),
      coalesce((v_hunt->>'start_balance_eur')::numeric, (v_hunt->>'starting_balance')::numeric),
      coalesce((v_hunt->>'archived')::boolean, false),
      coalesce((v_hunt->>'created_at')::timestamptz, now()),
      now()
    )
    on conflict (id) do update
      set name = excluded.name,
          currency = excluded.currency,
          starting_balance = excluded.starting_balance,
          start_balance_eur = excluded.start_balance_eur,
          archived = excluded.archived,
          updated_at = now()
    where public.hunts.user_id = v_user;

    v_bonus_keep := '{}'::bigint[];

    -- Suppression de tous les bonuses existants pour cette hunt (full replace)
    delete from public.hunt_bonuses where hunt_id = v_hunt_id;

    if (v_hunt ? 'bonuses') and jsonb_typeof(v_hunt->'bonuses') = 'array' then
      for v_bonus in select * from jsonb_array_elements(v_hunt->'bonuses')
      loop
        insert into public.hunt_bonuses (
          hunt_id, slot_id, slot_name, provider, slot_image, bet, win, win_value,
          bonus_type, gamdom_url, sort_order
        ) values (
          v_hunt_id,
          coalesce(v_bonus->>'slot_id', ''),
          coalesce(v_bonus->>'slot_name', 'Slot'),
          coalesce(v_bonus->>'provider', ''),
          coalesce(v_bonus->>'slot_image', ''),
          greatest(0, round(coalesce((v_bonus->>'bet')::numeric, 0), 2)),
          coalesce(round((v_bonus->>'win')::numeric, 2), 0),
          (v_bonus->>'win_value')::numeric,
          coalesce(v_bonus->>'bonus_type', 'normal'),
          coalesce(v_bonus->>'gamdom_url', ''),
          coalesce((v_bonus->>'sort_order')::int, 1)
        );
      end loop;
    end if;
  end loop;
end;
$$;

grant execute on function public.replace_user_hunts(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7) RPC : export RGPD du compte courant
-- ─────────────────────────────────────────────────────────────
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select to_jsonb(p) - 'role' from public.profiles p where p.id = v_user
    ),
    'balance', (
      select to_jsonb(b) from public.balances b where b.user_id = v_user
    ),
    'hunts', coalesce((
      select jsonb_agg(
        to_jsonb(h) || jsonb_build_object(
          'bonuses', coalesce((
            select jsonb_agg(to_jsonb(hb) order by hb.sort_order)
            from public.hunt_bonuses hb
            where hb.hunt_id = h.id
          ), '[]'::jsonb)
        )
      )
      from public.hunts h
      where h.user_id = v_user
    ), '[]'::jsonb),
    'game_sessions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.game_sessions s
      where s.user_id = v_user
    ), '[]'::jsonb),
    'tournament_entries', coalesce((
      select jsonb_agg(to_jsonb(t))
      from public.tournament_entries t
      where t.user_id = v_user
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.export_my_data() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8) RPC : suppression complète du compte (RGPD)
-- ─────────────────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  -- On efface explicitement les données utilisateur (les FK cascades couvrent
  -- déjà profiles → balances/hunts/hunt_bonuses/game_sessions, mais on
  -- détache les entrées tournoi pour les conserver anonymisées).
  update public.tournament_entries
     set user_id = null,
         player_name = 'Compte supprimé'
   where user_id = v_user;

  delete from public.game_sessions where user_id = v_user;
  delete from public.hunts where user_id = v_user;
  delete from public.balances where user_id = v_user;
  delete from public.profiles where id = v_user;

  -- Et enfin la suppression du user d'auth (cascade complète)
  delete from auth.users where id = v_user;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 9) Bucket Supabase Storage pour les avatars
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 2 * 1024 * 1024,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

-- Lecture publique
drop policy if exists "Avatars publicly readable" on storage.objects;
create policy "Avatars publicly readable" on storage.objects
for select using (bucket_id = 'avatars');

-- Upload : l'utilisateur connecté ne peut écrire que dans son dossier
drop policy if exists "Avatars upload self" on storage.objects;
create policy "Avatars upload self" on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Avatars update self" on storage.objects;
create policy "Avatars update self" on storage.objects
for update using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Avatars delete self" on storage.objects;
create policy "Avatars delete self" on storage.objects
for delete using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

-- ─────────────────────────────────────────────────────────────
-- 10) Sécurité : on resserre les policies de mise à jour `profiles`
--     pour permettre à l'utilisateur d'écrire daily_streak/last_claim_*
--     (les RPC sont security definer → contournent déjà les policies,
--     mais on autorise aussi `update profiles set avatar_url...` direct).
-- ─────────────────────────────────────────────────────────────
-- (Aucune modification des policies existantes nécessaire — la policy
--  profiles_update_self_limited autorise déjà l'utilisateur à modifier
--  ses champs hors role/status.)
