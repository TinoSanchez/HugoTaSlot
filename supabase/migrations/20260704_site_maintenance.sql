-- Mode maintenance global (serveur) — remplace le flag localStorage navigateur.
-- Lecture publique (anon + authenticated), écriture admin uniquement.

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.site_settings enable row level security;

insert into public.site_settings (key, value)
values (
  'maintenance',
  '{"enabled":false,"message":"Maintenance en cours. Mode lecture seule temporaire."}'::jsonb
)
on conflict (key) do nothing;

create or replace function public.get_site_maintenance()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.site_settings where key = 'maintenance'),
    '{"enabled":false,"message":"Maintenance en cours. Mode lecture seule temporaire."}'::jsonb
  );
$$;

create or replace function public.admin_set_maintenance(p_enabled boolean, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg text := coalesce(nullif(trim(p_message), ''), 'Maintenance en cours. Mode lecture seule temporaire.');
  v_next jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  v_next := jsonb_build_object(
    'enabled', coalesce(p_enabled, false),
    'message', left(v_msg, 220)
  );

  insert into public.site_settings (key, value, updated_at, updated_by)
  values ('maintenance', v_next, now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now(),
        updated_by = auth.uid();

  perform public.admin_log(
    'set_maintenance',
    null,
    'site_settings',
    'maintenance',
    v_next
  );

  return v_next;
end;
$$;

-- Santé schéma (vérif migrations prod via scripts/verify-supabase-migrations.mjs)
create or replace function public.get_schema_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb := '{}'::jsonb;
begin
  v := jsonb_build_object(
    'claim_daily_drop', exists(
      select 1 from pg_proc p
      join pg_namespace n on p.pronamespace = n.oid
      where n.nspname = 'public' and p.proname = 'claim_daily_drop'
    ),
    'claim_daily_drop_factor', exists(
      select 1 from pg_proc p
      join pg_namespace n on p.pronamespace = n.oid
      where n.nspname = 'public' and p.proname = 'claim_daily_drop'
        and pg_get_function_identity_arguments(p.oid) like '%numeric%'
    ),
    'get_leaderboard_wager', exists(
      select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
      where n.nspname = 'public' and p.proname = 'get_leaderboard_wager'
    ),
    'get_leaderboard_streak', exists(
      select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
      where n.nspname = 'public' and p.proname = 'get_leaderboard_streak'
    ),
    'get_site_maintenance', exists(
      select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid
      where n.nspname = 'public' and p.proname = 'get_site_maintenance'
    ),
    'profiles_daily_streak', exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'daily_streak'
    ),
    'profiles_last_claim_day', exists(
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'last_claim_day'
    ),
    'public_hunt_shares', exists(
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'public_hunt_shares'
    )
  );
  return v;
end;
$$;

grant execute on function public.get_site_maintenance() to anon, authenticated;
grant execute on function public.admin_set_maintenance(boolean, text) to authenticated;
grant execute on function public.get_schema_health() to anon, authenticated;

notify pgrst, 'reload schema';
