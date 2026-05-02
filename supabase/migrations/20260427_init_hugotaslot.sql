-- Extensions
create extension if not exists "pgcrypto";

-- Enum-like constraints
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('player', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'profile_status') then
    create type public.profile_status as enum ('active', 'suspended');
  end if;
end$$;

-- Core tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text unique,
  display_name text not null default 'Player',
  avatar_url text,
  role public.app_role not null default 'player',
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.balances (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  amount numeric(14,2) not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.hunts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  currency text not null default 'EUR',
  starting_balance numeric(14,2) not null check (starting_balance > 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hunt_bonuses (
  id bigint generated always as identity primary key,
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  slot_name text not null,
  provider text,
  bet numeric(14,2) not null check (bet > 0),
  win numeric(14,2) not null default 0 check (win >= 0),
  bonus_type text not null default 'normal',
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_name text not null,
  stake numeric(14,2) not null default 0,
  payout numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target_user_id uuid,
  target_table text,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Helpers
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists(
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists trg_hunts_updated_at on public.hunts;
create trigger trg_hunts_updated_at before update on public.hunts
for each row execute function public.touch_updated_at();

drop trigger if exists trg_hunt_bonuses_updated_at on public.hunt_bonuses;
create trigger trg_hunt_bonuses_updated_at before update on public.hunt_bonuses
for each row execute function public.touch_updated_at();

-- Auto profile + balance at signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_username text;
  normalized_username text;
begin
  raw_username := coalesce(new.raw_user_meta_data ->> 'username', null);
  normalized_username := nullif(lower(regexp_replace(coalesce(raw_username, ''), '[^a-zA-Z0-9._-]', '', 'g')), '');
  insert into public.profiles (id, email, username, display_name)
  values (
    new.id,
    new.email,
    normalized_username,
    coalesce(new.raw_user_meta_data ->> 'display_name', normalized_username, split_part(coalesce(new.email,''),'@',1), 'Player')
  )
  on conflict (id) do update
    set email = excluded.email;

  insert into public.balances (user_id, amount)
  values (new.id, 100)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.balances enable row level security;
alter table public.hunts enable row level security;
alter table public.hunt_bonuses enable row level security;
alter table public.game_sessions enable row level security;
alter table public.admin_audit_logs enable row level security;

-- profiles
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self_limited on public.profiles;
create policy profiles_update_self_limited on public.profiles
for update using (id = auth.uid() and status = 'active')
with check (
  id = auth.uid()
  and role = (select p.role from public.profiles p where p.id = auth.uid())
  and status = (select p.status from public.profiles p where p.id = auth.uid())
);

-- balances (no direct update for players)
drop policy if exists balances_read_self_or_admin on public.balances;
create policy balances_read_self_or_admin on public.balances
for select using (user_id = auth.uid() or public.is_admin());

-- hunts
drop policy if exists hunts_owner_rw on public.hunts;
create policy hunts_owner_rw on public.hunts
for all using (user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.status='active'))
with check (user_id = auth.uid());

drop policy if exists hunts_admin_read on public.hunts;
create policy hunts_admin_read on public.hunts
for select using (public.is_admin());

-- hunt_bonuses
drop policy if exists bonuses_owner_rw on public.hunt_bonuses;
create policy bonuses_owner_rw on public.hunt_bonuses
for all using (
  exists(select 1 from public.hunts h where h.id = hunt_id and h.user_id = auth.uid())
)
with check (
  exists(select 1 from public.hunts h where h.id = hunt_id and h.user_id = auth.uid())
);

drop policy if exists bonuses_admin_read on public.hunt_bonuses;
create policy bonuses_admin_read on public.hunt_bonuses
for select using (public.is_admin());

-- game_sessions
drop policy if exists sessions_owner_rw on public.game_sessions;
create policy sessions_owner_rw on public.game_sessions
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists sessions_admin_read on public.game_sessions;
create policy sessions_admin_read on public.game_sessions
for select using (public.is_admin());

-- audit logs
drop policy if exists logs_admin_read on public.admin_audit_logs;
create policy logs_admin_read on public.admin_audit_logs
for select using (public.is_admin());

-- Admin RPCs
create or replace function public.admin_log(
  p_action text,
  p_target_user uuid default null,
  p_target_table text default null,
  p_target_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  insert into public.admin_audit_logs(admin_id, action, target_user_id, target_table, target_id, payload)
  values (auth.uid(), p_action, p_target_user, p_target_table, p_target_id, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.admin_set_balance(p_user_id uuid, p_amount numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.balances
  set amount = round(p_amount::numeric, 2), updated_at = now(), updated_by = auth.uid()
  where user_id = p_user_id;
  if not found then
    insert into public.balances(user_id, amount, updated_at, updated_by)
    values (p_user_id, round(p_amount::numeric,2), now(), auth.uid());
  end if;
  perform public.admin_log('set_balance', p_user_id, 'balances', p_user_id::text, jsonb_build_object('amount', round(p_amount::numeric,2), 'reason', p_reason));
end;
$$;

create or replace function public.admin_adjust_balance(p_user_id uuid, p_delta numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.balances
  set amount = round((amount + p_delta)::numeric, 2), updated_at = now(), updated_by = auth.uid()
  where user_id = p_user_id;
  if not found then
    insert into public.balances(user_id, amount, updated_at, updated_by)
    values (p_user_id, round(p_delta::numeric,2), now(), auth.uid());
  end if;
  perform public.admin_log('adjust_balance', p_user_id, 'balances', p_user_id::text, jsonb_build_object('delta', round(p_delta::numeric,2), 'reason', p_reason));
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform public.admin_log('set_role', p_user_id, 'profiles', p_user_id::text, jsonb_build_object('role', p_role, 'reason', p_reason));
end;
$$;

create or replace function public.admin_set_status(p_user_id uuid, p_status public.profile_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.profiles set status = p_status where id = p_user_id;
  perform public.admin_log('set_status', p_user_id, 'profiles', p_user_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.admin_archive_hunt(p_hunt_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.hunts set archived = p_archived where id = p_hunt_id returning user_id into v_user;
  perform public.admin_log('archive_hunt', v_user, 'hunts', p_hunt_id::text, jsonb_build_object('archived', p_archived));
end;
$$;

create or replace function public.admin_delete_hunt(p_hunt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  select user_id into v_user from public.hunts where id = p_hunt_id;
  delete from public.hunts where id = p_hunt_id;
  perform public.admin_log('delete_hunt', v_user, 'hunts', p_hunt_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  username text,
  display_name text,
  role public.app_role,
  status public.profile_status,
  balance_amount numeric
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.username, p.display_name, p.role, p.status, coalesce(b.amount,0) as balance_amount
  from public.profiles p
  left join public.balances b on b.user_id = p.id
  where public.is_admin(auth.uid())
  order by p.created_at desc;
$$;

grant execute on function public.admin_set_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_adjust_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role, text) to authenticated;
grant execute on function public.admin_set_status(uuid, public.profile_status, text) to authenticated;
grant execute on function public.admin_archive_hunt(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_hunt(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
