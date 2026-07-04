-- Partage public live d'un hunt (lecture anonyme via RPC, mise à jour par le propriétaire).

create table if not exists public.public_hunt_shares (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hunt_id text not null,
  payload jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, hunt_id)
);

create index if not exists public_hunt_shares_slug_live_idx
  on public.public_hunt_shares (slug)
  where enabled = true;

alter table public.public_hunt_shares enable row level security;

drop policy if exists public_hunt_shares_owner_rw on public.public_hunt_shares;
create policy public_hunt_shares_owner_rw on public.public_hunt_shares
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Lecture publique : RPC security definer uniquement (pas de select anon direct).

create or replace function public.get_public_hunt_share(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.public_hunt_shares;
begin
  select * into v_row
    from public.public_hunt_shares
   where slug = lower(trim(p_slug))
     and enabled = true
   limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'slug', v_row.slug,
    'payload', v_row.payload,
    'updated_at', v_row.updated_at
  );
end;
$$;

grant execute on function public.get_public_hunt_share(text) to anon, authenticated;

create or replace function public.publish_public_hunt_share(p_hunt_id text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_hunt_id text := trim(coalesce(p_hunt_id, ''));
  v_slug text;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  if v_hunt_id = '' then
    raise exception 'hunt_id required';
  end if;

  select slug into v_slug
    from public.public_hunt_shares
   where user_id = v_user
     and hunt_id = v_hunt_id
   limit 1;

  if v_slug is null then
    v_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into public.public_hunt_shares (slug, user_id, hunt_id, payload, enabled)
    values (v_slug, v_user, v_hunt_id, coalesce(p_payload, '{}'::jsonb), true);
  else
    update public.public_hunt_shares
       set payload = coalesce(p_payload, '{}'::jsonb),
           enabled = true,
           updated_at = now()
     where slug = v_slug
       and user_id = v_user;
  end if;

  return v_slug;
end;
$$;

grant execute on function public.publish_public_hunt_share(text, jsonb) to authenticated;

create or replace function public.disable_public_hunt_share(p_hunt_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_hunt_id text := trim(coalesce(p_hunt_id, ''));
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  if v_hunt_id = '' then
    return false;
  end if;

  update public.public_hunt_shares
     set enabled = false,
         updated_at = now()
   where user_id = v_user
     and hunt_id = v_hunt_id;

  return found;
end;
$$;

grant execute on function public.disable_public_hunt_share(text) to authenticated;
