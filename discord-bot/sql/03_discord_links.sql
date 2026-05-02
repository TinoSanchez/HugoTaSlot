-- ────────────────────────────────────────────────────────────────────────────
-- Table : public.discord_links
-- Liaison comptes site ↔ comptes Discord, avec workflow par code à 6 chiffres.
--   1. L'user clique "Lier mon Discord" sur le site → on insère une row avec
--      user_id rempli, discord_id = NULL, code aléatoire, expires_at = +15 min.
--   2. Sur Discord : /link CODE → le bot complète discord_id + discord_username
--      et nullifie le code.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.discord_links (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  discord_id       text unique,
  discord_username text,
  code             text unique,                  -- code temporaire de liaison
  expires_at       timestamptz,                  -- expiration du code
  linked_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists discord_links_user_idx on public.discord_links (user_id);
create index if not exists discord_links_discord_idx on public.discord_links (discord_id);

-- Trigger pour updated_at
create or replace function public.touch_discord_links()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists discord_links_touch on public.discord_links;
create trigger discord_links_touch
  before update on public.discord_links
  for each row execute function public.touch_discord_links();

alter table public.discord_links enable row level security;

-- L'utilisateur connecté peut LIRE et MANIPULER sa propre liaison
drop policy if exists "discord_links_self_read" on public.discord_links;
create policy "discord_links_self_read" on public.discord_links
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "discord_links_self_insert" on public.discord_links;
create policy "discord_links_self_insert" on public.discord_links
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "discord_links_self_update" on public.discord_links;
create policy "discord_links_self_update" on public.discord_links
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "discord_links_self_delete" on public.discord_links;
create policy "discord_links_self_delete" on public.discord_links
  for delete to authenticated using (auth.uid() = user_id);

-- Le bot (service_role) bypasse RLS pour terminer le workflow /link.
